/**
 * The Roman story: one continuous camera move, scrubbed by scroll, from
 * Earth out along Roman's real path to the observatory itself, then around
 * and into it. Nothing here keeps time of its own: every camera position
 * and every state of the model is a function of how far the page has been
 * scrolled, so scrolling back plays it all in reverse.
 *
 * Positions are real (JPL Horizons, at the app's clock). Close in, shots are
 * framed in the observatory's own frame — its sun side, its long axis — so
 * each frame is composed the same way whatever the Sun and Earth are doing.
 *
 * `t` is measured in screens of scroll; CHAPTERS gives the ranges the page's
 * words use too.
 */
import * as THREE from 'three';
import type { DeepSpaceLayer, DeepView } from './deep-space';
import { MODEL_SCALE, REST, EXPLODE, type OrbitState, type OrbitLabel } from './roman-orbit';
import { SUBSYSTEM } from '../roman/catalog';
import { DEPLOYMENTS } from '../roman/chapters';
import { SUN_DIR } from '../roman/l2-light';

export const CHAPTERS = {
  hero: [0, 1.2],
  out: [1.2, 3.3],
  arrive: [3.3, 4.3],
  unfold: [4.3, 6.4],
  sun: [6.4, 7.4],
  light: [7.4, 10.2],
  image: [10.2, 12],
  home: [12, 13.6],
  apart: [13.6, 15.2],
  end: [15.2, 16.4],
} as const;
export type ChapterId = keyof typeof CHAPTERS;
/** The story's length in screens; scrolling past it hands over to the tracker. */
export const STORY_LENGTH = 16.4;

const OBLIQUITY = (23.4393 * Math.PI) / 180;
/** The ecliptic pole in the globe's frame. */
const POLE = new THREE.Vector3(0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY));

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => { const k = clamp01(x); return k * k * k * (k * (k * 6 - 15) + 10); };
/** 0 before `a`, 1 after `b`, eased between. */
const r = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
/** Rises over [a, b], falls over [c, d]. */
const span = (t: number, a: number, b: number, c: number, d: number) => r(t, a, b) * (1 - r(t, c, d));

interface Pose { target: THREE.Vector3; dist: number; dir: THREE.Vector3 }

/** Shots close in, in the model's own metres: target, distance, and the direction the camera sits in. */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FP = V(0.75, 3.39, -0.36);          // the focal plane
const DISH = V(0, 0.9, 2.5);

export class RomanStory {
  /** Drag offsets on top of the scripted shot, radians; they ease home when let go. */
  yaw = 0;
  pitch = 0;
  dragging = false;
  private body = new THREE.Object3D();
  private q = new THREE.Quaternion();
  private dirLocal = new THREE.Vector3();
  /** The screen's shape: the wide shots out in space pull back further on a tall screen. */
  private aspect = 1.6;

  constructor(private deep: DeepSpaceLayer) {}

  /* ------------------------------------------------------------- camera -- */

  private world(target: THREE.Vector3, dist: number, dir: THREE.Vector3): Pose {
    return { target: target.clone(), dist, dir: dir.clone().normalize() };
  }

  /** A shot in the observatory's frame: `target` and `dir` in its metres, `dist` in metres. */
  private local(target: THREE.Vector3, dist: number, dir: THREE.Vector3): Pose {
    const o = this.deep.orbit;
    o.body.getWorldQuaternion(this.q);
    return {
      target: o.toWorld(target),
      dist: dist * MODEL_SCALE,
      dir: this.dirLocal.copy(dir).normalize().applyQuaternion(this.q).clone(),
    };
  }

