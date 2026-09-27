/**
 * Deep space around the globe: the Roman Space Telescope's real trajectory
 * from launch out to Sun–Earth L2 (JPL Horizons), JWST and Euclid in their
 * halo orbits there, the L2 point itself, the Moon's orbit for scale, and
 * Roman's downlink to whichever of its ground stations has it in view.
 *
 * Tracks are drawn in the Sun–Earth rotating frame, anchored at the current
 * Sun direction: each sample is turned about the ecliptic pole by how far the
 * Sun has moved since. That is how L2 missions are always shown — a transfer
 * reads as a path out to L2 and a halo orbit as a loop around it — and at the
 * current instant every marker sits exactly where the ephemeris puts it.
 */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { DRAW_SCALE } from '../constants';
import { geodeticToEci } from '../astro/geodetic';
import { loadDeepSpace, positionAt, span, l2At, C_KM_S, type DeepSpace, type BodyName } from '../roman/ephem';
import { STATIONS, MIN_ELEVATION, type Station } from '../roman/sim';
import { loadRomanModel, LENGTH } from '../roman/model';
import { SUN_DIR, makeL2Environment } from '../roman/stage';

/**
 * Roman drawn to scale would be four millionths of a draw unit. Close in, it
 * is shown this much larger, about 60,000 times, and the label says so.
 */
const MODEL_SCALE = 0.02;
const SHOW_MODEL_WITHIN = 6;

const OBLIQUITY = (23.4393 * Math.PI) / 180;
/** The ecliptic pole in ICRF equatorial coordinates. */
const POLE = new THREE.Vector3(0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY));
const DAY = 86_400_000;

/** ICRF km → the globe's render frame: (x, z, −y), in draw units. */
function toRender(v: THREE.Vector3, out = new THREE.Vector3()) {
  return out.set(v.x, v.z, -v.y).divideScalar(DRAW_SCALE);
}

function eclipticLongitude(v: THREE.Vector3) {
  const y = v.y * Math.cos(OBLIQUITY) + v.z * Math.sin(OBLIQUITY);
  return Math.atan2(y, v.x);
}

