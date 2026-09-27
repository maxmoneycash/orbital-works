/**
 * Roman in orbit, on the globe: the observatory itself, where the ephemeris
 * puts it, doing what it does, close enough to fly around.
 *
 * Real, from the ephemeris and the app's clock: the Sun's direction, which
 * the shield always faces; Earth's, which the gimballed antenna tracks; and
 * whether a station has Roman in view, which is when the Ka-band stream runs.
 *
 * Shows, each played on the model rather than in a window:
 * - live: the above, as it is now;
 * - light: the barrel cut open, starlight down the optics onto the detectors,
 *   an exposure building up and reading out, then a roll to the next field
 *   (how Roman will observe; science starts after commissioning, and the
 *   fields are synthetic — the HUD says so);
 * - apart: every subsystem drawn out along its own direction, named;
 * - unfold: the deployments as flown, from the folded launch configuration.
 *
 * Every shader variant is fixed at load. `side`, `transparent` and the number
 * of clipping planes are compile-time defines in three.js, so toggling them
 * per show would recompile programs mid-flight; the cut shells keep the plane
 * for good, parked clear of the model when nothing is cut.
 */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { loadRomanModel, boundsOf, subsystemOf, partOf, LENGTH, type RomanModel } from '../roman/model';
import { LightPath } from '../roman/lightpath';
import { Exposure } from '../roman/imaging';
import { TARGETS, DUR, type Phase } from '../roman/sim';
import { num } from '../roman/dims';
import { SUBSYSTEM, partLabel } from '../roman/catalog';
import { DEPLOYMENTS } from '../roman/chapters';
import { SUN_DIR, makeL2Environment } from '../roman/l2-light';

/**
 * Roman drawn to scale would be four millionths of a draw unit. Close in, it
 * is shown this much larger, about 60,000 times, and the HUD says so.
 */
export const MODEL_SCALE = 0.02;

export type RomanShow = 'live' | 'light' | 'apart' | 'unfold';

/** What the HUD says about the show, refreshed a few times a second. */
export interface RomanShowState {
  show: RomanShow;
  phase: Phase | null;
  phaseProgress: number;
  target: string | null;
  /** The unfold's current step, 0 launch … 3 visor. */
  step: number;
  /** The part under the pointer or picked, if any. */
  part: { name: string; subsystem: string; blurb: string } | null;
}

/** Shells the section plane cuts in the light show. */
const CUT: ReadonlySet<string> = new Set([
  'TEL.OuterBarrelAssembly', 'TEL.DeployableApertureCover', 'SOLAR_ARRAY_SUN_SHIELD',
  'TEL.ForwardStructureAssembly', 'OSS.PrimaryStructure', 'OSS.LowerInstrumentSunShade',
  'INSTRUMENT_CARRIER', 'WIDE_FIELD_INSTRUMENT', 'CORONAGRAPH_INSTRUMENT', 'OSS.LaunchVehicleAdapter',
]);

/** Where each subsystem goes when the observatory is taken apart, in metres. */
const EXPLODE: Record<string, [number, number, number]> = {
  'OSS.LaunchVehicleAdapter': [0, -2.6, 0],
  'OSS.PrimaryStructure': [0, -1.6, 0],
  'TEL.TelescopeControlElectronics': [2.2, -1.6, -0.6],
  'OSS.LowerInstrumentSunShade': [0, -1.6, 2.4],
  COMMUNICATIONS: [0, -1.4, 2.8],
  INSTRUMENT_CARRIER: [0, -0.6, 0],
  WIDE_FIELD_INSTRUMENT: [2.8, -0.4, -0.4],
  CORONAGRAPH_INSTRUMENT: [-2.8, -0.4, 0.4],
  'TEL.Interfaces': [0, 0.3, 0],
  'TEL.TertiaryCollimatorAssembly': [-1.2, 0.6, -2.2],
  'TEL.AftOpticsModule': [1.4, 0.7, 1.2],
  'TEL.PrimaryMirrorAssembly': [0, 1.5, 0],
  'TEL.ForwardStructureAssembly': [0, 2.3, 0],
  'TEL.SecondaryMirrorAssembly': [0, 3.6, 0],
  'TEL.OuterBarrelAssembly': [0, 1.0, -3.6],
  'TEL.DeployableApertureCover': [0, 5.2, -3.6],
  SOLAR_ARRAY_SUN_SHIELD: [0, 1.0, 3.4],
};

/** The subsystems named when it is taken apart. */
const APART_LABELS = [
  'TEL.DeployableApertureCover', 'TEL.SecondaryMirrorAssembly', 'TEL.PrimaryMirrorAssembly', 'TEL.OuterBarrelAssembly',
  'SOLAR_ARRAY_SUN_SHIELD', 'TEL.AftOpticsModule', 'TEL.TertiaryCollimatorAssembly', 'WIDE_FIELD_INSTRUMENT',
  'CORONAGRAPH_INSTRUMENT', 'COMMUNICATIONS', 'OSS.PrimaryStructure', 'OSS.LowerInstrumentSunShade',
];

/** The unfold, in seconds: launch held, then the four deployments as flown, in order. */
const UNFOLD = { hold: 1.6, liss: [1.6, 4.6], hga: [5.2, 7.8], dac: [8.4, 11.6], end: 14 } as const;

/** Parts that turn with the antenna's gimbal; the boom and azimuth mount stay put. */
const GIMBALLED = ['HGA.Dish', 'HGA.Feed', 'HGA.FeedStrut', 'HGA.GimbalElevation'];
/** How far the gimbal can swing the dish off its rest axis. */
const GIMBAL_LIMIT = THREE.MathUtils.degToRad(75);

const damp = (cur: number, goal: number, k: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-k * dt));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const span01 = (t: number, [a, b]: readonly [number, number]) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));

