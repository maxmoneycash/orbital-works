/**
 * Roman, running: a live model of what the observatory is doing.
 *
 * Real, from the ephemeris and Earth's rotation at the app's clock:
 * where Roman is, how far and how fast, how long its signal takes, the angle
 * between the Sun and Earth as it sees them, and which of its three receiving
 * stations can see it above the horizon.
 *
 * Simulated, and labelled so in the UI: the observing cycle. Roman is in
 * commissioning and NASA puts science operations in early 2027; the cycle of
 * slew, settle, expose and read out, and the fields it looks at, show how the
 * observatory will work, compressed from hours into a minute.
 */
import * as THREE from 'three';
import type { RomanStage } from './stage';
import { Exposure, type FieldKind } from './imaging';
import { positionAt, span, l2At, C_KM_S, type DeepSpace } from './ephem';

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
const DUR: Record<Phase, number> = { slew: 6.5, settle: 1.6, expose: 13, readout: 3.4 };

export interface Live {
  t: number;
  distKm: number;
  lightSec: number;
  speedKmS: number;
  l2Km: number | null;
  /** Sun–Roman–Earth angle, radians. */
  sunEarth: number;
  /** Where the published predict ends, and whether the clock is past it. */
  predictEnds: number;
  extrapolated: boolean;
  stations: { st: Station; elev: number }[];
  contact: { st: Station; elev: number } | null;
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class MissionSim {
  phase: Phase = 'slew';
  /** Seconds into the current phase. */
  phaseT = 0;
  targetIndex = 0;
  exposures = 0;
  /** Gigabytes sent at the Ka-band rate while a station has had Roman in view, since the pane opened. */
  sentGB = 0;
  live: Live | null = null;
  private rollFrom = 0;
  private rollTo = 0;
  private integrateClock = 0;
  private tex: THREE.CanvasTexture;

  constructor(readonly stage: RomanStage, public exposure: Exposure, readonly ds: DeepSpace) {
    this.tex = this.bind(exposure);
    this.startSlew();
  }

  private bind(e: Exposure) {
    const tex = new THREE.CanvasTexture(e.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.stage.setSkyProjection(tex, this.stage.mosaicPose());
    return tex;
  }

  /** A new mosaic (the view was resized); the exposure in progress restarts. */
  setExposure(e: Exposure) {
    this.tex.dispose();
    this.exposure = e;
    this.tex = this.bind(e);
    if (this.phase === 'expose' || this.phase === 'readout') this.startExpose();
  }

  /** Take the stage back after it was lent to another view: start a fresh slew. */
  resume() {
    this.stage.setSkyProjection(this.tex, this.stage.mosaicPose());
    this.startSlew();
  }

  get target() { return TARGETS[this.targetIndex]; }
  get phaseProgress() { return Math.min(1, this.phaseT / DUR[this.phase]); }

  /** Real geometry at time `t` (the app's clock). */
  geometry(t: number): Live {
    const [, end] = span(this.ds, 'roman');
    const extrapolated = t > end;
    const tt = Math.min(Math.max(t, span(this.ds, 'roman')[0]), end);
    const r = positionAt(this.ds, 'roman', tt)!;
    const r2 = positionAt(this.ds, 'roman', Math.min(end, tt + 60_000)) ?? r;
    const r1 = positionAt(this.ds, 'roman', Math.max(span(this.ds, 'roman')[0], tt - 60_000)) ?? r;
    const speed = r2.distanceTo(r1) / ((Math.min(end, tt + 60_000) - Math.max(span(this.ds, 'roman')[0], tt - 60_000)) / 1000 || 1);
    const sun = positionAt(this.ds, 'sun', t) ?? positionAt(this.ds, 'sun', tt);
    const l2 = l2At(this.ds, t);
    const toSun = sun ? sun.clone().sub(r).normalize() : new THREE.Vector3(1, 0, 0);
    const toEarth = r.clone().negate().normalize();
    const stations = STATIONS.map((st) => ({ st, elev: elevation(st, r, t) }));
    const best = stations.filter((s) => s.elev > MIN_ELEVATION).sort((a, b) => b.elev - a.elev)[0] ?? null;
    return {
      t,
      distKm: r.length(),
      lightSec: r.length() / C_KM_S,
      speedKmS: speed,
      l2Km: l2 ? r.distanceTo(l2) : null,
      sunEarth: Math.acos(THREE.MathUtils.clamp(toSun.dot(toEarth), -1, 1)),
      predictEnds: end,
      extrapolated,
      stations,
      contact: best,
    };
  }

  private startSlew() {
    this.phase = 'slew';
    this.phaseT = 0;
    this.rollFrom = this.stage.skyRoll;
    // A turn of 25–70°, either way, about the Sun line.
    const turn = THREE.MathUtils.degToRad(25 + Math.random() * 45) * (Math.random() < 0.5 ? -1 : 1);
    this.rollTo = this.rollFrom + turn;
    const s = this.stage;
    s.lightGoal = { progress: s.light?.length ?? 0, opacity: 0, cgi: false };
    s.skyGainGoal = 0.25;
  }

  private startExpose() {
    this.phase = 'expose';
    this.phaseT = 0;
    this.exposure.setScene(this.target.kind, this.target.seed + this.exposures * 101);
    const s = this.stage;
    s.lightGoal = { progress: s.light?.length ?? 0, opacity: 1, cgi: false };
    s.skyGainGoal = 1.5;
  }

  /** Advance by `dt` seconds of wall time at the app's clock `t`. */
  update(dt: number, t: number) {
    const s = this.stage;
    this.phaseT += dt;
    this.live = this.geometry(t);
    s.setEarthAngle(this.live.sunEarth);
    s.beamGoal = this.live.contact ? 1 : 0;

    switch (this.phase) {
      case 'slew': {
        const k = ease(this.phaseProgress);
        s.skyRoll = this.rollFrom + (this.rollTo - this.rollFrom) * k;
        if (this.phaseT >= DUR.slew) { this.phase = 'settle'; this.phaseT = 0; }
        break;
      }
      case 'settle':
        if (this.phaseT >= DUR.settle) this.startExpose();
        break;
      case 'expose': {
        // Integrate at 20 Hz, a few frames a tick, so the picture builds up
        // at a pace you can watch.
        this.integrateClock += dt;
        if (this.integrateClock > 0.05) {
          this.integrateClock = 0;
          this.exposure.integrate(1);
          this.exposure.draw();
          this.tex.needsUpdate = true;
        }
        if (this.phaseT >= DUR.expose) { this.phase = 'readout'; this.phaseT = 0; s.lightGoal.opacity = 0; }
        break;
      }
      case 'readout': {
        this.exposure.read = this.phaseProgress;
        this.exposure.draw();
        this.tex.needsUpdate = true;
        if (this.phaseT >= DUR.readout) {
          this.exposures++;
          this.targetIndex = (this.targetIndex + 1) % TARGETS.length;
          this.startSlew();
        }
        break;
      }
    }

    // Real time, at the published peak rate, whenever a station sees Roman.
    if (this.live.contact) this.sentGB += (500e6 / 8 / 1e9) * dt;
  }

  dispose() {
    this.tex.dispose();
  }
}