function dotTexture(ring = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  if (ring) {
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
  } else {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Label { el: HTMLDivElement; at: THREE.Vector3; on: boolean }

export interface RomanNow {
  /** Render-frame position, draw units. */
  draw: THREE.Vector3;
  distKm: number;
  lightSec: number;
  contact: { st: Station; elev: number } | null;
  /** The clock is past the published predict; Roman is held at its end. */
  extrapolated: boolean;
}

export class DeepSpaceLayer {
  readonly group = new THREE.Group();
  /** Roman now, or null until the ephemeris has loaded. */
  roman: RomanNow | null = null;
  onPickRoman: (() => void) | null = null;

  private ds: DeepSpace | null = null;
  private live = new THREE.Color(0x44ff44);
  private builtAt = -Infinity;
  private romanTrack: Line2 | null = null;
  private romanPast: Line2 | null = null;
  private romanCum: number[] = [];
  private romanTimes: number[] = [];
  private tracks: Line2[] = [];
  private moonRing: Line2 | null = null;
  private beam: Line2;
  private beamMat: LineMaterial;
  private mats: LineMaterial[] = [];
  private markers = new Map<string, THREE.Sprite>();
  private pulse: THREE.Sprite;
  private labels = new Map<string, Label>();
  private labelHost: HTMLDivElement;
  private tmp = new THREE.Vector3();
  private clock = 0;
  private model: THREE.Object3D | null = null;
  private sunLight = new THREE.DirectionalLight(0xfff3e2, 4.2);
  private ambient = new THREE.AmbientLight(0x3a4658, 1.6);
  /** A soft light from the viewer's side, so the shaded face still reads. */
  private fill = new THREE.DirectionalLight(0xb8cae8, 1.6);
  private modelShown = false;

  constructor(private camera: THREE.PerspectiveCamera, uiRoot: HTMLElement, private renderer: THREE.WebGLRenderer) {
    this.group.name = 'deep-space';
    this.labelHost = document.createElement('div');
    Object.assign(this.labelHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.labelHost.className = 'deep-space-labels';
    uiRoot.prepend(this.labelHost);

    const dot = dotTexture();
    const mk = (id: string, color: number, size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dot, color, sizeAttenuation: false, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      }));
      s.scale.setScalar(size);
      s.renderOrder = 999;
      s.visible = false;
      this.group.add(s);
      this.markers.set(id, s);
      return s;
    };
    mk('roman', 0x44ff44, 0.034);
    mk('jwst', 0xffd9a0, 0.02);
    mk('euclid', 0xcfe0ff, 0.02);
    mk('l2', 0xffffff, 0.012);
    this.pulse = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture(true), color: 0x44ff44, sizeAttenuation: false, depthWrite: false, depthTest: false, transparent: true,
    }));
    this.pulse.renderOrder = 999;
    this.pulse.visible = false;
    this.group.add(this.pulse);

    this.beamMat = this.mat(0x44ff44, 2.4, 0.95, true);
    this.beamMat.dashSize = 2.2;
    this.beamMat.gapSize = 3.4;
    this.beam = new Line2(new LineGeometry(), this.beamMat);
    (this.beam.geometry as LineGeometry).setPositions([0, 0, 0, 0, 0, 1]);
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.group.add(this.beam);

    this.label('roman', 'Roman', true);
    this.label('jwst', 'JWST');
    this.label('euclid', 'Euclid');
    this.label('l2', 'Sun–Earth L2');
    this.label('moon', 'Moon’s orbit');
    this.label('beam', '');
  }

  private mat(color: number, width: number, opacity: number, dashed = false) {
    const m = new LineMaterial({
      color, linewidth: width, transparent: true, opacity, dashed, depthWrite: false,
      dashSize: dashed ? 1 : 1e9, gapSize: dashed ? 1 : 0,
    });
    this.mats.push(m);
    return m;
  }

  private label(id: string, text: string, pick = false) {
    const el = document.createElement('div');
    el.className = 'ds-label' + (id === 'roman' ? ' ds-roman' : '');
    Object.assign(el.style, {
      position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', font: '11px/1.35 "Overpass Mono", ui-monospace, monospace',
      color: id === 'roman' ? 'var(--live, #44ff44)' : 'rgba(242,241,236,0.72)', display: 'none',
      padding: '2px 6px', background: 'rgba(0,0,0,0.55)', borderLeft: `1px solid ${id === 'roman' ? 'var(--live, #44ff44)' : 'rgba(242,241,236,0.3)'}`,
      pointerEvents: pick ? 'auto' : 'none', cursor: pick ? 'pointer' : 'default', transform: 'translate(12px, -50%)',
    } satisfies Partial<CSSStyleDeclaration>);
    el.innerHTML = `<b style="font-weight:600">${text}</b><span></span>`;
    if (pick) el.addEventListener('click', () => this.onPickRoman?.());
    this.labelHost.append(el);
    this.labels.set(id, { el, at: new THREE.Vector3(), on: false });
  }

  async load() {
    this.ds = await loadDeepSpace();
    this.loadModel().catch((e) => console.warn('[deep-space] Roman model unavailable', e));
  }

  /**
   * The globe's own copy of the observatory. Materials are cloned and reset,
   * so the pane's cutaways and selections don't reach it; the lights added
   * here touch nothing else, as nothing else in the globe's scene is lit.
   */
  private async loadModel() {
    const src = await loadRomanModel();
    const root = src.root.clone(true);
    const env = makeL2Environment(this.renderer);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      Object.assign(m, { opacity: 1, transparent: false, depthWrite: true, clippingPlanes: null, side: THREE.FrontSide, emissiveIntensity: 0, envMap: env, envMapIntensity: 1.0 });
      m.needsUpdate = true;
      mesh.material = m;
      mesh.castShadow = mesh.receiveShadow = false;
      const b = mesh.userData.basePosition as { x: number; y: number; z: number } | undefined;
      if (b) mesh.position.set(b.x, b.y, b.z);
    });
    // Centre it on its own middle, so it turns about itself.
    root.position.set(0, -LENGTH / 2, 0);
    const holder = new THREE.Group();
    holder.add(root);
    holder.scale.setScalar(MODEL_SCALE);
    holder.visible = false;
    this.sunLight.target = holder;
    this.fill.target = holder;
    this.group.add(holder, this.sunLight, this.ambient, this.fill);
    this.model = holder;
  }

  /** Sample times of a body between two instants. */
  private times(body: BodyName, from: number, to: number) {
    const s = this.ds!.bodies[body];
    const out: number[] = [];
    for (let k = 0; k < s.n; k++) {
      const t = s.t0 + k * s.step * 1000;
      if (t >= from && t <= to) out.push(t);
    }
    return out;
  }

  /** A track in the Sun–Earth rotating frame, anchored at `now`. */
  private synodic(body: BodyName, times: number[], now: number) {
    const ds = this.ds!;
    const sunNow = positionAt(ds, 'sun', now) ?? new THREE.Vector3(1, 0, 0);
    const lamNow = eclipticLongitude(sunNow);
    const pts: number[] = [];
    const p = new THREE.Vector3(), sun = new THREE.Vector3(), r = new THREE.Vector3();
    for (const t of times) {
      if (!positionAt(ds, body, t, p)) continue;
      const lam = positionAt(ds, 'sun', t, sun) ? eclipticLongitude(sun) : lamNow;
      p.applyAxisAngle(POLE, lamNow - lam);
      toRender(p, r);
      pts.push(r.x, r.y, r.z);
    }
    return pts;
  }

  private line(pts: number[], m: LineMaterial) {
    const g = new LineGeometry();
    g.setPositions(pts);
    const l = new Line2(g, m);
    l.computeLineDistances();
    l.frustumCulled = false;
    this.group.add(l);
    return l;
  }

  private rebuild(now: number) {
    const ds = this.ds!;
    for (const l of [this.romanTrack, this.romanPast, this.moonRing, ...this.tracks]) {
      if (!l) continue;
      l.geometry.dispose();
      this.group.remove(l);
    }
    this.tracks = [];
    for (const m of this.mats) if (m !== this.beamMat) m.dispose();
    this.mats = [this.beamMat];

    // Roman: the whole published predict, faint and dashed, with the flown
    // part drawn bright over it up to now.
    const [r0, r1] = span(ds, 'roman');
    this.romanTimes = this.times('roman', r0, r1);
    const rp = this.synodic('roman', this.romanTimes, now);
    const future = this.mat(0x44ff44, 1.2, 0.45, true);
    future.dashSize = 1.6; future.gapSize = 1.6;
    this.romanTrack = this.line(rp, future);
    this.romanPast = this.line(rp, this.mat(0x44ff44, 2.2, 0.95, true));
    this.romanCum = [0];
    for (let i = 3; i < rp.length; i += 3) {
      const d = Math.hypot(rp[i] - rp[i - 3], rp[i + 1] - rp[i - 2], rp[i + 2] - rp[i - 1]);
      this.romanCum.push(this.romanCum[this.romanCum.length - 1] + d);
    }

    // JWST and Euclid: a hundred days either side, which in this frame is
    // most of a halo loop around L2.
    for (const [body, color] of [['jwst', 0xffd9a0], ['euclid', 0xcfe0ff]] as const) {
      const pts = this.synodic(body, this.times(body, now - 100 * DAY, now + 100 * DAY), now);
      if (pts.length > 6) this.tracks.push(this.line(pts, this.mat(color, 1, 0.38)));
    }

    // The Moon's orbit this month, as it is: inertial, not rotated.
    const mt = this.times('moon', now - 14 * DAY, now + 14 * DAY);
    const mp: number[] = [];
    for (const t of mt) {
      const p = positionAt(ds, 'moon', t);
      if (p) { toRender(p, this.tmp); mp.push(this.tmp.x, this.tmp.y, this.tmp.z); }
    }
    if (mp.length > 6) this.moonRing = this.line(mp, this.mat(0xf2f1ec, 1, 0.22));

    this.applyLive();
    this.builtAt = now;
  }

  /** Follow the theme's live colour. */
  setLive(css: string) {
    const c = new THREE.Color().setStyle(css);
    if (c.equals(this.live)) return;
    this.live.copy(c);
    this.applyLive();
  }

  private applyLive() {
    for (const m of [this.romanTrack?.material, this.romanPast?.material, this.beamMat] as (LineMaterial | undefined)[]) m?.color.copy(this.live);
    this.markers.get('roman')!.material.color.copy(this.live);
    this.pulse.material.color.copy(this.live);
  }

  /** Where Roman's past ends on its track, in draw-unit distance along it. */
  private pastLength(now: number) {
    const ts = this.romanTimes;
    if (!ts.length || now <= ts[0]) return 0;
    if (now >= ts[ts.length - 1]) return this.romanCum[this.romanCum.length - 1];
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= now) lo = mid; else hi = mid; }
    const u = (now - ts[lo]) / (ts[hi] - ts[lo]);
    return this.romanCum[lo] + (this.romanCum[hi] - this.romanCum[lo]) * u;
  }

  /**
   * `now` Unix ms (the app's clock), `gmstRad` Earth's rotation as the globe
   * draws it, `w`/`h` the canvas size in CSS px.
   */
  update(now: number, gmstRad: number, dt: number, w: number, h: number) {
    const ds = this.ds;
    if (!ds) return;
    if (Math.abs(now - this.builtAt) > 2 * 3_600_000) this.rebuild(now);
    for (const m of this.mats) m.resolution.set(w, h);
    this.clock += dt;

    // Roman, held at the end of the predict if the clock runs past it.
    const [r0, r1] = span(ds, 'roman');
    const tt = Math.min(Math.max(now, r0), r1);
    const rk = positionAt(ds, 'roman', tt)!;
    const draw = toRender(rk);
    const past = this.pastLength(now);
    const pm = this.romanPast!.material as LineMaterial;
    pm.dashSize = Math.max(1e-4, past);
    pm.gapSize = 1e9;

    // Which station sees it, from the same Earth rotation the globe uses.
    let contact: RomanNow['contact'] = null;
    const sv = new THREE.Vector3();
    for (const st of STATIONS) {
      const e = geodeticToEci(st.lat, st.lon, 0, gmstRad);
      sv.set(e.x, e.y, e.z);
      const up = sv.clone().normalize();
      const elev = Math.asin(THREE.MathUtils.clamp(up.dot(rk.clone().sub(sv).normalize()), -1, 1));
      if (elev > MIN_ELEVATION && (!contact || elev > contact.elev)) contact = { st, elev };
    }
    this.roman = { draw, distKm: rk.length(), lightSec: rk.length() / C_KM_S, contact, extrapolated: now > r1 };

    const place = (id: string, v: THREE.Vector3 | null) => {
      const m = this.markers.get(id)!;
      m.visible = !!v;
      if (v) m.position.copy(v);
    };
    place('roman', draw);
    this.pulse.visible = true;
    const near = this.camera.position.distanceTo(draw) < SHOW_MODEL_WITHIN;
    if (this.model) {
      this.model.visible = near;
      this.modelShown = near;
      if (near) {
        this.model.position.copy(draw);
        // The sun shield on the Sun, as Roman always keeps it.
        const sun = positionAt(ds, 'sun', now);
        if (sun) {
          const toSun = toRender(sun.sub(rk)).normalize();
          this.model.quaternion.setFromUnitVectors(SUN_DIR, toSun);
          this.sunLight.position.copy(draw).addScaledVector(toSun, 5);
        }
        this.fill.position.copy(this.camera.position);
      }
      this.sunLight.visible = this.ambient.visible = this.fill.visible = near;
    }
    this.pulse.position.copy(draw);
    const ph = (this.clock % 2.4) / 2.4;
    this.pulse.scale.setScalar(0.02 + ph * 0.05);
    this.pulse.material.opacity = (this.modelShown ? 0.25 : 0.8) * (1 - ph);
    this.markers.get('roman')!.visible = !this.modelShown;
    const jw = positionAt(ds, 'jwst', now), eu = positionAt(ds, 'euclid', now), l2 = l2At(ds, now);
    place('jwst', jw && toRender(jw));
    place('euclid', eu && toRender(eu));
    place('l2', l2 && toRender(l2));

    // The downlink: dashes running from Roman down to the station.
    if (contact) {
      const e = geodeticToEci(contact.st.lat, contact.st.lon, 0, gmstRad);
      const gs = toRender(sv.set(e.x, e.y, e.z));
      (this.beam.geometry as LineGeometry).setPositions([draw.x, draw.y, draw.z, gs.x, gs.y, gs.z]);
      this.beam.computeLineDistances();
      this.beamMat.dashOffset -= dt * 60;
      this.beam.visible = true;
      this.labels.get('beam')!.at.copy(gs);
    } else {
      this.beam.visible = false;
    }

    // Labels.
    const L = this.labels;
    L.get('roman')!.at.copy(draw);
    (L.get('roman')!.el.lastElementChild as HTMLElement).textContent =
      ` · ${Math.round(rk.length()).toLocaleString('en-US')} km${now > r1 ? ' (predict ends)' : ''}${this.modelShown ? ' · shown ~60,000× actual size' : ''}`;
    if (jw) L.get('jwst')!.at.copy(toRender(jw));
    if (eu) L.get('euclid')!.at.copy(toRender(eu));
    if (l2) L.get('l2')!.at.copy(toRender(l2));
    const mRing = positionAt(ds, 'moon', now - 7 * DAY);
    if (mRing) L.get('moon')!.at.copy(toRender(mRing));
    (L.get('beam')!.el.firstElementChild as HTMLElement).textContent = contact ? `Ka-band downlink → ${contact.st.short}` : '';
    const show = new Map<string, boolean>([
      ['roman', true], ['jwst', !!jw], ['euclid', !!eu], ['l2', !!l2], ['moon', !!mRing], ['beam', !!contact],
    ]);
    // Far labels only once the camera is out far enough to make sense of them.
    const far = this.camera.position.length() > 60;
    for (const [id, lb] of L) {
      const want = show.get(id)! && (far || id === 'roman' || id === 'beam');
      const p = this.tmp.copy(lb.at).project(this.camera);
      const on = want && p.z < 1 && p.x > -1.05 && p.x < 1.05 && p.y > -1.05 && p.y < 1.05;
      if (on !== lb.on) { lb.el.style.display = on ? '' : 'none'; lb.on = on; }
      // Beside the enlarged model, not over it.
      const dx = id === 'roman' && this.modelShown ? 80 : 0;
      if (on) lb.el.style.translate = `${((p.x + 1) / 2) * w + dx}px ${((1 - p.y) / 2) * h}px`;
    }
    this.group.visible = true;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
    this.labelHost.style.display = v ? '' : 'none';
  }

  dispose() {
    this.group.traverse((o) => { if ((o as Line2).isLine2) (o as Line2).geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.labelHost.remove();
  }
}