  /** The keyframed shots, evaluated for this frame. */
  private keys(): [number, Pose][] {
    const R = this.deep.roman!.draw;
    const rHat = R.clone().normalize();
    const across = new THREE.Vector3().crossVectors(POLE, rHat).normalize();
    const hero = across.clone().multiplyScalar(0.86).addScaledVector(POLE, 0.34).addScaledVector(rHat, -0.28);
    const wide = across.clone().multiplyScalar(0.5).addScaledVector(POLE, 0.86);
    const e = this.deep.orbit.earthLocal;
    // Behind and beside the dish, looking along the downlink toward Earth.
    const side = new THREE.Vector3().crossVectors(e, V(0, 1, 0)).normalize();
    const home = e.clone().multiplyScalar(-0.55).addScaledVector(side, 0.78).add(V(0, 0.28, 0));
    const C = V(0, 6.4, 0);
    // Out: the camera keeps Roman's head in shot as the path draws itself,
    // pulling back to hold Earth and the head together.
    const head = (t: number) => this.deep.trackHead(Math.max(0.015, r(t, 1.3, 3.0)));
    const tall = Math.max(1, 1.35 / this.aspect);
    const follow = (t: number, lean: number) => {
      const h = head(t);
      return this.world(h.clone().multiplyScalar(0.5), Math.max(40, h.length() * 1.55) * tall, hero.clone().lerp(wide, lean));
    };
    return [
      [0, this.world(V(0, 0, 0), 13, hero)],
      [1.2, this.world(V(0, 0, 0), 30, hero)],
      [1.9, follow(1.9, 0.35)],
      [2.5, follow(2.5, 0.7)],
      [3.0, this.world(rHat.clone().multiplyScalar(R.length() * 0.48), R.length() * 1.75 * tall, wide)],
      [3.95, this.local(C, 25, V(0.75, 0.29, 0.6))],
      [4.3, this.local(V(0, 6.2, 0), 23, V(0.86, 0.24, 0.45))],
      [6.2, this.local(V(0, 6.2, 0), 22, V(0.42, 0.26, 0.87))],
      [6.9, this.local(V(0, 6.2, 0), 27, V(0.16, 0.3, 0.94))],
      [7.7, this.local(V(0, 8.2, 0), 18, V(0.97, 0.14, -0.2))],
      [8.9, this.local(V(0, 6.2, 0), 13, V(0.95, 0.2, -0.24))],
      [9.9, this.local(FP, 4.4, V(0.8, 0.52, -0.3))],
      [10.7, this.local(FP, 2.0, V(0.34, 0.93, -0.12))],
      [11.8, this.local(FP, 1.7, V(0.2, 0.97, -0.1))],
      [12.5, this.local(DISH, 17, home)],
      [13.4, this.local(DISH, 15, home.clone().addScaledVector(side, 0.25))],
      [14.1, this.local(V(0, 5.6, 0), 37, V(0.86, 0.25, 0.45))],
      [15.0, this.local(V(0, 5.6, 0), 35, V(0.66, 0.3, 0.69))],
      [15.8, this.local(C, 30, V(0.75, 0.29, 0.6))],
      [16.4, this.local(C, 32, V(0.7, 0.3, 0.64))],
    ];
  }

  pose(t: number): Pose {
    const k = this.keys();
    let i = 0;
    while (i < k.length - 2 && t > k[i + 1][0]) i++;
    const [t0, a] = k[i], [t1, b] = k[i + 1];
    const u = smooth((t - t0) / (t1 - t0));
    // Distance moves in log space, so the long dive to Roman slows as it
    // arrives. Where the distance changes a lot, the look point moves in step
    // with it rather than with time: pulling back, it stays on Earth until
    // the camera is out; diving in, it is on Roman well before the camera is.
    const la = Math.log(a.dist), lb = Math.log(b.dist);
    const dist = Math.exp(la + (lb - la) * u);
    const big = Math.abs(a.dist - b.dist) > 0.5 * Math.max(a.dist, b.dist);
    const w = big ? clamp01((a.dist - dist) / (a.dist - b.dist)) : u;
    const target = a.target.clone().lerp(b.target, w);
    const dir = a.dir.clone().lerp(b.dir, u).normalize();
    return { target, dist, dir };
  }