interface Tag { el: HTMLDivElement; line: SVGLineElement; on: boolean }

/**
 * Streaks of light or data running along one direction: each rides its own
 * lane from `start + dir·len·f` as its phase `f` runs 0 → 1, a bright head
 * with a fading tail. `inbound` runs them the other way, ending on their
 * lane's point — sunlight arriving on the shield — and fades them in far out.
 */
function stream(opts: { n: number; lane: (i: number) => THREE.Vector3; dir: THREE.Vector3; len: number; tail: number; speed: number; size: number; color: number; inbound?: boolean; spread?: number }) {
  const n = opts.n;
  const lanes = Array.from({ length: n }, (_, i) => opts.lane(i));
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const phases = lanes.map(() => rnd());
  const u = {
    uTime: { value: 0 }, uDir: { value: opts.dir.clone().normalize() }, uLen: { value: opts.len }, uTailLen: { value: opts.tail },
    uSpeed: { value: opts.speed }, uSize: { value: opts.size }, uColor: { value: new THREE.Color(opts.color) },
    uOpacity: { value: 0 }, uSpread: { value: opts.spread ?? 0 },
  };
  const head = opts.inbound
    ? 'vec3 h = position + uDir * uLen * (1.0 - f); vec3 back = uDir; float fade = smoothstep(0.0, 0.3, f) * (1.0 - smoothstep(0.97, 1.0, f));'
    : 'vec3 h = position * (1.0 + f * uSpread) + uDir * uLen * f; vec3 back = -uDir; float fade = smoothstep(0.0, 0.04, f) * (1.0 - f);';
  const vert = (tailed: boolean) => `
    uniform float uTime, uLen, uTailLen, uSpeed, uSize, uSpread; uniform vec3 uDir;
    attribute float aPhase;${tailed ? ' attribute float aTail;' : ''} varying float vA;
    void main() {
      float f = fract(aPhase + uTime * uSpeed);
      ${head}
      vec3 p = h${tailed ? ' + back * uTailLen * aTail' : ''};
      vA = fade${tailed ? ' * (1.0 - aTail) * 0.7' : ''};
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uSize;
    }`;
  const frag = (round: boolean) => `
    uniform vec3 uColor; uniform float uOpacity; varying float vA;
    void main() {
      float a = vA * uOpacity${round ? ' * smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5))' : ''};
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor * a, a);
    }`;
  const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: u };

  const hp = new Float32Array(n * 3), hph = new Float32Array(n);
  const lp = new Float32Array(n * 6), lph = new Float32Array(n * 2), lt = new Float32Array(n * 2);
  lanes.forEach((l, i) => {
    hp.set(l.toArray(), i * 3); hph[i] = phases[i];
    lp.set([...l.toArray(), ...l.toArray()], i * 6); lph.set([phases[i], phases[i]], i * 2); lt.set([0, 1], i * 2);
  });
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  hg.setAttribute('aPhase', new THREE.BufferAttribute(hph, 1));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('aPhase', new THREE.BufferAttribute(lph, 1));
  lg.setAttribute('aTail', new THREE.BufferAttribute(lt, 1));
  const heads = new THREE.Points(hg, new THREE.ShaderMaterial({ ...common, vertexShader: vert(false), fragmentShader: frag(true) }));
  const tails = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ ...common, vertexShader: vert(true), fragmentShader: frag(false) }));
  const obj = new THREE.Group();
  for (const o of [heads, tails]) { o.frustumCulled = false; o.renderOrder = 11; obj.add(o); }
  return { obj, u, dispose: () => { for (const o of [heads, tails]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } } };
}
type Stream = ReturnType<typeof stream>;

export class RomanInOrbit {
  /** At Roman's position, scaled, with the shield turned to the Sun. */
  readonly holder = new THREE.Group();
  /** The roll about the Sun line, which turning to a new field changes. */
  private frame = new THREE.Group();
  /** The model's own frame, centred on its middle. */
  private body = new THREE.Group();
  model: RomanModel | null = null;
  show: RomanShow = 'live';
  /** Set by the owner: whether the model is drawn at all this frame. */
  visible = false;

  private light: LightPath | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private sunLight = new THREE.DirectionalLight(0xfff3e2, 3.0);
  private fill = new THREE.DirectionalLight(0xb8cae8, 0.8);
  /** A cool edge from behind, so silhouettes read against black. */
  private rim = new THREE.DirectionalLight(0xb4ccf0, 0.85);
  private ambient = new THREE.AmbientLight(0x2c3646, 0.9);
  /** Ghost rims of the cut shells, so the cutaway keeps its shape against space. */
  private ghosts = new THREE.Group();
  private ghostMat = new THREE.LineBasicMaterial({ color: 0xf2f1ec, transparent: true, opacity: 0, depthWrite: false });
  private live = new THREE.Color(0x44ff44);
  private tint = new THREE.Color(0x8cff8c);

  // --- states the frame eases toward ------------------------------------
  private cut = 0;
  private explode = 0;
  private lightOpacity = 0;
  private skyGain = 0;
  private sunA = 0;
  private beamA = 0;
  private holoA = 0;
  private deploy = { liss: 1, sass: 1, hga: 1, dac: 1 };
  private roll = 0;

  // --- the observing cycle (light show) ---------------------------------
  private phase: Phase = 'slew';
  private phaseT = 0;
  private targetIndex = 0;
  private exposures = 0;
  private rollFrom = 0;
  private rollTo = 0;
  private integrateClock = 0;
  private exposure: Exposure | null = null;
  private exposureTex: THREE.CanvasTexture | null = null;
  /** The camera the sky is painted onto the detectors from, in the model's frame. */
  private skyCam: { P: THREE.Matrix4; local: THREE.Matrix4 } | null = null;
  private holo: THREE.Mesh | null = null;
  private holoFrame: THREE.LineSegments | null = null;
  private holoLeader: Line2 | null = null;

