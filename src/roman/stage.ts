/**
 * The explorer's 3D stage: renderer, light, camera, and every visual state the
 * chapters drive — focus, ghosting, cutaway, explode, deploy, the light path,
 * and the sky painted on the detectors.
 *
 * States are goals the frame loop eases toward, so any chapter can hand over to
 * any other mid-motion without a pop. The camera is the one exception: it is
 * keyframed, because the signature move — sky, focal plane, back out through
 * the optics — is a path, not a destination. Dragging always wins over both.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { loadRomanModel, boundsOf, subsystemOf, partOf, LENGTH, type RomanModel } from './model';
import { LightPath } from './lightpath';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { num } from './dims';

/** The Sun, from the sun side (+Z), a little high and to the right. */
export const SUN_DIR = new THREE.Vector3(0.42, 0.34, 1).normalize();

export interface Pose { target: THREE.Vector3; dist: number; theta: number; phi: number }

const clonePose = (p: Pose): Pose => ({ target: p.target.clone(), dist: p.dist, theta: p.theta, phi: p.phi });
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (cur: number, goal: number, k: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-k * dt));

/** Subsystems the section plane cuts: the shells around the optics. */
const CUT: ReadonlySet<string> = new Set([
  'TEL.OuterBarrelAssembly', 'TEL.DeployableApertureCover', 'SOLAR_ARRAY_SUN_SHIELD',
  'TEL.ForwardStructureAssembly', 'OSS.PrimaryStructure', 'OSS.LowerInstrumentSunShade',
  'INSTRUMENT_CARRIER', 'WIDE_FIELD_INSTRUMENT', 'CORONAGRAPH_INSTRUMENT', 'OSS.LaunchVehicleAdapter',
]);

/** Where each subsystem goes in the exploded view, in metres at full explode. */
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

