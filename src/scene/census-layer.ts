/**
 * The orbital census: every object CelesTrak's catalogue lists in Earth orbit,
 * drawn around the globe, coloured by family (payload, rocket, unknown) and
 * sized by kind (intact objects larger, debris smaller and fainter).
 *
 * The catalogue gives each object's perigee, apogee and inclination, but not
 * where along its orbit it is or how that orbit is turned about the pole. So
 * those two angles are drawn from the object's catalogue number: the height,
 * shape and tilt of every orbit are real; its place in the sky is not. Each
 * dot moves along its orbit at its real period, solved on the GPU.
 *
 * Data: public/data/census.json, from scripts/census/build_census.py.
 */
import * as THREE from 'three';
import { DRAW_SCALE, EARTH_RADIUS_KM } from '../constants';

export const CENSUS_TYPES = ['payload', 'payload-debris', 'rocket-body', 'rocket-debris', 'debris', 'unknown'] as const;
export type CensusType = (typeof CENSUS_TYPES)[number];
/** Colour family of each type: 0 payload, 1 rocket, 2 unknown. */
export const FAMILY_OF: number[] = [0, 0, 1, 1, 2, 2];
export const FAMILY_COLORS = ['#24a5ab', '#d07843', '#b9448e'];
const DEBRIS = new Set([1, 3, 4]);

/** Orbit regimes, by perigee and apogee (km). */
export const REGIMES = [
  { id: 'leo', name: 'Low Earth orbit', range: 'below 2,000 km', maxKm: 2000 },
  { id: 'meo', name: 'Medium Earth orbit', range: '2,000 to 35,586 km', maxKm: 35586 },
  { id: 'geo', name: 'Geostationary belt', range: '35,786 km, ±200', maxKm: 35986 },
  { id: 'high', name: 'Beyond geostationary', range: 'above 35,986 km', maxKm: 60000 },
  { id: 'ecc', name: 'Stretched orbits', range: 'crossing these, like transfer orbits', maxKm: 60000 },
] as const;
export function regimeOf(pe: number, ap: number): number {
  if (ap < 2000) return 0;
  if (pe >= 2000 && ap < 35586) return 1;
  if (pe >= 35586 && ap <= 35986) return 2;
  if (pe >= 35586) return 3;
  return 4;
}

export interface CensusData {
  source: string; generatedAt: string; types: string[]; count: number;
  t: number[]; pe: number[]; ap: number[]; inc: number[]; id: number[]; yr: number[]; ok: number[]; name: string[];
}

export interface CensusPick {
  index: number; name: string; norad: number; type: CensusType; working: boolean;
  perigeeKm: number; apogeeKm: number; inclinationDeg: number; launchYear: number; regime: number;
  /** Screen position of the dot, CSS px. */
  x: number; y: number;
}

const MU = 398600.4418; // km^3/s^2

