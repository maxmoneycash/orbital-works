/**
 * The light path, drawn through the model's own mirrors.
 *
 * Roman is a three-mirror anastigmat. In NASA's order: the primary gathers
 * the light and sends it up to the secondary, which returns it down through
 * the baffle in the primary's centre to fold mirror 1; the beam comes to an
 * intermediate focus, folds again at fold mirror 2, and the concave tertiary
 * forms the image, through one slot of the element wheel, on the Wide Field
 * Instrument's detectors. A pick-off mirror under the metering structure takes
 * part of the beam for the coronagraph.
 *
 * Positions come from the same dimension store and part bounds the model was
 * built from, so the rays hit the meshes rather than a separate diagram. The
 * route between the aft optics and the instruments is schematic: the packaging
 * there is estimated.
 */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { num } from './dims';
import { boundsOf, type RomanModel } from './model';

/** `s` is metres from the aperture along the reference ray; `back`, metres from its focal-plane end. */
export interface Stop { id: string; label: string; s: number; back: number }

const centre = (m: THREE.Object3D | undefined, fallback: THREE.Vector3) =>
  m ? boundsOf([m]).getCenter(new THREE.Vector3()) : fallback.clone();

export class LightPath {
  readonly group = new THREE.Group();
  readonly stops: Stop[] = [];
  readonly cgiStops: Stop[] = [];
  /** Where each stop sits in the world, for labels. */
  readonly stopPoints: THREE.Vector3[] = [];
  readonly cgiStopPoints: THREE.Vector3[] = [];
  length = 1;
  private trail: LineMaterial;
  private pulse: LineMaterial;
  private cgiTrail: LineMaterial;
  private cgiPulse: LineMaterial;
  private cgiGroup = new THREE.Group();
  private pulseS = 0;