  // --- the unfold -------------------------------------------------------
  private unfoldT = 0;

  // --- effects ----------------------------------------------------------
  private leaderMat: LineMaterial;
  private sunlight: Stream;
  private downlink: Stream | null = null;
  private beamGroup = new THREE.Group();
  private station: string | null = null;
  private gimbal: THREE.Group | null = null;
  private bore = new THREE.Vector3(0, 0, 1);
  private gimbalQ = new THREE.Quaternion();
  private feed = new THREE.Object3D();
  private subCentres = new Map<string, THREE.Vector3>();
  private wfiHousing: THREE.Mesh[] = [];
  private mats: THREE.MeshStandardMaterial[] = [];

  // --- picking ----------------------------------------------------------
  private raycaster = new THREE.Raycaster();
  private pointer: { x: number; y: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private hoverClock = 0;
  private hover: { part: string; point: THREE.Vector3 } | null = null;
  private picked: { part: string; point: THREE.Vector3 } | null = null;
  private clock = 0;

  // --- labels -----------------------------------------------------------
  private tagHost: HTMLDivElement;
  private svg: SVGSVGElement;
  private tags = new Map<string, Tag>();

  private readonly reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private baseQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();
  private euler = new THREE.Euler();
  private cleanup: (() => void)[] = [];

  constructor(private renderer: THREE.WebGLRenderer, uiRoot: HTMLElement) {
    this.holder.name = 'roman-in-orbit';
    this.holder.visible = false;
    this.holder.scale.setScalar(MODEL_SCALE);
    this.holder.add(this.frame);
    this.frame.add(this.body);
    this.body.position.set(0, -LENGTH / 2, 0);
    this.renderer.localClippingEnabled = true;

    this.leaderMat = new LineMaterial({ color: 0xf2f1ec, linewidth: 1, transparent: true, opacity: 0, depthWrite: false });

    // Sunlight arriving on the shield's face (z ≈ 2.7 m): photons drifting in
    // along the Sun's direction and ending on the array.
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const px = Math.min(devicePixelRatio || 1, 2);
    this.sunlight = stream({
      n: 170, dir: SUN_DIR, len: 12, tail: 2.2, speed: 0.2, size: 2.6 * px, color: 0xffd49a, inbound: true,
      lane: () => new THREE.Vector3(-2.3 + rnd() * 4.6, 2.6 + rnd() * 4.8, 2.74),
    });
    this.body.add(this.sunlight.obj);

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.setScalar(2048);
    Object.assign(this.sunLight.shadow.camera, { left: -0.2, right: 0.2, top: 0.2, bottom: -0.2, near: 0.4, far: 1.6 });
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.0006;
    this.sunLight.target = this.holder;
    this.fill.target = this.holder;
    this.rim.target = this.holder;
    // The lights stay on for good. Nothing else in the globe's scene is lit,
    // and the number of visible lights is baked into every lit program, so
    // switching them with the model would recompile its shaders each time.

    // Labels: chips in the page, tied to their points by hairline leaders.
    this.tagHost = document.createElement('div');
    this.tagHost.className = 'roman-tags';
    Object.assign(this.tagHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', display: 'none' });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(this.svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' });
    this.tagHost.append(this.svg);
    uiRoot.prepend(this.tagHost);

    const canvas = renderer.domElement;
    const move = (e: PointerEvent) => { if (e.pointerType === 'mouse') this.pointer = { x: e.clientX, y: e.clientY }; };
    const leave = () => { this.pointer = null; };
    const down = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
    const up = (e: PointerEvent) => {
      const d = this.down;
      this.down = null;
      if (!d || !this.visible || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const hit = this.pick(e.clientX, e.clientY);
      this.picked = hit && this.picked?.part !== hit.part ? hit : null;
    };
    canvas.addEventListener('pointermove', move, { passive: true });
    canvas.addEventListener('pointerleave', leave, { passive: true });
    canvas.addEventListener('pointerdown', down, { passive: true });
    canvas.addEventListener('pointerup', up, { passive: true });
    this.cleanup.push(() => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
    });
  }

  /** The lights live beside the holder in the globe's scene; add both. */
  get objects(): THREE.Object3D[] {
    return [this.holder, this.sunLight, this.fill, this.rim, this.ambient];
  }

  private line(a: THREE.Vector3, b: THREE.Vector3, m: LineMaterial, into: THREE.Object3D) {
    const g = new LineGeometry();
    g.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
    const l = new Line2(g, m);
    l.computeLineDistances();
    l.frustumCulled = false;
    l.renderOrder = 10;
    into.add(l);
    return l;
  }

  /* ------------------------------------------------------------- loading -- */