  /** Put the camera where the story has it at `t`, plus any drag. */
  apply(camera: THREE.PerspectiveCamera, t: number, dt: number) {
    if (!this.deep.roman) return null;
    this.aspect = camera.aspect || 1.6;
    const p = this.pose(t);
    if (!this.dragging) {
      const k = 1 - Math.exp(-1.6 * dt);
      this.yaw -= this.yaw * k;
      this.pitch -= this.pitch * k;
    }
    const up = V(0, 1, 0);
    const dir = p.dir.clone().applyAxisAngle(up, this.yaw);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    dir.applyAxisAngle(right, -this.pitch);
    if (Math.abs(dir.y) > 0.97) dir.y = Math.sign(dir.y) * 0.97;
    dir.normalize();
    camera.position.copy(p.target).addScaledVector(dir, p.dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(p.target);
    const near = THREE.MathUtils.clamp(p.dist * 0.02, 0.0005, 0.01);
    if (Math.abs(camera.near - near) > near * 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    return { target: p.target, dist: p.dist, dir };
  }

  /* -------------------------------------------------------------- state -- */

  /** What deep space and the observatory show at `t`. */
  view(t: number): DeepView {
    const fold = r(t, 4.3, 4.65);
    const dep = (a: number, b: number) => (1 - fold) + fold * r(t, a, b);
    const model: OrbitState = {
      ...REST,
      xray: span(t, 7.45, 8.05, 11.85, 12.3),
      explode: span(t, 13.8, 14.5, 15.1, 15.7),
      deploy: { liss: dep(4.8, 5.3), sass: dep(4.8, 5.35), hga: dep(5.45, 5.85), dac: dep(5.9, 6.3) },
      light: r(t, 8.0, 9.9),
      photons: span(t, 9.8, 10.1, 11.6, 11.95),
      frames: 240 * r(t, 10.5, 11.35),
      readout: r(t, 11.35, 11.75) * (1 - r(t, 11.9, 12.0)),
      field: { kind: 'bulge', seed: 7 },
      sun: span(t, 3.5, 3.95, 7.4, 7.7),
      beam: span(t, 12.1, 12.5, 13.5, 13.8),
      labels: this.labels(t),
    };
    const out = span(t, 0.7, 1.3, 3.35, 3.8);
    return {
      trackTo: Math.max(0.015, r(t, 1.3, 3.0)),
      tracks: out,
      beam: span(t, 12.2, 12.6, 13.5, 13.8),
      labels: new Set(out > 0.5 ? ['roman', 'moon', 'l2', 'jwst', 'euclid'] : t < 1 ? ['roman'] : []),
      model,
      modelTags: t > 3.4,
    };
  }

  private labels(t: number): OrbitLabel[] {
    const o = this.deep.orbit;
    const L: OrbitLabel[] = [];
    const add = (id: string, text: string, at: THREE.Vector3 | undefined, alpha: number, strong = false) => {
      if (at && alpha > 0.02) L.push({ id, text, at, alpha, strong });
    };
    const c = (id: string) => o.centres.get(id);
    // Arriving: the three things that make it Roman at a glance.
    const arrive = span(t, 3.75, 3.95, 4.15, 4.3);
    add('ap', 'Aperture, under its visor', V(0, 12.3, 0), arrive);
    add('sass', 'Solar array sun shield', c('SOLAR_ARRAY_SUN_SHIELD'), arrive);
    add('hga', 'High-gain antenna', DISH, arrive);
    // Unfolding: the mechanism moving, with when it moved.
    const steps: [number, number, string, THREE.Vector3 | undefined][] = [
      [4.45, 4.75, 'launch', c('TEL.OuterBarrelAssembly')],
      [4.8, 5.35, 'liss', c('SOLAR_ARRAY_SUN_SHIELD')],
      [5.45, 5.85, 'hga', DISH],
      [5.9, 6.3, 'dac', c('TEL.DeployableApertureCover')],
    ];
    for (const [a, b, key, at] of steps) {
      const d = DEPLOYMENTS.find((x) => x.key === key)!;
      add(`dep-${key}`, d.when, at, span(t, a - 0.05, a + 0.08, b + 0.06, b + 0.2), true);
    }
    // Sunlight.
    add('sun', 'Sunlight · the array makes 4 kW', V(-1.4, 7.4, 2.74).addScaledVector(SUN_DIR, 5.5), span(t, 6.6, 6.8, 7.25, 7.4));
    // The light, stop by stop, each named as the light reaches it.
    const lp = o.light;
    if (lp) {
      const lit = r(t, 8.0, 9.9) * lp.length;
      const alpha = span(t, 7.95, 8.05, 10.0, 10.15);
      const reached = lp.stops.filter((s) => s.s <= lit + 0.05);
      const cur = reached[reached.length - 1];
      if (cur) {
        const i = lp.stops.indexOf(cur);
        add('stop', cur.label, lp.stopPoints[i], alpha, true);
        const prev = lp.stops[i - 1];
        if (prev) add('stop-prev', prev.label, lp.stopPoints[i - 1], alpha * 0.45);
      }
    }
    // The picture.
    add('fp', '18 detectors · 300 million pixels', c('focal-plane'), span(t, 10.45, 10.65, 11.8, 11.95), true);
    // Home.
    add('dish', '1.7 m dish, on Earth', DISH, span(t, 12.4, 12.6, 13.45, 13.6));
    // Apart: every subsystem, named, out where it has gone.
    const apart = span(t, 14.25, 14.45, 15.0, 15.15);
    for (const id of ['TEL.DeployableApertureCover', 'TEL.SecondaryMirrorAssembly', 'TEL.PrimaryMirrorAssembly', 'TEL.OuterBarrelAssembly',
      'SOLAR_ARRAY_SUN_SHIELD', 'TEL.AftOpticsModule', 'WIDE_FIELD_INSTRUMENT', 'CORONAGRAPH_INSTRUMENT', 'COMMUNICATIONS', 'OSS.PrimaryStructure']) {
      const at = c(id);
      if (!at) continue;
      const off = EXPLODE[id];
      add(`sub-${id}`, SUBSYSTEM[id]?.label ?? id, off ? at.clone().add(V(...off)) : at, apart);
    }
    return L;
  }

  /** Which stop of the light path the light has reached at `t` (0 the aperture). */
  stopIndex(t: number): number {
    const lp = this.deep.orbit.light;
    if (!lp) return 0;
    const lit = r(t, 8.0, 9.9) * lp.length;
    let i = 0;
    lp.stops.forEach((s, k) => { if (s.s <= lit + 0.05) i = k; });
    return i;
  }

  /** The chapter `t` falls in. */
  static chapter(t: number): ChapterId {
    for (const [id, [a, b]] of Object.entries(CHAPTERS)) if (t >= a && t < b) return id as ChapterId;
    return 'end';
  }

  /** The orbit angles and target that reproduce a pose, for handing the camera back. */
  static anglesOf(dir: THREE.Vector3) {
    return { x: Math.atan2(dir.x, dir.z), y: Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) };
  }
}
