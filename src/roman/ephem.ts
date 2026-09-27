/**
 * Deep-space ephemerides baked from JPL Horizons by
 * scripts/roman/fetch_ephem.py: geocentric positions in the ICRF equatorial
 * frame, in km, sampled at a fixed step per body.
 *
 * Roman's published predict runs from just after launch to wherever Horizons'
 * current solution ends (19 Oct 2026 at the last fetch); outside that span
 * `positionAt` returns null rather than inventing a track.
 */
import * as THREE from 'three';

export type BodyName = 'roman' | 'jwst' | 'euclid' | 'moon' | 'sun';

interface Series { horizons: string; t0: number; step: number; n: number; xyz: number[] }
export interface DeepSpace {
  source: string;
  frame: string;
  fetched: string;
  bodies: Record<BodyName, Series>;
}

let pending: Promise<DeepSpace> | null = null;

/** Load once, on first use. */
export function loadDeepSpace(): Promise<DeepSpace> {
  pending ??= fetch('/data/deep-space.json').then((r) => {
    if (!r.ok) throw new Error(`deep-space.json: ${r.status}`);
    return r.json() as Promise<DeepSpace>;
  });
  return pending;
}

export function span(ds: DeepSpace, body: BodyName): [number, number] {
  const s = ds.bodies[body];
  return [s.t0, s.t0 + (s.n - 1) * s.step * 1000];
}

/**
 * Position at `t` (Unix ms), km, by Catmull-Rom through the samples; null
 * outside the published span.
 */
export function positionAt(ds: DeepSpace, body: BodyName, t: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  const s = ds.bodies[body];
  const x = (t - s.t0) / (s.step * 1000);
  if (!(x >= 0 && x <= s.n - 1)) return null;
  const i = Math.min(s.n - 2, Math.floor(x)), u = x - i;
  const at = (k: number, c: number) => s.xyz[Math.max(0, Math.min(s.n - 1, k)) * 3 + c];
  const cr = (c: number) => {
    const p0 = at(i - 1, c), p1 = at(i, c), p2 = at(i + 1, c), p3 = at(i + 2, c);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
  return out.set(cr(0), cr(1), cr(2));
}

/** Every sample of a body between two times, km, for drawing its track. */
export function track(ds: DeepSpace, body: BodyName, from = -Infinity, to = Infinity): THREE.Vector3[] {
  const s = ds.bodies[body];
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k < s.n; k++) {
    const t = s.t0 + k * s.step * 1000;
    if (t >= from && t <= to) pts.push(new THREE.Vector3(s.xyz[k * 3], s.xyz[k * 3 + 1], s.xyz[k * 3 + 2]));
  }
  return pts;
}

/**
 * The Sun–Earth L2 point: on the line from the Sun through Earth, beyond
 * Earth by the Hill-sphere distance, r·(μ/3)^⅓ with μ the Earth–Moon share of
 * the Sun's mass, about 1.5 million km.
 */
const MU = 3.0404e-6; // (M_earth + M_moon) / (M_sun + M_earth + M_moon)
export function l2At(ds: DeepSpace, t: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  const sun = positionAt(ds, 'sun', t, out);
  if (!sun) return null;
  const r = sun.length();
  return sun.multiplyScalar(-(Math.cbrt(MU / 3) * r) / r);
}

export const C_KM_S = 299_792.458;