  async load(camera: THREE.Camera) {
    const model = await loadRomanModel();
    const root = model.root;
    root.updateMatrixWorld(true);

    // Everything measured here is in the model's own frame: the root is not
    // parented yet, so world space is model space.
    this.light = new LightPath(model);
    for (const [sub, meshes] of model.bySubsystem) this.subCentres.set(sub, boundsOf(meshes).getCenter(new THREE.Vector3()));
    this.wfiHousing = model.meshes.filter((m) => (partOf(m) ?? '').startsWith('WFI.Body'));

    // The antenna's gimbal: the dish, feed and struts turn together about the
    // gimbal's centre. Their origins stay on the deploy hinge, so the unfold
    // still swings them out on it, with the gimbal at rest.
    const P = (p: string) => model.byPart.get(p);
    const dish = P('HGA.Dish'), feed = P('HGA.Feed'), elev = P('HGA.GimbalElevation');
    if (dish && feed && elev && dish.parent) {
      const comms = dish.parent;
      const pivot = comms.worldToLocal(boundsOf([elev]).getCenter(new THREE.Vector3()));
      const g = new THREE.Group();
      g.name = 'hga-gimbal';
      g.position.copy(pivot);
      comms.add(g);
      g.updateMatrixWorld(true);
      for (const m of model.meshes) {
        const pn = partOf(m) ?? '';
        if (GIMBALLED.some((p) => pn.startsWith(p))) { g.attach(m); m.userData.basePosition = m.position.clone(); }
      }
      const fc = boundsOf([feed]).getCenter(new THREE.Vector3()), dc = boundsOf([dish]).getCenter(new THREE.Vector3());
      this.bore.copy(comms.worldToLocal(fc.clone())).sub(comms.worldToLocal(dc.clone())).normalize();
      // The Ka-band stream leaves from the feed along the boresight.
      this.feed.position.copy(g.worldToLocal(fc.clone()));
      g.add(this.feed);
      this.beamGroup.position.copy(this.feed.position);
      this.beamGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.bore);
      // The Ka-band stream: data leaving the feed in a narrow cone for Earth.
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      this.downlink = stream({
        n: 140, dir: new THREE.Vector3(0, 0, 1), len: 40, tail: 3, speed: 0.5, size: 3.2 * Math.min(devicePixelRatio || 1, 2), color: 0x44ff44, spread: 1.2,
        lane: () => { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.55; return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0); },
      });
      this.beamGroup.add(this.downlink.obj);
      g.add(this.beamGroup);
      this.gimbal = g;
    }

    // The sky painted onto the detectors: an orthographic camera looking down
    // on the focal plane, the way the light arrives. The exposure is drawn in
    // that camera's pixels, so it lands on the chips it was integrated on.
    const W = 360, H = 180;
    const bb = boundsOf(model.detectors);
    const c = bb.getCenter(new THREE.Vector3());
    const halfW = Math.max((bb.max.x - bb.min.x) / 2, bb.max.z - bb.min.z) * 1.08, halfH = halfW / 2;
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 2);
    cam.position.set(c.x, bb.max.y + 0.5, c.z);
    cam.up.set(0, 0, -1);
    cam.lookAt(c.x, bb.max.y, c.z);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const outlines = model.detectors.map((d) => {
      const g = d.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      return [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]].map(([x, z]) => {
        const p = new THREE.Vector3(x, b.max.y, z).applyMatrix4(d.matrixWorld).project(cam);
        return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
      });
    });
    this.exposure = new Exposure(outlines, W, H, { scale: 1 });
    this.exposureTex = new THREE.CanvasTexture(this.exposure.canvas);
    this.exposureTex.colorSpace = THREE.SRGBColorSpace;
    this.exposureTex.magFilter = THREE.NearestFilter;
    model.sky.map.value = this.exposureTex;
    this.skyCam = { P: cam.projectionMatrix.clone(), local: cam.matrixWorld.clone() };

    // The exposure, held up beside the instrument like a readout, with a
    // leader back down to the focal plane it comes from.
    const holoAt = new THREE.Vector3(5.2, 6.4, -0.6);
    this.holo = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), new THREE.MeshBasicMaterial({
      map: this.exposureTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    (this.holo.material as THREE.MeshBasicMaterial).color.setScalar(1.7);
    this.holo.position.copy(holoAt);
    this.holo.renderOrder = 12;
    this.holoFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(5.7, 2.9)),
      new THREE.LineBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0, depthWrite: false }));
    this.holo.add(this.holoFrame);
    this.holoLeader = this.line(c.clone().setY(bb.max.y), holoAt.clone().add(new THREE.Vector3(-2.85, -1.4, 0)), this.leaderMat, this.body);

    // Ghost rims: the barrel's and visor's edges, drawn faintly while cut.
    for (const pn of ['OBA.Barrel', 'DAC.Membrane']) {
      const mesh = model.byPart.get(pn);
      if (!mesh) continue;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), this.ghostMat);
      mesh.updateWorldMatrix(true, false);
      e.matrixAutoUpdate = false;
      e.matrix.copy(mesh.matrixWorld);
      e.userData.of = mesh;
      this.ghosts.add(e);
    }
    this.ghosts.visible = false;

    // Fix every material's variant now, once.
    const env = makeL2Environment(this.renderer);
    for (const mesh of model.meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mesh.castShadow = mesh.receiveShadow = true;
      if (mat.name === 'Detector') continue;
      const cutMe = CUT.has(subsystemOf(mesh) ?? '');
      Object.assign(mat, {
        transparent: false, opacity: 1, depthWrite: true, envMap: env, envMapIntensity: 0.6,
        clippingPlanes: cutMe ? [this.clip] : null, side: cutMe ? THREE.DoubleSide : THREE.FrontSide,
      });
      mat.needsUpdate = true;
      this.mats.push(mat);
    }
    const det = model.detectors[0]?.material as THREE.MeshStandardMaterial | undefined;
    if (det) { det.envMap = env; det.needsUpdate = true; this.mats.push(det); }

    this.body.add(root, this.light.group, this.holo, this.ghosts);
    this.light.set(this.light.length, false, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.model = model;
    this.startSlew();

    // Compile every program now, off the critical path, rather than in the
    // first frame the camera arrives. compileAsync skips hidden objects, so
    // everything a show can reveal is shown for the pass; capped, since a
    // hidden tab never resolves it.
    let scene: THREE.Object3D = this.holder;
    while (scene.parent) scene = scene.parent;
    const reveal = [this.holder, this.light.group, this.holo, this.ghosts, this.beamGroup, this.sunlight.obj];
    const was = reveal.map((o) => o.visible);
    for (const o of reveal) o.visible = true;
    try {
      await Promise.race([
        this.renderer.compileAsync(this.holder, camera, (scene as THREE.Scene).isScene ? scene as THREE.Scene : null),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
    } catch { /* compiles lazily instead */ }
    reveal.forEach((o, i) => { o.visible = was[i]; });
  }

  /* --------------------------------------------------------------- shows -- */

  setShow(s: RomanShow) {
    if (s === this.show && s !== 'unfold') return;
    this.show = s;
    this.picked = null;
    if (s === 'light') { this.phase = 'settle'; this.phaseT = 0; }
    if (s === 'unfold') {
      this.unfoldT = 0;
      // Folded, as it rode the rocket.
      this.deploy = { liss: 0, sass: 0, hga: 0, dac: 0 };
    }
  }

  /** The show as the HUD tells it. */
  get state(): RomanShowState {
    const sel = this.picked ?? this.hover;
    let part: RomanShowState['part'] = null;
    if (sel) {
      const mesh = this.model?.byPart.get(sel.part);
      const sub = mesh ? subsystemOf(mesh) ?? '' : '';
      const info = SUBSYSTEM[sub];
      part = { name: partLabel(sel.part), subsystem: info?.label ?? '', blurb: info?.blurb.split('. ')[0].replace(/\.$/, '') + '.' };
    }
    const step = this.unfoldT < UNFOLD.hold ? 0 : this.unfoldT < UNFOLD.hga[0] ? 1 : this.unfoldT < UNFOLD.dac[0] ? 2 : 3;
    return {
      show: this.show,
      phase: this.show === 'light' ? this.phase : null,
      phaseProgress: Math.min(1, this.phaseT / DUR[this.phase]),
      target: this.show === 'light' ? TARGETS[this.targetIndex].survey : null,
      step,
      part,
    };
  }

  /** Where the Ka-band stream leaves the dish, in the globe's frame. */
  feedWorld(out = new THREE.Vector3()) {
    return this.feed.getWorldPosition(out);
  }

  setLive(c: THREE.Color) {
    this.live.copy(c);
    this.tint.copy(c).lerp(new THREE.Color(0xffffff), 0.45);
    this.downlink?.u.uColor.value.copy(c);
    (this.holoFrame?.material as THREE.LineBasicMaterial | undefined)?.color.copy(c);
    this.light?.setLive(c);
  }

  /**
   * The shield on the Sun leaves one angle free: the roll about the Sun
   * line. Where the observing cycle isn't choosing it, it is set to stand
   * the telescope upright on screen.
   */
  private attitude(toSun: THREE.Vector3, out = new THREE.Quaternion()) {
    out.setFromUnitVectors(SUN_DIR, toSun);
    const s = toSun;
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(out);
    y.addScaledVector(s, -y.dot(s));
    const up = new THREE.Vector3(0, 1, 0);
    up.addScaledVector(s, -up.dot(s));
    if (y.lengthSq() > 1e-8 && up.lengthSq() > 1e-8) {
      y.normalize(); up.normalize();
      const a = Math.atan2(s.dot(new THREE.Vector3().crossVectors(y, up)), y.dot(up));
      out.premultiply(new THREE.Quaternion().setFromAxisAngle(s, a));
    }
    return out;
  }

  /**
   * Where a camera should sit to see Roman three-quarters on from the sun
   * side, a little above: a unit direction from Roman, in the globe's frame.
   */
  viewDir(toSun: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3(0.75, 0.29, 0.595).normalize().applyAxisAngle(SUN_DIR, this.roll);
    return d.applyQuaternion(this.attitude(toSun));
  }

  private startSlew() {
    this.phase = 'slew';
    this.phaseT = 0;
    this.rollFrom = this.roll;
    // A turn of 25–70° about the Sun line, back toward upright once it has
    // wandered, so field after field it never ends up on its head.
    const dir = this.roll > 0.6 ? -1 : this.roll < -0.6 ? 1 : Math.random() < 0.5 ? -1 : 1;
    const turn = THREE.MathUtils.degToRad(25 + Math.random() * 45) * dir;
    this.rollTo = this.roll + turn;
  }

  private stepCycle(dt: number) {
    const e = this.exposure!;
    this.phaseT += dt;
    switch (this.phase) {
      case 'slew':
        this.roll = this.rollFrom + (this.rollTo - this.rollFrom) * ease(Math.min(1, this.phaseT / DUR.slew));
        if (this.phaseT >= DUR.slew) { this.phase = 'settle'; this.phaseT = 0; }
        break;
      case 'settle':
        if (this.phaseT >= DUR.settle) {
          this.phase = 'expose';
          this.phaseT = 0;
          const t = TARGETS[this.targetIndex];
          e.setScene(t.kind, t.seed + this.exposures * 101);
        }
        break;
      case 'expose':
        // 20 frames a second, so the picture builds at a pace you can watch.
        if ((this.integrateClock += dt) > 0.05) {
          this.integrateClock = 0;
          e.integrate(1);
          e.draw();
          this.exposureTex!.needsUpdate = true;
        }
        if (this.phaseT >= DUR.expose) { this.phase = 'readout'; this.phaseT = 0; }
        break;
      case 'readout':
        e.read = Math.min(1, this.phaseT / DUR.readout);
        e.draw();
        this.exposureTex!.needsUpdate = true;
        if (this.phaseT >= DUR.readout) {
          this.exposures++;
          this.targetIndex = (this.targetIndex + 1) % TARGETS.length;
          this.startSlew();
        }
        break;
    }
  }

  /* -------------------------------------------------------------- picking -- */

  private pick(x: number, y: number): { part: string; point: THREE.Vector3 } | null {
    const m = this.model;
    const cam = this.camera;
    if (!m || !cam) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
    for (const h of this.raycaster.intersectObjects(m.meshes, false)) {
      const mesh = h.object as THREE.Mesh;
      if (!mesh.visible) continue;
      // The near half of a cut shell is not drawn; nor can it be picked.
      const mat = mesh.material as THREE.Material;
      if (mat.clippingPlanes?.length && this.clip.distanceToPoint(h.point) < 0) continue;
      const part = partOf(mesh);
      if (part) return { part, point: this.body.worldToLocal(h.point.clone()) };
    }
    return null;
  }

  private camera: THREE.PerspectiveCamera | null = null;

  /* --------------------------------------------------------------- frame -- */

  /**
   * `draw` Roman's position in the globe's frame; `toSun`, `toEarth` unit
   * directions from it; `station` the one that has it in view, if any.
   */
  update(o: {
    draw: THREE.Vector3; toSun: THREE.Vector3; toEarth: THREE.Vector3; station: string | null;
    camera: THREE.PerspectiveCamera; dt: number; w: number; h: number; inspecting: boolean;
    labels: { id: string; text: string; at: THREE.Vector3 }[];
  }) {
    const m = this.model;
    const on = this.visible && !!m;
    this.holder.visible = on;
    this.tagHost.style.display = on && o.inspecting ? '' : 'none';
    if (!on || !m) { this.picked = this.hover = null; return; }
    const dt = Math.min(o.dt, 0.1);
    this.camera = o.camera;
    this.clock += dt;

    // Goals for the show.
    const s = this.show;
    if (s === 'light') this.stepCycle(dt);
    else this.roll = damp(this.roll, 0, 1.2, dt);
    if (s === 'unfold') {
      const t = (this.unfoldT += dt * (this.reducedMotion ? 4 : 1));
      this.deploy.liss = this.deploy.sass = t < UNFOLD.hold ? 0 : span01(t, UNFOLD.liss);
      this.deploy.hga = span01(t, UNFOLD.hga);
      this.deploy.dac = span01(t, UNFOLD.dac);
      if (t >= UNFOLD.end) this.setShow('live');
    } else {
      for (const k of ['liss', 'sass', 'hga', 'dac'] as const) this.deploy[k] = damp(this.deploy[k], 1, 3, dt);
    }
    const exposing = s === 'light' && (this.phase === 'expose' || this.phase === 'settle');
    this.cut = damp(this.cut, s === 'light' ? 1 : 0, 2.4, dt);
    this.explode = damp(this.explode, s === 'apart' ? 1 : 0, 2.2, dt);
    this.lightOpacity = damp(this.lightOpacity, exposing && this.phase === 'expose' ? 1 : 0, 3, dt);
    this.skyGain = damp(this.skyGain, s !== 'light' ? 0 : this.phase === 'slew' ? 0.25 : 1.5, 3, dt);
    this.holoA = damp(this.holoA, s === 'light' ? 1 : 0, 3, dt);
    this.sunA = damp(this.sunA, s === 'live' || s === 'light' ? 1 : 0, 2.5, dt);
    this.station = o.station;
    this.beamA = damp(this.beamA, o.station && s !== 'unfold' && this.deploy.hga > 0.98 ? 1 : 0, 2.5, dt);

    // Where it is and which way it faces: the shield on the Sun, then the roll.
    this.holder.position.copy(o.draw);
    this.holder.quaternion.copy(this.attitude(o.toSun, this.baseQ));
    this.frame.quaternion.setFromAxisAngle(SUN_DIR, this.roll);
    this.holder.updateMatrixWorld(true);

    // The antenna on Earth.
    const g = this.gimbal;
    if (g?.parent) {
      g.parent.getWorldQuaternion(this.tmpQ).invert();
      const earth = this.tmp.copy(o.toEarth).applyQuaternion(this.tmpQ).normalize();
      const goal = new THREE.Quaternion().setFromUnitVectors(this.bore, earth);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(goal.w)));
      if (ang > GIMBAL_LIMIT) goal.slerp(new THREE.Quaternion(), 1 - GIMBAL_LIMIT / ang);
      this.gimbalQ.slerp(goal, 1 - Math.exp(-3 * dt));
      g.quaternion.identity().slerp(this.gimbalQ, this.deploy.hga);
    }

    // Lights: the Sun where it is; a soft fill from the viewer so the shaded
    // side still reads; reflections turned with the model.
    const size = MODEL_SCALE * LENGTH;
    this.sunLight.position.copy(o.draw).addScaledVector(o.toSun, size * 4);
    this.fill.position.copy(o.camera.position);
    // Behind the model from the camera, and above it.
    this.rim.position.copy(o.draw).multiplyScalar(2).sub(o.camera.position).addScaledVector(o.camera.up, size * 2);
    this.body.getWorldQuaternion(this.tmpQ);
    this.euler.setFromQuaternion(this.tmpQ, 'ZYX');
    for (const mat of this.mats) mat.envMapRotation.set(this.euler.x, this.euler.y, this.euler.z, 'XYZ');

    this.applyParts(o.camera);

    // Effects.
    this.leaderMat.resolution.set(o.w, o.h);
    const motion = this.reducedMotion ? 0.25 : 1;
    const su = this.sunlight.u;
    su.uTime.value += dt * motion;
    su.uOpacity.value = 0.85 * this.sunA;
    this.sunlight.obj.visible = this.sunA > 0.01;
    if (this.downlink) {
      this.downlink.u.uTime.value += dt * motion;
      this.downlink.u.uOpacity.value = this.beamA;
    }
    this.beamGroup.visible = this.beamA > 0.01;
    const L = this.light!;
    L.setResolution(o.w, o.h);
    // Gentle: two dozen rays meet at the focal plane, and additive pulses
    // stacked there would blow out into a white block.
    L.set(L.length, false, this.lightOpacity * 0.38);
    this.ghostMat.opacity = 0.22 * this.cut;
    this.ghosts.visible = this.cut > 0.02;
    if (this.ghosts.visible && m.dac) {
      // The visor's rim follows its deploy height.
      for (const g of this.ghosts.children) {
        const of = g.userData.of as THREE.Object3D;
        g.matrix.copy(of.matrixWorld).premultiply(this.tmpM.copy(this.body.matrixWorld).invert());
      }
    }
    L.tick(dt * (this.reducedMotion ? 0.3 : 1), L.length);
    m.sky.gain.value = this.skyGain;
    if (this.skyCam && this.skyGain > 0.001) {
      const wm = new THREE.Matrix4().multiplyMatrices(this.body.matrixWorld, this.skyCam.local);
      m.sky.vp.value.multiplyMatrices(this.skyCam.P, wm.invert());
    }
    if (this.holo) {
      this.holo.visible = this.holoA > 0.01;
      (this.holo.material as THREE.MeshBasicMaterial).opacity = 0.9 * this.holoA;
      (this.holoFrame!.material as THREE.LineBasicMaterial).opacity = 0.7 * this.holoA;
      this.leaderMat.opacity = 0.45 * this.holoA;
      this.holoLeader!.visible = this.holoA > 0.01;
      // Square to the viewer, like a screen held up beside the instrument.
      this.holo.quaternion.copy(this.body.getWorldQuaternion(this.tmpQ).invert()).multiply(o.camera.quaternion);
    }

    // Hover, a few times a second.
    if ((this.hoverClock += dt) > 0.08) {
      this.hoverClock = 0;
      this.hover = this.pointer && o.inspecting ? this.pick(this.pointer.x, this.pointer.y) : null;
    }

    this.placeTags(o);
  }

  private applyParts(camera: THREE.PerspectiveCamera) {
    const m = this.model!;
    // Section plane through the long axis, facing away from the camera, so
    // the near half is the half cut away; parked 12 m toward the camera when
    // nothing is cut, clear of everything, exploded view included.
    const axisO = this.body.localToWorld(new THREE.Vector3(0, 0, 0));
    const axisD = new THREE.Vector3(0, 1, 0).applyQuaternion(this.body.getWorldQuaternion(this.tmpQ));
    const n = new THREE.Vector3().subVectors(axisO, camera.position);
    n.addScaledVector(axisD, -n.dot(axisD));
    if (n.lengthSq() < 1e-12) n.set(0, 0, -1);
    n.normalize();
    const park = (1 - this.cut) * (1 - this.cut) * 12 * MODEL_SCALE;
    this.clip.setFromNormalAndCoplanarPoint(n, axisO.addScaledVector(n, -park));

    const e = this.explode;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.6);
    const hov = this.hover?.part, sel = this.picked?.part;
    for (const mesh of m.meshes) {
      const sub = subsystemOf(mesh) ?? '';
      const part = partOf(mesh);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const off = EXPLODE[sub];
      if (off && sub !== 'TEL.DeployableApertureCover') {
        const b = mesh.userData.basePosition as THREE.Vector3;
        mesh.position.set(b.x + off[0] * e, b.y + off[1] * e, b.z + off[2] * e);
      }
      if (mat.name === 'Detector') continue;
      // Shadow maps ignore the section plane; a cut shell must not shade the
      // interior it no longer covers.
      mesh.castShadow = !(CUT.has(sub) && this.cut > 0.02);
      const hl = part && part === sel ? 0.16 + 0.12 * pulse : part && part === hov ? 0.12 : 0;
      mat.emissive.copy(this.tint);
      mat.emissiveIntensity = hl;
    }
    for (const h of this.wfiHousing) h.visible = this.cut < 0.3;

    if (m.dac) {
      const s = num('DAC_H_STOWED') / num('DAC_H_DEPLOYED');
      m.dac.scale.y = s + (1 - s) * this.deploy.dac;
      const b = m.dac.userData.basePosition as THREE.Vector3 | undefined;
      const off = EXPLODE['TEL.DeployableApertureCover'];
      if (b) m.dac.position.set(b.x + off[0] * e, b.y + off[1] * e, b.z + off[2] * e);
    }
    for (const d of m.deployables) {
      const sub = subsystemOf(d.node);
      const which = sub === 'OSS.LowerInstrumentSunShade' ? this.deploy.liss
        : sub === 'COMMUNICATIONS' ? this.deploy.hga : this.deploy.sass;
      d.node.rotation[d.axis] = d.base + (1 - which) * d.stowed;
    }
  }

  /* --------------------------------------------------------------- labels -- */

  /** A point in the model's frame, in the globe's. */
  private world(p: THREE.Vector3, out = new THREE.Vector3()) {
    return this.body.localToWorld(out.copy(p));
  }

  private placeTags(o: { camera: THREE.PerspectiveCamera; w: number; h: number; inspecting: boolean; labels: { id: string; text: string; at: THREE.Vector3 }[] }) {
    if (!o.inspecting) return;
    const want: { id: string; text: string; at: THREE.Vector3; strong?: boolean }[] = [...o.labels];
    const s = this.show;
    const L = this.light!;
    if (s === 'live') {
      want.push({ id: 'sun', text: 'Sunlight on the array · 4 kW', at: this.world(new THREE.Vector3(-1.4, 7.2, 2.74).addScaledVector(SUN_DIR, 6)) });
      if (this.gimbal && this.beamA > 0.5) {
        want.push({ id: 'ka', text: `Ka-band · 500 Mb/s → ${this.station}`, at: this.beamGroup.localToWorld(new THREE.Vector3(0, 0, 14)), strong: true });
      } else if (this.gimbal) {
        want.push({ id: 'ka', text: 'High-gain antenna, held on Earth', at: this.feedWorld() });
      }
      want.push({ id: 'ap', text: 'Aperture, shaded by the visor', at: this.world(new THREE.Vector3(0, LENGTH - 0.2, 0)) });
    } else if (s === 'light') {
      const pts = L.stopPoints;
      const name = (i: number) => L.stops[i]?.label ?? '';
      // On a phone, only the two that matter: where the light lands, and the picture.
      if (pts.length >= 10 && o.w < 600) {
        want.push({ id: 'fp', text: 'Focal plane · 18 detectors', at: this.world(pts[9]) });
      } else if (pts.length >= 10) {
        want.push({ id: 'pm', text: `${name(1)} · 2.4 m`, at: this.world(pts[1]) });
        want.push({ id: 'sm', text: name(2), at: this.world(pts[2]) });
        want.push({ id: 'tm', text: 'Aft optics', at: this.world(pts[7]) });
        want.push({ id: 'fp', text: 'Focal plane · 18 detectors', at: this.world(pts[9]) });
      }
      if (this.holo && this.holoA > 0.5) {
        const e = this.exposure!;
        const what = this.phase === 'readout' ? 'reading out' : this.phase === 'expose' ? `${(e.frames / 20).toFixed(1)} s in` : this.phase === 'slew' ? 'turning to the next field' : 'settling';
        want.push({ id: 'holo', text: `Wide Field Instrument · ${what}`, at: this.world(this.holo.position.clone().add(new THREE.Vector3(0, 1.45, 0))), strong: true });
      }
    } else if (s === 'apart' && this.explode > 0.5) {
      for (const id of APART_LABELS) {
        const c = this.subCentres.get(id);
        const off = EXPLODE[id];
        if (!c) continue;
        const p = c.clone();
        if (off) p.add(new THREE.Vector3(...off).multiplyScalar(this.explode));
        want.push({ id: `sub:${id}`, text: SUBSYSTEM[id]?.label ?? id, at: this.world(p) });
      }
    } else if (s === 'unfold') {
      const step = this.state.step;
      const at = step === 1 ? this.subCentres.get('SOLAR_ARRAY_SUN_SHIELD') : step === 2 ? this.subCentres.get('COMMUNICATIONS') : step === 3 ? this.subCentres.get('TEL.DeployableApertureCover') : null;
      if (at) want.push({ id: 'unfold', text: DEPLOYMENTS[step].when, at: this.world(at), strong: true });
    }
    const sel = this.picked ?? this.hover;
    if (sel) want.push({ id: 'part', text: partLabel(sel.part), at: this.world(sel.point), strong: true });

    // Place: beside each point, pushed down past any chip already placed.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const seen = new Set<string>();
    const rows = want.map((t) => {
      const p = this.tmp.copy(t.at).project(o.camera);
      return { t, x: ((p.x + 1) / 2) * o.w, y: ((1 - p.y) / 2) * o.h, ok: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 };
    }).sort((a, b) => a.y - b.y);
    for (const r of rows) {
      if (!r.ok) continue;
      const tag = this.tag(r.t.id, r.t.strong);
      if (tag.el.dataset.text !== r.t.text) { tag.el.textContent = r.t.text; tag.el.dataset.text = r.t.text; }
      const w = tag.el.offsetWidth || 120, h = 20;
      let x = Math.min(r.x + 26, o.w - w - 8), y = r.y - 30;
      for (const q of placed) if (x < q.x + q.w && x + w > q.x && y < q.y + q.h + 3 && y + h > q.y - 3) y = q.y + q.h + 4;
      placed.push({ x, y, w, h });
      tag.el.style.translate = `${x}px ${y}px`;
      tag.line.setAttribute('x1', String(r.x)); tag.line.setAttribute('y1', String(r.y));
      tag.line.setAttribute('x2', String(x)); tag.line.setAttribute('y2', String(y + h / 2));
      if (!tag.on) { tag.el.style.display = ''; tag.line.style.display = ''; tag.on = true; }
      seen.add(r.t.id);
    }
    for (const [id, tag] of this.tags) {
      if (!seen.has(id) && tag.on) { tag.el.style.display = 'none'; tag.line.style.display = 'none'; tag.on = false; }
    }
  }

  private tag(id: string, strong = false): Tag {
    let t = this.tags.get(id);
    if (t) return t;
    const el = document.createElement('div');
    el.className = 'roman-tag' + (strong ? ' strong' : '');
    Object.assign(el.style, {
      position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', font: '500 11px/18px "Overpass Mono", ui-monospace, monospace',
      padding: '1px 7px', background: 'rgba(0,0,0,0.6)', color: strong ? 'var(--live, #44ff44)' : 'rgba(242,241,236,0.86)',
      borderLeft: `1px solid ${strong ? 'var(--live, #44ff44)' : 'rgba(242,241,236,0.4)'}`, display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', strong ? 'var(--live, #44ff44)' : 'rgba(242,241,236,0.38)');
    line.setAttribute('stroke-width', '1');
    line.style.display = 'none';
    this.svg.append(line);
    this.tagHost.append(el);
    t = { el, line, on: false };
    this.tags.set(id, t);
    return t;
  }

  dispose() {
    for (const f of this.cleanup) f();
    this.light?.dispose();
    this.leaderMat.dispose();
    this.ghostMat.dispose();
    for (const g of this.ghosts.children) (g as THREE.LineSegments).geometry.dispose();
    this.sunlight.dispose();
    this.downlink?.dispose();
    this.exposureTex?.dispose();
    this.tagHost.remove();
  }
}
