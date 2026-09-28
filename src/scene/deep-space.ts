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
import { RomanInOrbit, REST, type OrbitState } from './roman-orbit';

/** Within this many draw units of Roman, the observatory itself is drawn. */
export const SHOW_MODEL_WITHIN = 6;

/** What deep space shows this frame: the tracker's full view, or a moment of the story. */
export interface DeepView {
  /** Roman's flown track drawn up to this fraction of the way from launch to now, with Roman at its head. */
  trackTo: number;
  /** Opacity of every track, 0 … 1. */
  tracks: number;
  /** The Ka-band line down to the station, 0 … 1. */
  beam: number;
  /** Which far labels may show. */
  labels: ReadonlySet<string>;
  /** The observatory's state, and whether its names show. */
  model: OrbitState;
  modelTags: boolean;
}

export const TRACKER_VIEW: DeepView = {
  trackTo: 1, tracks: 1, beam: 1, labels: new Set(['roman', 'jwst', 'euclid', 'l2', 'moon', 'beam']), model: REST, modelTags: false,
};

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
  /** How far from Sun–Earth L2, km, and how fast Roman is moving relative to Earth, km/s. */
  l2Km: number | null;
  speedKmS: number;
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
  private romanPts: number[] = [];
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
  private builtWall = 0;
  /** The observatory itself, drawn when the camera is close. */
  readonly orbit: RomanInOrbit;
  private modelShown = false;
  private lastNow = Date.now();

  constructor(private camera: THREE.PerspectiveCamera, uiRoot: HTMLElement, renderer: THREE.WebGLRenderer) {
    this.group.name = 'deep-space';
    this.labelHost = document.createElement('div');
    Object.assign(this.labelHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.labelHost.className = 'deep-space-labels';
    uiRoot.prepend(this.labelHost);
    this.orbit = new RomanInOrbit(renderer, uiRoot);
    this.group.add(...this.orbit.objects);

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
    this.label('earth', 'Earth');
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
    this.orbit.load(this.camera).catch((e) => console.warn('[deep-space] Roman model unavailable', e));
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
    this.romanPts = rp;
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
    this.orbit.setLive(c);
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

  /** Roman on its drawn track at `t`, in the rotating frame the track is drawn in. */
  private onTrack(t: number, out = new THREE.Vector3()) {
    const ts = this.romanTimes, p = this.romanPts;
    if (!ts.length) return out.set(0, 0, 0);
    if (t <= ts[0]) return out.fromArray(p, 0);
    if (t >= ts[ts.length - 1]) return out.fromArray(p, (ts.length - 1) * 3);
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; }
    const u = (t - ts[lo]) / (ts[hi] - ts[lo]);
    return out.fromArray(p, lo * 3).lerp(this.tmp.fromArray(p, hi * 3), u);
  }

  /** Roman on its drawn track `frac` of the way from launch to now, in the globe's frame. */
  trackHead(frac: number, out = new THREE.Vector3()) {
    if (!this.ds) return out.set(0, 0, 0);
    const [r0, r1] = span(this.ds, 'roman');
    const now = Math.min(Math.max(this.lastNow, r0), r1);
    return this.onTrack(r0 + (now - r0) * THREE.MathUtils.clamp(frac, 0, 1), out);
  }

  /** When Roman first reached the Moon's mean distance, Unix ms, or null. */
  get moonCrossing(): number | null {
    if (!this.ds) return null;
    const [r0, r1] = span(this.ds, 'roman');
    for (let t = r0; t <= r1; t += 600_000) {
      const p = positionAt(this.ds, 'roman', t);
      if (p && p.length() >= 384_400) return t;
    }
    return null;
  }

  /**
   * `now` Unix ms (the app's clock), `gmstRad` Earth's rotation as the globe
   * draws it, `w`/`h` the canvas size in CSS px; `view` what to show.
   */
  update(now: number, gmstRad: number, dt: number, w: number, h: number, view: DeepView = TRACKER_VIEW) {
    const ds = this.ds;
    if (!ds) return;
    this.lastNow = now;
    // Re-anchor the rotating frame every two hours of clock time, but no more
    // than four times a second of wall time, so a time warp stays smooth.
    if (Math.abs(now - this.builtAt) > 2 * 3_600_000 && (this.builtAt === -Infinity || performance.now() - this.builtWall > 250)) {
      this.rebuild(now);
      this.builtWall = performance.now();
    }
    for (const m of this.mats) m.resolution.set(w, h);
    this.clock += dt;

    // Roman, held at the end of the predict if the clock runs past it.
    const [r0, r1] = span(ds, 'roman');
    const tt = Math.min(Math.max(now, r0), r1);
    const rk = positionAt(ds, 'roman', tt)!;
    const draw = toRender(rk);
    // The journey so far, drawn up to a moment between launch and now.
    const journey = view.trackTo < 0.999;
    const tHead = r0 + (tt - r0) * THREE.MathUtils.clamp(view.trackTo, 0, 1);
    const head = journey ? this.onTrack(tHead) : draw;
    const pm = this.romanPast!.material as LineMaterial;
    pm.dashSize = Math.max(1e-4, this.pastLength(journey ? tHead : now));
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
    const l2 = l2At(ds, now);
    const ra = positionAt(ds, 'roman', Math.max(r0, tt - 60_000)), rb = positionAt(ds, 'roman', Math.min(r1, tt + 60_000));
    const dtS = (Math.min(r1, tt + 60_000) - Math.max(r0, tt - 60_000)) / 1000;
    this.roman = {
      draw, distKm: rk.length(), lightSec: rk.length() / C_KM_S, contact, extrapolated: now > r1,
      l2Km: l2 ? rk.distanceTo(l2) : null, speedKmS: ra && rb && dtS > 0 ? ra.distanceTo(rb) / dtS : 0,
    };

    const place = (id: string, v: THREE.Vector3 | null) => {
      const m = this.markers.get(id)!;
      m.visible = !!v;
      if (v) m.position.copy(v);
    };
    place('roman', head);
    this.pulse.visible = true;
    const near = this.camera.position.distanceTo(draw) < SHOW_MODEL_WITHIN;
    this.modelShown = near && !!this.orbit.model;
    this.orbit.visible = near;
    const sun = positionAt(ds, 'sun', now);
    this.orbit.update({
      draw, toSun: sun ? toRender(sun.sub(rk)).normalize() : new THREE.Vector3(1, 0, 0),
      toEarth: this.tmp.copy(draw).negate().normalize().clone(),
      camera: this.camera, dt, w, h, showTags: view.modelTags && this.modelShown, state: view.model,
    });
    this.pulse.position.copy(head);
    const ph = (this.clock % 2.4) / 2.4;
    this.pulse.scale.setScalar(0.02 + ph * 0.05);
    this.pulse.material.opacity = (this.modelShown ? 0 : 0.8) * (1 - ph);
    this.markers.get('roman')!.visible = !this.modelShown;
    const jw = positionAt(ds, 'jwst', now), eu = positionAt(ds, 'euclid', now);
    place('jwst', jw && toRender(jw));
    place('euclid', eu && toRender(eu));
    place('l2', l2 && toRender(l2));

    // The downlink: dashes running from Roman down to the station.
    if (contact && view.beam > 0.01) {
      const e = geodeticToEci(contact.st.lat, contact.st.lon, 0, gmstRad);
      const gs = toRender(sv.set(e.x, e.y, e.z));
      // From the dish's feed when the observatory is drawn, so the stream
      // leaving the antenna runs on unbroken down to the station.
      const from = this.modelShown ? this.orbit.feedWorld() : draw;
      (this.beam.geometry as LineGeometry).setPositions([from.x, from.y, from.z, gs.x, gs.y, gs.z]);
      this.beam.computeLineDistances();
      this.beamMat.dashOffset -= dt * 60;
      this.beamMat.opacity = 0.95 * view.beam;
      this.beam.visible = true;
      this.labels.get('beam')!.at.copy(gs);
    } else {
      this.beam.visible = false;
    }

    // Tracks, as strong as the view wants them.
    const k = view.tracks;
    const tf = this.romanTrack?.material as LineMaterial | undefined, tp = this.romanPast?.material as LineMaterial | undefined;
    if (tf) tf.opacity = 0.45 * k;
    if (tp) tp.opacity = 0.95 * k;
    for (const t of this.tracks) (t.material as LineMaterial).opacity = 0.38 * k;
    if (this.moonRing) (this.moonRing.material as LineMaterial).opacity = 0.22 * k;

    // Labels.
    const L = this.labels;
    L.get('roman')!.at.copy(head);
    const hk = journey ? positionAt(ds, 'roman', tHead)!.length() : rk.length();
    (L.get('roman')!.el.lastElementChild as HTMLElement).textContent = journey
      ? ` · day ${Math.max(0, Math.floor((tHead - r0) / DAY))} · ${Math.round(hk).toLocaleString('en-US')} km`
      : ` · ${Math.round(hk).toLocaleString('en-US')} km${now > r1 ? ' (predict ends)' : ''}`;
    if (jw) L.get('jwst')!.at.copy(toRender(jw));
    if (eu) L.get('euclid')!.at.copy(toRender(eu));
    if (l2) L.get('l2')!.at.copy(toRender(l2));
    const mRing = positionAt(ds, 'moon', now - 7 * DAY);
    if (mRing) L.get('moon')!.at.copy(toRender(mRing));
    (L.get('beam')!.el.firstElementChild as HTMLElement).textContent = contact ? `Ka-band downlink → ${contact.st.short}` : '';
    (L.get('earth')!.el.lastElementChild as HTMLElement).textContent = ` · ${Math.round(rk.length()).toLocaleString('en-US')} km away`;
    const has = new Map<string, boolean>([
      ['roman', !this.modelShown], ['jwst', !!jw], ['euclid', !!eu], ['l2', !!l2], ['moon', !!mRing],
      ['beam', !!contact && view.beam > 0.5], ['earth', true],
    ]);
    // Far labels only once the camera is out far enough to make sense of them.
    const far = this.camera.position.length() > 60;
    for (const [id, lb] of L) {
      const want = view.labels.has(id) && has.get(id)! && (far || id === 'roman' || id === 'beam');
      const p = this.tmp.copy(lb.at).project(this.camera);
      const on = want && p.z < 1 && p.x > -1.05 && p.x < 1.05 && p.y > -1.05 && p.y < 1.05;
      if (on !== lb.on) { lb.el.style.display = on ? '' : 'none'; lb.on = on; }
      if (on) lb.el.style.translate = `${((p.x + 1) / 2) * w}px ${((1 - p.y) / 2) * h}px`;
    }
    this.group.visible = true;
  }

  /** The Sun's direction from a point, in the globe's frame, at the clock's last update. */
  sunDirAt(from: THREE.Vector3): THREE.Vector3 {
    const sun = this.ds ? positionAt(this.ds, 'sun', this.lastNow) : null;
    return sun ? toRender(sun).sub(from).normalize() : new THREE.Vector3(1, 0, 0);
  }

  /** Roman's render-frame position at `t` (clamped to the published predict), or null before loading. */
  romanDrawAt(t: number): THREE.Vector3 | null {
    if (!this.ds) return null;
    const [r0, r1] = span(this.ds, 'roman');
    const p = positionAt(this.ds, 'roman', Math.min(Math.max(t, r0), r1));
    return p && toRender(p);
  }

  /** When Roman's published track begins, Unix ms. */
  get romanStart(): number | null {
    return this.ds ? span(this.ds, 'roman')[0] : null;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
    this.labelHost.style.display = v ? '' : 'none';
  }

  dispose() {
    this.group.traverse((o) => { if ((o as Line2).isLine2) (o as Line2).geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.orbit.dispose();
    this.labelHost.remove();
  }
}