function softDot(size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * L2 has no Earth below to fill the shadows: one brutal sun and black. That is
 * correct and unreadable, so two dim reflection cards give the metals shape the
 * way a studio would, while the sky itself stays black.
 */
function makeL2Environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float h = vN.y * 0.5 + 0.5; gl_FragColor = vec4(mix(vec3(0.004,0.005,0.008), vec3(0.03,0.034,0.042), h), 1.0); }',
  }));
  env.add(sky);
  const card = (w: number, h: number, color: number, gain: number, pos: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    (m.material as THREE.MeshBasicMaterial).color.multiplyScalar(gain);
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  card(26, 18, 0xfff1dc, 1.6, SUN_DIR.clone().multiplyScalar(38).add(new THREE.Vector3(0, 6, 0)));
  card(30, 10, 0x9fb4d6, 0.35, SUN_DIR.clone().multiplyScalar(-38));
  card(40, 6, 0xffffff, 0.5, new THREE.Vector3(0, 40, 0));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  (sun.material as THREE.MeshBasicMaterial).color.setScalar(40);
  sun.position.copy(SUN_DIR).multiplyScalar(44);
  env.add(sun);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  });
  return tex;
}

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uStrength: { value: 0.42 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uStrength; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(1.0 - uStrength, 1.0, v);
      c.rgb += (h(vUv * 1024.0) - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};

export type PickHit = { part: string; subsystem: string; point: THREE.Vector3 };

export class RomanStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.03, 900);
  model: RomanModel | null = null;
  light: LightPath | null = null;
  ready: Promise<RomanModel>;

  /** Called every frame after rendering, for DOM overlays that track 3D points. */
  onFrame: (() => void) | null = null;

  // --- goals the frame loop eases toward ---------------------------------
  explodeGoal = 0; private explode = 0;
  cutGoal = 0; private cut = 0;
  /** 0 stowed … 1 deployed, per mechanism. */
  deployGoal = { liss: 1, sass: 1, hga: 1, dac: 1 };
  private deployNow = { liss: 1, sass: 1, hga: 1, dac: 1 };
  lightGoal = { progress: 0, opacity: 0, cgi: false };
  private lightNow = { progress: 0, opacity: 0 };
  skyGainGoal = 0; private skyGain = 0;
  /** Subsystems in focus; everything else ghosts. null = all in focus. */
  focus: Set<string> | null = null;
  /** Subsystems to fade out entirely. */
  hidden = new Set<string>();
  /** Parts to fade out entirely, by name prefix (e.g. the WFI housing). */
  hiddenParts: string[] = [];
  /** When set, only parts with these name prefixes are drawn at all. */
  solo: string[] | null = null;
  /** Sunlight striking the shield, and the downlink leaving the antenna. */
  sunGoal = 0; private sun = 0;
  beamGoal = 0; private beam = 0;
  hoverPart: string | null = null;
  selectedPart: string | null = null;
  selectedSubsystem: string | null = null;
  autorotate = true;

  // --- camera --------------------------------------------------------------
  pose: Pose = { target: new THREE.Vector3(0, LENGTH / 2, 0), dist: 40, theta: 0.9, phi: 1.28 };
  private flight: { from: Pose[]; t: number; dur: number; resolve: () => void } | null = null;
  private dragging = false;

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private vignette: ShaderPass | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private key: THREE.DirectionalLight;
  private stars: THREE.Group;
  private effects: { group: THREE.Group; sun: LineMaterial; beam: LineMaterial; sunGroup: THREE.Group; beamGroup: THREE.Group };
  private raf = 0;
  private clock = new THREE.Clock();
  private ro: ResizeObserver;
  private disposed = false;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Selection tint: the theme's live green, softened toward white. */
  private live = new THREE.Color(0x8cff8c);
  private cleanup: (() => void)[] = [];

  constructor(readonly host: HTMLElement) {
    const mobile = Math.min(innerWidth, innerHeight) < 600;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', outline: 'none' });
    canvas.tabIndex = -1;
    host.appendChild(canvas);

    this.scene.background = new THREE.Color(0x000000);
    this.scene.environment = makeL2Environment(this.renderer);
    this.scene.environmentIntensity = 0.9;

    this.key = new THREE.DirectionalLight(0xfff3e2, 3.9);
    this.key.position.copy(SUN_DIR).multiplyScalar(30).add(new THREE.Vector3(0, LENGTH / 2, 0));
    this.key.target.position.set(0, LENGTH / 2, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
    Object.assign(this.key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 5, far: 60 });
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0x8fa6c8, 0.32);
    fill.position.copy(SUN_DIR).multiplyScalar(-30).add(new THREE.Vector3(0, 8, 0));
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x1a2030, 0.35));

    this.stars = this.makeStars();
    this.scene.add(this.stars);
    this.effects = this.makeEffects();
    this.scene.add(this.effects.group);

    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.45, 0.9);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.vignette = new ShaderPass(VignetteShader);
      composer.addPass(this.vignette);
      this.composer = composer;
    } catch {
      this.composer = null;
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput(canvas);

    this.ready = loadRomanModel().then(async (model) => {
      if (this.disposed) return model;
      // Fix every shader variant now, once. `transparent`, `side` and the
      // clipping-plane count are compile-time defines in three.js, so toggling
      // them per chapter recompiles programs synchronously — which a busy GPU
      // turns into a visible freeze. Every material can fade, and every shell
      // the section plane cuts keeps the plane (parked far away when unused).
      // The model is cached across openings, so this also re-points the plane
      // at this stage.
      for (const mesh of model.meshes) {
        const mat = mesh.material as THREE.Material;
        if (mat.name === 'Detector') continue;
        mat.transparent = true;
        const cutMe = CUT.has(subsystemOf(mesh) ?? '');
        mat.clippingPlanes = cutMe ? [this.clip] : null;
        mat.side = cutMe ? THREE.DoubleSide : THREE.FrontSide;
        mat.needsUpdate = true;
      }
      this.model = model;
      this.scene.add(model.root);
      this.light = new LightPath(model);
      this.scene.add(this.light.group);
      const dish = model.byPart.get('HGA.Feed') ?? model.byPart.get('HGA.Dish');
      if (dish && this.pendingBeam) this.pendingBeam(boundsOf([dish]).getCenter(new THREE.Vector3()));
      this.resize();
      this.pose = this.shot('overview');
      this.place(this.camera, this.pose);
      // Compile everything off the critical path while the loading state shows.
      // compileAsync skips hidden objects, so show the beams for the pass.
      this.light.set(this.light.length, true, 1);
      this.effects.sunGroup.visible = this.effects.beamGroup.visible = true;
      // Capped: a hidden tab never resolves it, and a slow GPU may take long.
      try {
        await Promise.race([this.renderer.compileAsync(this.scene, this.camera), new Promise((r) => setTimeout(r, 6000))]);
      } catch { /* compiles lazily instead */ }
      this.light.set(0, false, 0);
      this.effects.sunGroup.visible = this.effects.beamGroup.visible = false;
      return model;
    });
    this.tick();
  }

  /* ------------------------------------------------------------ backdrop -- */

  private makeStars(): THREE.Group {
    const g = new THREE.Group();
    const dot = softDot();
    const layer = (n: number, size: number, bright: number, seed: number) => {
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 380;
        const q = Math.sqrt(1 - u * u);
        pos.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3);
        c.setHSL(0.08 + rnd() * 0.5 * (rnd() < 0.7 ? 0.1 : 1), 0.35, (0.35 + rnd() * 0.65) * bright);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({
        size, map: dot, vertexColors: true, transparent: true, depthWrite: false,
        sizeAttenuation: false, blending: THREE.AdditiveBlending,
      });
      g.add(new THREE.Points(geo, m));
    };
    layer(5200, 1.6, 0.7, 11);
    layer(420, 3.2, 1.0, 29);
    // The Sun itself, far out along its direction: a glare, not a disc.
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xfff4e0, blending: THREE.AdditiveBlending, depthWrite: false }));
    sun.position.copy(SUN_DIR).multiplyScalar(360);
    sun.scale.setScalar(60);
    sun.material.color.multiplyScalar(3);
    g.add(sun);
    return g;
  }

  /**
   * Parallel sunlight arriving on the shield, and the Ka-band downlink leaving
   * the dish toward Earth — which, seen from L2, is almost in the Sun's
   * direction. Both are dashed lines whose dashes run with time.
   */
  private makeEffects() {
    const group = new THREE.Group();
    const mk = (color: number, width: number) => new LineMaterial({
      color, linewidth: width, transparent: true, opacity: 0, dashed: true,
      dashSize: 0.5, gapSize: 1.1, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sun = mk(0xffe7b0, 1.4), beam = mk(0x44ff44, 2.2);
    const sunGroup = new THREE.Group(), beamGroup = new THREE.Group();
    const line = (a: THREE.Vector3, b: THREE.Vector3, m: LineMaterial, into: THREE.Group) => {
      const g = new LineGeometry();
      g.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const l = new Line2(g, m);
      l.computeLineDistances();
      l.frustumCulled = false;
      into.add(l);
    };
    // Rays ending on the shield's plane (z ≈ 2.6), spread over its face.
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const end = new THREE.Vector3(-1.8 + i * 0.9, 3.0 + j * 1.25, 2.72);
        line(end.clone().addScaledVector(SUN_DIR, 7), end, sun, sunGroup);
      }
    }
    group.add(sunGroup, beamGroup);
    this.pendingBeam = (from: THREE.Vector3) => {
      for (let k = 0; k < 5; k++) {
        const off = new THREE.Vector3(Math.cos(k * 1.26), Math.sin(k * 1.26), 0).multiplyScalar(k ? 0.25 : 0);
        const a = from.clone().add(off);
        line(a, a.clone().addScaledVector(SUN_DIR, 40), beam, beamGroup);
      }
    };
    return { group, sun, beam, sunGroup, beamGroup };
  }
  private pendingBeam: ((from: THREE.Vector3) => void) | null = null;

  /* -------------------------------------------------------------- shots -- */

  private get aspect() { return this.camera.aspect || 1.6; }

  /** Distance at which a box of the given size fills `frac` of the view. */
  private fitDist(w: number, h: number, frac = 0.8) {
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * this.aspect);
    return Math.max(h / 2 / Math.tan(vf), w / 2 / Math.tan(hf)) / frac;
  }

  /** Named camera poses, computed from the model's own geometry. */
  shot(name: string): Pose {
    const m = this.model;
    const mid = new THREE.Vector3(0, LENGTH / 2, 0);
    const portrait = this.aspect < 1;
    switch (name) {
      case 'focal': {
        const b = m ? boundsOf(m.detectors) : new THREE.Box3(new THREE.Vector3(0.35, 3.37, -0.5), new THREE.Vector3(1.15, 3.4, -0.1));
        const c = b.getCenter(new THREE.Vector3());
        const s = b.getSize(new THREE.Vector3());
        // Straight down. Landscape: the six columns run across the screen;
        // portrait: rotate a quarter turn so they run down it.
        // Portrait: the mosaic sits in the band between the masthead and the
        // chapter copy, a third of the screen tall.
        const d = portrait ? this.fitDist(s.z, s.x, 0.34) : this.fitDist(s.x, s.z, 0.5);
        const pose: Pose = { target: c.clone(), dist: d, theta: portrait ? -Math.PI / 2 : 0, phi: 0.0009 };
        // Frame the mosaic clear of the chapter copy: right of it on wide
        // screens, above it on tall ones. Shift the look-at point along the
        // camera's own screen axes.
        const cam = this.poseCamera(pose);
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
        const visH = 2 * d * Math.tan(vf), visW = visH * this.aspect;
        if (portrait) pose.target.addScaledVector(up, -0.2 * visH);
        else pose.target.addScaledVector(right, -0.14 * visW);
        return pose;
      }
      case 'optics':
        return { target: new THREE.Vector3(0, 6.0, 0), dist: this.fitDist(4.4, 10.5, 0.92), theta: 0.55, phi: 1.42 };
      case 'aft':
        return { target: new THREE.Vector3(0.15, 4.1, -0.1), dist: this.fitDist(2.6, 2.4, 0.8), theta: 0.9, phi: 1.2 };
      case 'coronagraph':
        return { target: new THREE.Vector3(-0.35, 4.15, -0.25), dist: this.fitDist(2.6, 2.2, 0.75), theta: -0.7, phi: 1.25 };
      case 'deploy':
        return { target: mid.clone().setY(6.2), dist: this.fitDist(9, 14.5, 0.86), theta: 0.45, phi: 1.34 };
      case 'thermal':
        // Side-on to the Sun, which arrives from screen right: the shield
        // edge-on in front, the telescope in its shade behind.
        return this.shift({ target: mid.clone().setY(5.9), dist: this.fitDist(10, 14, 0.8), theta: -1.17, phi: 1.4 }, portrait ? 0 : 0.12, 0);
      case 'comms': {
        const dish = m?.byPart.get('HGA.Dish');
        const c = dish ? boundsOf([dish]).getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.9, 2.3);
        // Three-quarter from the sun side: the array's cells in view, the dish
        // below them, the downlink leaving toward screen right.
        return this.shift({ target: c.setY(c.y + 2.2).setZ(c.z - 0.9), dist: this.fitDist(9, 11, 0.82), theta: -0.5, phi: 1.5 }, portrait ? 0 : 0.12, 0);
      }
      case 'explore':
        return { target: mid.clone(), dist: this.fitDist(9, 17, 0.82), theta: 0.8, phi: 1.3 };
      case 'overview':
      default:
        return { target: mid.clone(), dist: this.fitDist(4.6, LENGTH, portrait ? 0.78 : 0.86), theta: 0.8, phi: 1.3 };
    }
  }

  /** Slide a pose's subject across the screen by fractions of the view. */
  shift(p: Pose, fx: number, fy: number): Pose {
    const cam = this.poseCamera(p);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const visH = 2 * p.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    p.target.addScaledVector(right, -fx * visH * this.aspect).addScaledVector(up, -fy * visH);
    return p;
  }

  /** Frame a subsystem or a single part. */
  shotOf(meshes: THREE.Object3D[], from: Pose = this.pose): Pose {
    const b = boundsOf(meshes);
    const s = b.getSize(new THREE.Vector3());
    return {
      target: b.getCenter(new THREE.Vector3()),
      dist: THREE.MathUtils.clamp(this.fitDist(Math.max(s.x, s.z), s.y, 0.42), 1.6, 60),
      theta: from.theta, phi: THREE.MathUtils.clamp(from.phi, 0.5, 2.2),
    };
  }

  /** Fly through a list of poses, smoothly, in `dur` seconds. */
  fly(poses: Pose[], dur = 2.2): Promise<void> {
    this.flight?.resolve();
    if (this.reducedMotion || dur <= 0) {
      this.pose = clonePose(poses[poses.length - 1]);
      this.flight = null;
      return Promise.resolve();
    }
    // Take the short way round in theta from wherever the user left it.
    const start = clonePose(this.pose);
    const path = [start, ...poses.map(clonePose)];
    for (let i = 1; i < path.length; i++) {
      let d = path[i].theta - path[i - 1].theta;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      path[i].theta = path[i - 1].theta + d;
    }
    return new Promise((resolve) => { this.flight = { from: path, t: 0, dur, resolve }; });
  }

  get flying() { return !!this.flight; }

  private stepFlight(dt: number) {
    const f = this.flight;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / f.dur);
    const e = easeInOut(f.t);
    const n = f.from.length - 1;
    const x = e * n, i = Math.min(n - 1, Math.floor(x)), u = x - i;
    // Catmull-Rom across keyframes, per channel.
    const P = (k: number) => f.from[THREE.MathUtils.clamp(k, 0, n)];
    const cr = (a: number, b: number, c: number, d: number) =>
      0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    this.pose.target.set(
      cr(p0.target.x, p1.target.x, p2.target.x, p3.target.x),
      cr(p0.target.y, p1.target.y, p2.target.y, p3.target.y),
      cr(p0.target.z, p1.target.z, p2.target.z, p3.target.z),
    );
    // Distance interpolates in log space so long pull-backs feel even.
    this.pose.dist = Math.exp(cr(Math.log(p0.dist), Math.log(p1.dist), Math.log(p2.dist), Math.log(p3.dist)));
    this.pose.theta = cr(p0.theta, p1.theta, p2.theta, p3.theta);
    this.pose.phi = THREE.MathUtils.clamp(cr(p0.phi, p1.phi, p2.phi, p3.phi), 0.0008, Math.PI - 0.05);
    if (f.t >= 1) {
      this.flight = null;
      f.resolve();
    }
  }

  /* -------------------------------------------------------------- input -- */

  private bindInput(canvas: HTMLCanvasElement) {
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        this.hoverAt(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 4) return;
      this.takeControl();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.zoom(pinch / d);
        pinch = d;
        return;
      }
      this.pose.theta -= dx * 0.0055;
      this.pose.phi = THREE.MathUtils.clamp(this.pose.phi - dy * 0.0055, 0.08, Math.PI - 0.08);
    };
    const up = (e: PointerEvent) => {
      const was = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      this.dragging = pointers.size > 0;
      if (pointers.size < 2) pinch = 0;
      if (was && moved < 5 && e.type === 'pointerup') this.onPick?.(this.pickAt(e.clientX, e.clientY));
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.takeControl();
      this.zoom(Math.exp(e.deltaY * 0.0011));
    };
    const leave = () => { if (this.hoverPart) { this.hoverPart = null; this.onHover?.(null); } };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  onPick: ((hit: PickHit | null) => void) | null = null;
  onHover: ((hit: PickHit | null) => void) | null = null;
  /** Fired the first time the user grabs the camera during a flight. */
  onTakeControl: (() => void) | null = null;

  private takeControl() {
    this.autorotate = false;
    if (this.flight) {
      const f = this.flight;
      this.flight = null;
      f.resolve();
      this.onTakeControl?.();
    }
  }

  private zoom(k: number) {
    this.pose.dist = THREE.MathUtils.clamp(this.pose.dist * k, 0.35, 90);
  }

  private raycaster = new THREE.Raycaster();

  pickAt(x: number, y: number): PickHit | null {
    if (!this.model) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.raycaster.intersectObjects(this.model.meshes, false);
    for (const h of hits) {
      const mesh = h.object as THREE.Mesh;
      const mat = mesh.material as THREE.Material;
      if (!mesh.visible || mat.opacity < 0.5) continue;
      const sub = subsystemOf(mesh);
      // The raycaster ignores clipping; skip what the section plane removed.
      if (sub && CUT.has(sub) && this.cut > 0.02 && this.clip.distanceToPoint(h.point) < 0) continue;
      return { part: partOf(mesh) ?? '', subsystem: sub ?? '', point: h.point.clone() };
    }
    return null;
  }

  private hoverAt(x: number, y: number) {
    if (!this.onHover) return;
    const hit = this.pickAt(x, y);
    const part = hit?.part ?? null;
    if (part !== this.hoverPart) {
      this.hoverPart = part;
      this.renderer.domElement.style.cursor = part ? 'pointer' : 'grab';
      this.onHover(hit);
    }
  }

  /* --------------------------------------------------------------- frame -- */

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.light?.setResolution(w * pr, h * pr);
    this.effects?.sun.resolution.set(w * pr, h * pr);
    this.effects?.beam.resolution.set(w * pr, h * pr);
    this.onResize?.();
  }

  onResize: (() => void) | null = null;

  /** World → CSS pixels within the host. `z > 1` means behind the camera. */
  project(v: THREE.Vector3, out = { x: 0, y: 0, z: 0 }) {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.host.clientWidth;
    out.y = (-p.y * 0.5 + 0.5) * this.host.clientHeight;
    out.z = p.z;
    return out;
  }

  /** The camera matrices for a pose, without moving the live camera. */
  poseCamera(p: Pose): THREE.PerspectiveCamera {
    const cam = this.camera.clone();
    this.place(cam, p);
    cam.updateMatrixWorld(true);
    return cam;
  }

  private place(cam: THREE.PerspectiveCamera, p: Pose) {
    const off = new THREE.Vector3().setFromSphericalCoords(p.dist, p.phi, p.theta);
    cam.position.copy(p.target).add(off);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.target);
  }

  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const k = this.reducedMotion ? 60 : 4.5;

    this.stepFlight(dt);
    if (this.autorotate && !this.flight && !this.dragging) this.pose.theta += dt * 0.05;
    this.place(this.camera, this.pose);
    // A near plane that follows the distance keeps close-ups crisp and long
    // shots free of z-fighting on the nested shells.
    this.camera.near = THREE.MathUtils.clamp(this.pose.dist * 0.02, 0.01, 0.4);
    this.camera.updateProjectionMatrix();

    this.explode = damp(this.explode, this.explodeGoal, k * 0.7, dt);
    this.cut = damp(this.cut, this.cutGoal, k, dt);
    this.skyGain = damp(this.skyGain, this.skyGainGoal, k, dt);
    for (const key of ['liss', 'sass', 'hga', 'dac'] as const) this.deployNow[key] = damp(this.deployNow[key], this.deployGoal[key], k * 0.8, dt);
    this.lightNow.opacity = damp(this.lightNow.opacity, this.lightGoal.opacity, k, dt);
    this.sun = damp(this.sun, this.sunGoal, k, dt);
    this.beam = damp(this.beam, this.beamGoal, k, dt);
    const fx = this.effects;
    fx.sun.opacity = 0.55 * this.sun; fx.sunGroup.visible = this.sun > 0.01;
    fx.beam.opacity = 0.9 * this.beam; fx.beamGroup.visible = this.beam > 0.01;
    fx.sun.dashOffset -= dt * 3.2;
    fx.beam.dashOffset -= dt * 5.5;
    this.lightNow.progress = this.lightGoal.progress;

    if (this.model) this.apply(dt);
    if (this.light) {
      this.light.set(this.lightNow.progress, this.lightGoal.cgi, this.lightNow.opacity);
      this.light.tick(dt, this.lightNow.progress);
    }
    if (this.vignette) this.vignette.uniforms.uTime.value = (this.vignette.uniforms.uTime.value + dt) % 100;
    this.stars.position.copy(this.camera.position);

    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  };

  private apply(dt: number) {
    const m = this.model!;
    // Section plane: vertical, through the long axis, facing away from the
    // camera, so the near half is always the half that is cut away.
    const n = new THREE.Vector3().subVectors(this.pose.target, this.camera.position).setY(0);
    if (n.lengthSq() < 1e-6) n.set(0, 0, -1);
    n.normalize();
    // Parked 12 m toward the camera when not cutting: clear of everything,
    // exploded view included.
    const axis = new THREE.Vector3(0, 0, 0).addScaledVector(n, -(1 - this.cut) * (1 - this.cut) * 12);
    this.clip.setFromNormalAndCoplanarPoint(n, axis);

    const e = this.explode;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380);
    for (const mesh of m.meshes) {
      const sub = subsystemOf(mesh) ?? '';
      const part = partOf(mesh);
      const mat = mesh.material as THREE.MeshStandardMaterial;

      const off = EXPLODE[sub];
      if (off && sub !== 'TEL.DeployableApertureCover') {
        const b = mesh.userData.basePosition as THREE.Vector3;
        mesh.position.set(b.x + off[0] * e, b.y + off[1] * e, b.z + off[2] * e);
      }

      const inFocus = !this.focus || this.focus.has(sub);
      const pn = part ?? '';
      const gone = this.hidden.has(sub) || this.hiddenParts.some((p) => pn.startsWith(p))
        || (this.solo !== null && !this.solo.some((p) => pn.startsWith(p)));
      const goal = gone ? 0 : inFocus ? 1 : 0.1;
      const a = mesh.userData.alpha ?? 1;
      const next = damp(a, goal, 5, dt);
      mesh.userData.alpha = next;
      mesh.visible = next > 0.01;
      if (mat.name === 'Detector') {
        // One shared material across all eighteen: fade via visibility only.
        mesh.visible = next > 0.5;
      } else {
        mat.opacity = next;
        mat.depthWrite = next > 0.5;
        // Shadow maps ignore the section plane; a cut shell must not shade
        // the interior it no longer covers.
        mesh.castShadow = !(CUT.has(sub) && this.cut > 0.02);

        // Kept low: on a mirror, which reflects black space, any emissive
        // tint is all you see.
        const hl = part && part === this.selectedPart ? 0.12 + 0.1 * pulse
          : part && part === this.hoverPart ? 0.1
          : sub && sub === this.selectedSubsystem && !this.selectedPart ? 0.015 + 0.02 * pulse : 0;
        mat.emissive.copy(this.live);
        mat.emissiveIntensity = hl;
      }
    }

    if (m.dac) {
      const s = num('DAC_H_STOWED') / num('DAC_H_DEPLOYED');
      m.dac.scale.y = s + (1 - s) * this.deployNow.dac;
      const b = m.dac.userData.basePosition as THREE.Vector3 | undefined;
      const off = EXPLODE['TEL.DeployableApertureCover'];
      if (b) m.dac.position.set(b.x + off[0] * e, b.y + off[1] * e, b.z + off[2] * e);
    }
    for (const d of m.deployables) {
      const sub = subsystemOf(d.node);
      const which = sub === 'OSS.LowerInstrumentSunShade' ? this.deployNow.liss
        : sub === 'COMMUNICATIONS' ? this.deployNow.hga : this.deployNow.sass;
      d.node.rotation[d.axis] = d.base + (1 - which) * d.stowed;
    }
    m.sky.gain.value = this.skyGain;
  }

  /* ------------------------------------------------------------ the sky -- */

  /** Paint the sky onto the detectors as seen from `pose`. */
  setSkyProjection(tex: THREE.Texture, pose: Pose) {
    if (!this.model) return;
    const cam = this.poseCamera(pose);
    this.model.sky.map.value = tex;
    this.model.sky.vp.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  /** Each detector's top face, in CSS pixels, as seen from `pose`. */
  detectorOutlines(pose: Pose): { x: number; y: number }[][] {
    if (!this.model) return [];
    const cam = this.poseCamera(pose);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    return this.model.detectors.map((d) => {
      d.updateWorldMatrix(true, false);
      const g = d.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox!;
      const corners = [
        [bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.max.x, bb.max.z], [bb.min.x, bb.max.z],
      ].map(([x, z]) => new THREE.Vector3(x, bb.max.y, z).applyMatrix4(d.matrixWorld).project(cam));
      return corners.map((p) => ({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h }));
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    this.flight?.resolve();
    if (this.model) this.scene.remove(this.model.root);   // cached; reused on reopen
    this.light?.dispose();
    this.scene.environment?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