  constructor(model: RomanModel) {
    this.group.name = 'light-path';
    const mat = (color: number, width: number, opacity: number) => new LineMaterial({
      color, linewidth: width, transparent: true, opacity, dashed: true,
      dashSize: 0, gapSize: 1e5, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.trail = mat(0xdde9ff, 1.3, 0.34);
    this.pulse = mat(0xffffff, 2.6, 1);
    this.cgiTrail = mat(0x44ff44, 1.3, 0.4);
    this.cgiPulse = mat(0xb8ffb8, 2.6, 1);

    const pmY = num('PM_Z'), R = num('PM_ROC'), smY = num('SM_Z');
    const amsBottom = pmY - num('PM_BIPOD_LEN') - num('AMS_THICK');
    const focus = new THREE.Vector3(0, pmY + R / 2, 0);
    const hole = new THREE.Vector3(0, pmY - 0.08, 0);
    void amsBottom;
    const P = (p: string) => model.byPart.get(p);
    const fm1 = centre(P('AOM.FM1'), new THREE.Vector3(0.22, 4.15, 0));
    const fm2 = centre(P('AOM.FM2'), new THREE.Vector3(-0.1, 4.15, -0.14));
    const tm = centre(P('AOM.Tertiary'), new THREE.Vector3(0, 4.15, 0.16));
    const fp = boundsOf(model.detectors).getCenter(new THREE.Vector3());
    fp.y += 0.01;
    const wheel = centre(P('WFI.Element.1'), fp.clone().setY(fp.y + 0.22));
    const ifocus = fm1.clone().lerp(fm2, 0.5).setY(Math.min(fm1.y, fm2.y) - 0.04);
    const ttf = centre(P('TOMA.TipTiltFlat'), new THREE.Vector3(-0.1, 3.94, -0.72));
    const poma = centre(P('POMA.FoldFlat'), new THREE.Vector3(0, 4.59, -0.62));
    const m3 = centre(P('TOMA.M3'), new THREE.Vector3(0.1, 4.2, -0.72));
    const m4 = centre(P('TOMA.M4'), new THREE.Vector3(0, 4.12, -0.72));
    const m5 = centre(P('TOMA.M5'), new THREE.Vector3(-0.1, 4.04, -0.72));
    const cgi = centre(P('CGI.Body'), new THREE.Vector3(-0.8, 3.95, 0.25));

    const spread = (th: number, k: number, at: THREE.Vector3) =>
      at.clone().add(new THREE.Vector3(Math.cos(th) * k, 0, Math.sin(th) * k));
    const top = 14.6;
    const inbound = (r: number, th: number) => {
      const x = r * Math.cos(th), z = r * Math.sin(th);
      const p0 = new THREE.Vector3(x, top, z);
      const p1 = new THREE.Vector3(x, pmY + (r * r) / (2 * R), z);
      const t = (smY - 0.02 - p1.y) / (focus.y - p1.y);
      const p2 = p1.clone().lerp(focus, t);
      return [p0, p1, p2, spread(th, 0.07, hole)];
    };

    let seed = 7;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2.6;
    const addRay = (pts: THREE.Vector3[], trail: LineMaterial, pulse: LineMaterial, into: THREE.Group) => {
      const flat = (list: THREE.Vector3[]) => list.flatMap((p) => [p.x, p.y, p.z]);
      const geo = new LineGeometry();
      geo.setPositions(flat(pts));
      // The photon stream gets a random lead-in above the aperture, so the
      // dashes, driven by one shared uniform, fall out of step ray to ray.
      const pgeo = new LineGeometry();
      pgeo.setPositions(flat([pts[0].clone().setY(pts[0].y + jitter()), ...pts]));
      for (const [g, m] of [[geo, trail], [pgeo, pulse]] as const) {
        const line = new Line2(g, m);
        line.computeLineDistances();
        line.renderOrder = 10;
        line.frustumCulled = false;
        into.add(line);
      }
      // The trail is revealed from the aperture in, the way the light
      // travels, so scrolling pushes the light through the telescope.
      let s = 0;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push((s += pts[i].distanceTo(pts[i - 1])));
      return cum;
    };

    let ref: number[] = [];
    for (const [ri, r] of [0.6, 1.0].entries()) {
      for (let k = 0; k < 8; k++) {
        const th = (k / 8) * Math.PI * 2 + ri * 0.4;
        const pts = [
          ...inbound(r, th),
          spread(th, 0.03, fm1), ifocus.clone(), spread(th, 0.03, fm2), spread(th, 0.07, tm),
          spread(th, 0.03, wheel), spread(th, 0.12, fp),
        ];
        const cum = addRay(pts, this.trail, this.pulse, this.group);
        if (ri === 1 && k === 0) { ref = cum; this.stopPoints.push(...pts.map((p) => p.clone())); }
      }
    }
    this.length = ref[ref.length - 1];
    const names = ['Aperture', 'Primary mirror', 'Secondary mirror', 'Through the primary', 'Fold mirror 1',
      'Intermediate focus', 'Fold mirror 2', 'Tertiary mirror', 'Element wheel', 'Focal plane'];
    const ids = ['aperture', 'pm', 'sm', 'hole', 'fm1', 'if', 'fm2', 'tm', 'wheel', 'fp'];
    ref.forEach((s, i) => this.stops.push({ id: ids[i], label: names[i], s, back: this.length - s }));

    for (let k = 0; k < 6; k++) {
      const th = (k / 6) * Math.PI * 2;
      const pts = [...inbound(0.8, th), spread(th, 0.03, poma), spread(th, 0.01, m3), spread(th, 0.01, m4),
        spread(th, 0.01, m5), spread(th, 0.01, ttf), spread(th, 0.03, cgi)];
      const cum = addRay(pts, this.cgiTrail, this.cgiPulse, this.cgiGroup);
      if (k === 0) {
        const cn = ['Pick-off mirror', 'Collimator M3', 'Collimator M4', 'Collimator M5', 'Tip/tilt flat', 'Coronagraph'];
        const end = cum[cum.length - 1];
        cum.slice(4).forEach((s, i) => this.cgiStops.push({ id: `cgi${i}`, label: cn[i], s, back: end - s }));
        this.cgiStopPoints.push(...pts.slice(4).map((p) => p.clone()));
      }
    }
    this.group.add(this.cgiGroup);
    this.set(0, false, 0);
  }

  /** A point `s` metres along the reference ray from the aperture: where the light's front is. */
  at(s: number, out = new THREE.Vector3()) {
    const P = this.stopPoints, S = this.stops;
    if (!P.length) return out.set(0, 0, 0);
    if (s <= S[0].s) return out.copy(P[0]).lerp(P[1] ?? P[0], 0).setY(P[0].y + (S[0].s - s));
    for (let i = 1; i < S.length; i++) {
      if (s <= S[i].s) return out.copy(P[i - 1]).lerp(P[i], (s - S[i - 1].s) / Math.max(1e-6, S[i].s - S[i - 1].s));
    }
    return out.copy(P[P.length - 1]);
  }

  /** Tint the coronagraph's light with the theme's live colour. */
  setLive(c: THREE.Color) {
    this.cgiTrail.color.copy(c);
    this.cgiPulse.color.copy(c).lerp(new THREE.Color(0xffffff), 0.6);
  }

  setResolution(w: number, h: number) {
    for (const m of [this.trail, this.pulse, this.cgiTrail, this.cgiPulse]) m.resolution.set(w, h);
  }

  /**
   * `progress`: metres of path revealed from the aperture in; `length` or
   * more shows every ray whole. `opacity` fades the whole path.
   */
  set(progress: number, cgi: boolean, opacity: number) {
    this.group.visible = opacity > 0.001;
    this.cgiGroup.visible = cgi;
    // Whole rays can be longer than the reference ray; don't clip their tops.
    this.trail.dashSize = this.cgiTrail.dashSize = progress >= this.length - 1e-3 ? 1e4 : Math.max(0.0001, progress);
    this.trail.opacity = 0.34 * opacity;
    this.cgiTrail.opacity = 0.42 * opacity;
    this.pulse.opacity = this.cgiPulse.opacity = opacity;
  }

  /** Photons stream along the path, aperture to detectors, once it is complete. */
  tick(dt: number, progress: number, strength = 1) {
    const complete = progress >= this.length - 0.02 && strength > 0.01;
    const period = 2.6;
    this.pulseS = (this.pulseS + dt * 3.4) % period;
    for (const m of [this.pulse, this.cgiPulse]) {
      m.visible = complete;
      m.dashSize = 0.4;
      m.gapSize = period - 0.4;
      m.dashOffset = -this.pulseS;
      m.opacity = Math.min(m.opacity, strength);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const l = o as Line2;
      if (l.isLine2) l.geometry.dispose();
    });
    for (const m of [this.trail, this.pulse, this.cgiTrail, this.cgiPulse]) m.dispose();
  }
}
