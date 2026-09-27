/**
 * Where Roman can be heard from, and the rhythm it will observe in.
 *
 * Real: the three stations NASA names as receiving Roman's science data, and
 * their view of it given Earth's rotation at the app's clock.
 *
 * Simulated, and labelled so wherever it is shown: the observing cycle. Roman
 * is in commissioning and NASA puts science operations in early 2027; the
 * cycle of slew, settle, expose and read out, and the fields it looks at, show
 * how the observatory will work, compressed from hours into under a minute.
 */
import * as THREE from 'three';
import type { FieldKind } from './imaging';

/** The stations NASA names as receiving Roman's science data (NASA blog, 25 Sep 2026). */
export const STATIONS = [
  { id: 'wsc', short: 'White Sands', name: 'White Sands Complex, New Mexico', agency: 'NASA', lat: 32.5, lon: -106.61 },
  { id: 'nno', short: 'New Norcia', name: 'New Norcia, Western Australia', agency: 'ESA', lat: -31.05, lon: 116.19 },
  { id: 'msa', short: 'Misasa', name: 'Misasa, Saku City, Japan', agency: 'JAXA', lat: 36.13, lon: 138.36 },
] as const;
export type Station = (typeof STATIONS)[number];

const R_EARTH = 6371;
/** Below this, a station is taken not to have Roman in view. */
export const MIN_ELEVATION = (10 * Math.PI) / 180;

/** Greenwich mean sidereal time, radians (IAU 1982, to about a second). */
export function gmst(t: number) {
  const d = t / 86_400_000 + 2440587.5 - 2451545.0;
  const deg = (280.46061837 + 360.98564736629 * d) % 360;
  return (deg * Math.PI) / 180;
}

/** A station's position in the inertial (ICRF-aligned) frame, km. */
export function stationEci(st: Station, t: number, out = new THREE.Vector3()) {
  const lat = (st.lat * Math.PI) / 180, lon = (st.lon * Math.PI) / 180 + gmst(t);
  return out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)).multiplyScalar(R_EARTH);
}

/** Elevation of a target above a station's horizon, radians. */
export function elevation(st: Station, target: THREE.Vector3, t: number) {
  const s = stationEci(st, t);
  const up = s.clone().normalize();
  const los = target.clone().sub(s).normalize();
  return Math.asin(THREE.MathUtils.clamp(up.dot(los), -1, 1));
}

export interface Target { name: string; survey: string; kind: FieldKind; seed: number }
/** Roman's core community surveys; the fields drawn are synthetic. */
export const TARGETS: Target[] = [
  { name: 'Galactic bulge', survey: 'Galactic Bulge Time Domain Survey', kind: 'bulge', seed: 7 },
  { name: 'High-latitude field', survey: 'High Latitude Wide Area Survey', kind: 'deep', seed: 11 },
  { name: 'Galactic bulge, next field', survey: 'Galactic Bulge Time Domain Survey', kind: 'bulge', seed: 19 },
  { name: 'Supernova field', survey: 'High Latitude Time Domain Survey', kind: 'deep', seed: 23 },
];

export type Phase = 'slew' | 'settle' | 'expose' | 'readout';
export const PHASES: Phase[] = ['slew', 'settle', 'expose', 'readout'];
export const PHASE_LABEL: Record<Phase, string> = { slew: 'Slew', settle: 'Settle', expose: 'Expose', readout: 'Read out' };
export const DUR: Record<Phase, number> = { slew: 6.5, settle: 1.6, expose: 13, readout: 3.4 };