/** A stable fraction in [0, 1) from an integer, for the angles the catalogue doesn't give. */
function hash01(n: number, salt: number) {
  let h = (n * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const VERT = /* glsl */ `
  attribute vec4 el0;   // a (draw units), e, i, raan
  attribute vec4 el1;   // argp, mean anomaly at the reference, mean motion (rad/s), type + 8 * regime
  uniform float uT;     // seconds since the reference
  uniform float uPixel;
  uniform float uSize;
  uniform float uTypeOn[6];
  uniform float uRegimeOn[5];
  uniform float uAny;
  uniform vec3 uColors[3];
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = el0.x, e = el0.y, inc = el0.z, raan = el0.w;
    float argp = el1.x, n = el1.z;
    int code = int(el1.w + 0.5);
    int type = code - (code / 8) * 8;
    int regime = code / 8;
    float M = mod(el1.y + n * uT, 6.2831853);
    float E = e < 0.8 ? M : 3.1415927;
    for (int k = 0; k < 7; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    float xp = a * (cos(E) - e);
    float yp = a * sqrt(max(0.0, 1.0 - e * e)) * sin(E);
    float cO = cos(raan), sO = sin(raan), cw = cos(argp), sw = sin(argp), ci = cos(inc), si = sin(inc);
    vec3 eci = vec3(
      xp * (cO * cw - sO * sw * ci) - yp * (cO * sw + sO * cw * ci),
      xp * (sO * cw + cO * sw * ci) + yp * (cO * cw * ci - sO * sw),
      xp * (sw * si) + yp * (cw * si));
    vec3 p = vec3(eci.x, eci.z, -eci.y);   // ECI to the globe's frame
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    bool debris = type == 1 || type == 3 || type == 4;
    int fam = type < 2 ? 0 : type < 4 ? 1 : 2;
    vColor = fam == 0 ? uColors[0] : fam == 1 ? uColors[1] : uColors[2];
    float on = uTypeOn[type] * uRegimeOn[regime];
    vAlpha = (debris ? 0.55 : 0.9) * (on > 0.5 ? 1.0 : (uAny > 0.5 ? 0.05 : 1.0));
    // Low orbit is a thin, crowded shell: seen from far out it would cover
    // Earth entirely. There it becomes a haze, sharpening as you close in.
    float far = smoothstep(14.0, 48.0, length(cameraPosition));
    if (regime == 0) vAlpha *= mix(1.0, 0.3, far);
    float depth = clamp(30.0 / -mv.z, 0.55, 1.6);
    gl_PointSize = uSize * uPixel * (debris ? 0.62 : 1.0) * depth * (on > 0.5 || uAny < 0.5 ? 1.0 : 0.7)
      * (regime == 0 ? mix(1.0, 0.7, far) : 1.0);
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.18, r);
    gl_FragColor = vec4(vColor * (0.85 + 0.35 * smoothstep(0.3, 0.0, r)), vAlpha * soft);
  }
`;

export class CensusLayer {
  readonly group = new THREE.Group();
  data: CensusData | null = null;
  regimes: Uint8Array = new Uint8Array(0);
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private el0 = new Float32Array(0);
  private el1 = new Float32Array(0);
  private refMs = 0;
  private labelHost: HTMLDivElement;
  private rings: { mesh: THREE.LineLoop; label: HTMLDivElement; km: number }[] = [];
  private typeOn = new Array(6).fill(1);
  private regimeOn = new Array(5).fill(1);
  private tmp = new THREE.Vector3();
  private loading: Promise<void> | null = null;
  /** The chosen object, ringed as it moves; and the name under a mouse. */
  marked: number | null = null;
  private ring: HTMLDivElement;
  private hoverTip: HTMLDivElement;

  constructor(uiRoot: HTMLElement) {
    this.group.visible = false;
    this.group.renderOrder = 3;
    this.labelHost = document.createElement('div');
    this.labelHost.className = 'census-rings';
    Object.assign(this.labelHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', display: 'none', zIndex: '40' });
    uiRoot.prepend(this.labelHost);
    this.ring = document.createElement('div');
    Object.assign(this.ring.style, {
      position: 'absolute', left: '-9px', top: '-9px', width: '18px', height: '18px', borderRadius: '50%',
      border: '1.5px solid #f2f1ec', boxShadow: '0 0 0 3px rgba(0,0,0,0.55)', display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.hoverTip = document.createElement('div');
    Object.assign(this.hoverTip.style, {
      position: 'absolute', left: '0', top: '0', padding: '3px 7px', whiteSpace: 'nowrap', display: 'none',
      font: '500 11px/15px "Overpass Mono", ui-monospace, monospace', color: '#f2f1ec',
      background: 'rgba(0,0,0,0.72)', borderLeft: '1px solid rgba(242,241,236,0.5)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.labelHost.append(this.ring, this.hoverTip);
    // Reference rings in the equatorial plane: where low orbit ends, GPS, and the geostationary belt.
    for (const [km, text] of [[2000, '2,000 km · low orbit ends'], [20200, 'GPS · 20,200 km'], [35786, 'Geostationary · 35,786 km']] as const) {
      const r = (EARTH_RADIUS_KM + km) / DRAW_SCALE;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 256; k++) { const a = (k / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      const mesh = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xf2f1ec, transparent: true, opacity: 0.14, depthWrite: false }));
      this.group.add(mesh);
      const label = document.createElement('div');
      label.textContent = text;
      Object.assign(label.style, {
        position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', font: '500 11px/14px "Overpass Mono", ui-monospace, monospace',
        color: 'rgba(242,241,236,0.62)', textShadow: '0 1px 8px #000, 0 0 2px #000',
      } satisfies Partial<CSSStyleDeclaration>);
      this.labelHost.append(label);
      this.rings.push({ mesh, label, km });
    }
  }

  /** Load the snapshot once; later calls share the same promise. */
  load(): Promise<void> {
    this.loading ??= fetch(`${import.meta.env.BASE_URL}data/census.json`)
      .then((r) => { if (!r.ok) throw new Error(`census ${r.status}`); return r.json() as Promise<CensusData>; })
      .then((d) => this.build(d))
      .catch((e) => { this.loading = null; throw e; });
    return this.loading;
  }

  private build(d: CensusData) {
    this.data = d;
    const n = d.count;
    this.el0 = new Float32Array(n * 4);
    this.el1 = new Float32Array(n * 4);
    this.regimes = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const pe = d.pe[k], ap = d.ap[k];
      const rp = EARTH_RADIUS_KM + pe, ra = EARTH_RADIUS_KM + ap;
      const aKm = (rp + ra) / 2;
      const e = (ra - rp) / (ra + rp);
      const reg = regimeOf(pe, ap);
      this.regimes[k] = reg;
      this.el0.set([aKm / DRAW_SCALE, e, (d.inc[k] / 100) * (Math.PI / 180), hash01(d.id[k], 1) * Math.PI * 2], k * 4);
      this.el1.set([hash01(d.id[k], 2) * Math.PI * 2, hash01(d.id[k], 3) * Math.PI * 2, Math.sqrt(MU / aKm ** 3), d.t[k] + 8 * reg], k * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('el0', new THREE.BufferAttribute(this.el0, 4));
    g.setAttribute('el1', new THREE.BufferAttribute(this.el1, 4));
    // Orbits reach past the geostationary belt; nothing culls them by their unused positions.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      // Normal blending: 23,000 low-orbit dots added together would glow white
      // (and bloom), hiding Earth and every dot's colour.
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: {
        uT: { value: 0 }, uPixel: { value: Math.min(devicePixelRatio, 2) }, uSize: { value: 3.2 },
        uTypeOn: { value: this.typeOn }, uRegimeOn: { value: this.regimeOn }, uAny: { value: 0 },
        uColors: { value: FAMILY_COLORS.map((c) => new THREE.Color(c)) },
      },
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** Show only these types and regimes (null: all). Everything else stays as a faint trace. */
  setFilter(types: number[] | null, regimes: number[] | null) {
    for (let k = 0; k < 6; k++) this.typeOn[k] = !types || types.includes(k) ? 1 : 0;
    for (let k = 0; k < 5; k++) this.regimeOn[k] = !regimes || regimes.includes(k) ? 1 : 0;
    if (this.material) this.material.uniforms.uAny.value = types || regimes ? 1 : 0;
  }

  /** Seconds since the reference, rebased now and then so float32 keeps its precision. */
  private since(ms: number) {
    if (!this.refMs) this.refMs = ms;
    let dt = (ms - this.refMs) / 1000;
    if (Math.abs(dt) > 40000) {
      for (let k = 0; k < (this.data?.count ?? 0); k++) {
        const o = k * 4 + 1;
        this.el1[o] = (this.el1[o] + this.el1[k * 4 + 2] * dt) % (Math.PI * 2);
      }
      const attr = this.points?.geometry.getAttribute('el1') as THREE.BufferAttribute | undefined;
      if (attr) attr.needsUpdate = true;
      this.refMs = ms;
      dt = 0;
    }
    return dt;
  }

  /** Name the dot under a mouse, or clear it. */
  setHover(p: CensusPick | null) {
    if (!p) { this.hoverTip.style.display = 'none'; return; }
    this.hoverTip.textContent = p.name;
    this.hoverTip.style.display = '';
    this.hoverTip.style.translate = `${p.x + 12}px ${p.y - 22}px`;
  }

  update(ms: number, camera: THREE.PerspectiveCamera, w: number, h: number) {
    const on = this.group.visible;
    this.labelHost.style.display = on ? '' : 'none';
    if (!on) return;
    if (this.material) this.material.uniforms.uT.value = this.since(ms);
    // The ring follows its object round its orbit.
    if (this.marked != null && this.data) {
      const q = this.positionOf(this.marked, ms, this.tmp).project(camera);
      const x = ((q.x + 1) / 2) * w, y = ((1 - q.y) / 2) * h;
      const seen = q.z < 1 && x > -20 && x < w + 20 && y > -20 && y < h + 20;
      this.ring.style.display = seen ? '' : 'none';
      if (seen) this.ring.style.translate = `${x}px ${y}px`;
    } else this.ring.style.display = 'none';
    // Each ring is named at its nearest point, just below the line: the
    // rings nest, so those points never meet.
    const front = this.tmp.set(camera.position.x, 0, camera.position.z);
    if (front.lengthSq() < 1e-6) front.set(0, 0, 1);
    front.normalize();
    for (const ring of this.rings) {
      const r = (EARTH_RADIUS_KM + ring.km) / DRAW_SCALE;
      const q = new THREE.Vector3().copy(front).multiplyScalar(r).project(camera);
      const x = ((q.x + 1) / 2) * w, y = ((1 - q.y) / 2) * h;
      const lw = ring.label.offsetWidth || 120;
      // clear of the dock and the phone's navigation along the bottom
      const shown = q.z < 1 && y > 20 && y < h - 96;
      ring.label.style.display = shown ? '' : 'none';
      if (shown) ring.label.style.translate = `${Math.max(8, Math.min(w - lw - 8, x - lw / 2))}px ${y + 4}px`;
    }
  }

  /** Where object `k` is now, in the globe's frame. */
  positionOf(k: number, ms: number, out = new THREE.Vector3()) {
    const [a, e, inc, raan] = this.el0.subarray(k * 4, k * 4 + 4);
    const [argp, m0, n] = this.el1.subarray(k * 4, k * 4 + 3);
    const t = (ms - this.refMs) / 1000;
    const M = (((m0 + n * t) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 7; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cO = Math.cos(raan), sO = Math.sin(raan), cw = Math.cos(argp), sw = Math.sin(argp), ci = Math.cos(inc), si = Math.sin(inc);
    const x = xp * (cO * cw - sO * sw * ci) - yp * (cO * sw + sO * cw * ci);
    const y = xp * (sO * cw + cO * sw * ci) + yp * (cO * cw * ci - sO * sw);
    const z = xp * (sw * si) + yp * (cw * si);
    return out.set(x, z, -y);
  }

  /**
   * The nearest shown dot to a screen point, within `reach` CSS px, that
   * Earth isn't hiding. Dimmed (filtered-out) dots are not picked.
   */
  pick(sx: number, sy: number, reach: number, ms: number, camera: THREE.PerspectiveCamera, w: number, h: number): CensusPick | null {
    const d = this.data;
    if (!d || !this.group.visible) return null;
    const anyFilter = this.typeOn.includes(0) || this.regimeOn.includes(0);
    const cam = camera.position;
    const re = EARTH_RADIUS_KM / DRAW_SCALE;
    const p = new THREE.Vector3(), ray = new THREE.Vector3();
    let best = -1, bestD2 = reach * reach, bx = 0, by = 0;
    for (let k = 0; k < d.count; k++) {
      if (anyFilter && !(this.typeOn[d.t[k]] && this.regimeOn[this.regimes[k]])) continue;
      this.positionOf(k, ms, p);
      const q = this.tmp.copy(p).project(camera);
      if (q.z > 1) continue;
      const x = ((q.x + 1) / 2) * w, y = ((1 - q.y) / 2) * h;
      const dx = x - sx, dy = y - sy, d2 = dx * dx + dy * dy;
      if (d2 >= bestD2) continue;
      // hidden behind Earth?
      ray.copy(p).sub(cam);
      const len = ray.length(); ray.divideScalar(len);
      const b = cam.dot(ray), c = cam.lengthSq() - re * re, disc = b * b - c;
      if (disc > 0 && -b - Math.sqrt(disc) > 0 && -b - Math.sqrt(disc) < len) continue;
      best = k; bestD2 = d2; bx = x; by = y;
    }
    if (best < 0) return null;
    return {
      index: best, name: d.name[best], norad: d.id[best], type: CENSUS_TYPES[d.t[best]], working: !!d.ok[best],
      perigeeKm: d.pe[best], apogeeKm: d.ap[best], inclinationDeg: d.inc[best] / 100, launchYear: d.yr[best],
      regime: this.regimes[best], x: bx, y: by,
    };
  }

  /** Counts by type (rows) and regime (columns). */
  table(): number[][] {
    const out = CENSUS_TYPES.map(() => REGIMES.map(() => 0));
    const d = this.data;
    if (!d) return out;
    for (let k = 0; k < d.count; k++) out[d.t[k]][this.regimes[k]]++;
    return out;
  }

  get working() { return this.data ? this.data.ok.reduce((a, b) => a + b, 0) : 0; }
  isDebris(type: number) { return DEBRIS.has(type); }

  dispose() {
    this.points?.geometry.dispose();
    this.material?.dispose();
    for (const r of this.rings) { r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); }
    this.labelHost.remove();
  }
}
