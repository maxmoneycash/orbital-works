/**
 * Roman in orbit, on the globe: the observatory itself, where the ephemeris
 * puts it, lit by the Sun where the Sun is.
 *
 * This layer draws; it does not decide. Each frame it is handed one state —
 * how far it is cut open, taken apart and unfolded, how much of the light
 * path is lit, how far an exposure has built, which streams run, which parts
 * are named — and eases nothing itself, so a scroll can scrub every one of
 * them forward and back. The story (roman-story.ts) sets the state.
 *
 * Real, whatever the state: the shield faces the Sun, the gimballed antenna
 * tracks Earth, and the attitude follows the ephemeris.
 *
 * Every shader variant is fixed at load. `side`, `transparent` and the number
 * of clipping planes are compile-time defines in three.js, so toggling them
 * mid-scroll would recompile programs; the cut shells keep the plane for
 * good, parked clear of the model when nothing is cut.
 */
import * as THREE from 'three';
import { loadRomanModel, boundsOf, subsystemOf, partOf, LENGTH, type RomanModel } from '../roman/model';
import { LightPath } from '../roman/lightpath';
import { Exposure, type FieldKind } from '../roman/imaging';
import { num } from '../roman/dims';
import { SUN_DIR, makeL2Environment } from '../roman/l2-light';

/**
 * Roman drawn to scale would be four millionths of a draw unit. Close in, it
 * is shown this much larger, about 60,000 times, and the story says so.
 */
export const MODEL_SCALE = 0.02;

/** A name pinned to a point on the model, in the model's own metres. */
export interface OrbitLabel { id: string; text: string; at: THREE.Vector3; strong?: boolean; alpha?: number }

export interface OrbitState {
  cut: number;
  /**
   * 0 … 1: a scan line sweeping down the observatory, aperture to base, that
   * turns the hardware it passes into a see-through x-ray. Mirrors and
   * detectors stay solid, so the light can be followed through them.
   */
  xray: number;
  explode: number;
  /** 0 folded for launch … 1 deployed, per mechanism. */
  deploy: { liss: number; sass: number; hga: number; dac: number };
  /** 0 … 1 of the light path lit, from the aperture in. */
  light: number;
  /** Photons streaming along the lit path, 0 … 1. */
  photons: number;
  /** Frames integrated on the detectors (0: dark), and how far the readout has swept. */
  frames: number;
  readout: number;
  field: { kind: FieldKind; seed: number };
  sun: number;
  beam: number;
  /** Roll about the Sun line from the upright pose, radians. */
  roll: number;
  labels: OrbitLabel[];
}

export const REST: OrbitState = {
  cut: 0, xray: 0, explode: 0, deploy: { liss: 1, sass: 1, hga: 1, dac: 1 }, light: 0, photons: 0,
  frames: 0, readout: 0, field: { kind: 'deep', seed: 11 }, sun: 0, beam: 0, roll: 0, labels: [],
};

/** Shells the section plane cuts. */
const CUT: ReadonlySet<string> = new Set([
  'TEL.OuterBarrelAssembly', 'TEL.DeployableApertureCover', 'SOLAR_ARRAY_SUN_SHIELD',
  'TEL.ForwardStructureAssembly', 'OSS.PrimaryStructure', 'OSS.LowerInstrumentSunShade',
  'INSTRUMENT_CARRIER', 'WIDE_FIELD_INSTRUMENT', 'CORONAGRAPH_INSTRUMENT', 'OSS.LaunchVehicleAdapter',
]);

/** Where each subsystem goes when the observatory is taken apart, in metres. */
export const EXPLODE: Record<string, [number, number, number]> = {
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

/** Parts that turn with the antenna's gimbal; the boom and azimuth mount stay put. */
const GIMBALLED = ['HGA.Dish', 'HGA.Feed', 'HGA.FeedStrut', 'HGA.GimbalElevation'];
/** How far the gimbal can swing the dish off its rest axis. */
const GIMBAL_LIMIT = THREE.MathUtils.degToRad(75);
/** The cut shells' lining, lifted off black while cut so the section reads against space. */
const LINING_CUT = new THREE.Color(0x3a3d44);
/** The scan runs from above the aperture to below the adapter, in metres along the long axis. */
const SCAN_TOP = 13.6, SCAN_BOTTOM = -3.4;
/** Materials the x-ray leaves solid: what the light meets. */
const STAYS_SOLID: ReadonlySet<string> = new Set(['Mirror', 'Detector', 'Filter']);

/**
 * The x-ray: faces glow by how edge-on they are (a Fresnel rim), with a faint
 * fill, and a bright band where the scan line is passing.
 */
function xrayMaterial(plane: THREE.Plane, band: { value: THREE.Vector4 }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    clipping: true, clippingPlanes: [plane],
    uniforms: { uColor: { value: new THREE.Color(0xa9c4ff) }, uOpacity: { value: 0 }, uBand: band },
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = -mvPosition.xyz; vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; uniform vec4 uBand;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        // The band: the scan front, uBand.xyz its plane normal, w its offset.
        float d = abs(dot(uBand.xyz, vW) + uBand.w);
        float band = exp(-d * d * 1.5e5) * 1.4;
        float a = (0.022 + f * 0.8) * uOpacity + band * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

interface Tag { el: HTMLDivElement; text: HTMLSpanElement; dot: HTMLSpanElement; line: SVGLineElement; on: boolean }

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
  /** The roll about the Sun line. */
  private frame = new THREE.Group();
  /** The model's own frame, in metres: y 0 at the launch adapter, +z the sun side. */
  readonly body = new THREE.Group();
  model: RomanModel | null = null;
  light: LightPath | null = null;
  /** Set by the owner: whether the model is drawn at all this frame. */
  visible = false;
  /** Where each subsystem sits, assembled, in the model's metres. */
  readonly centres = new Map<string, THREE.Vector3>();

  private clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  /** The scan: solid is kept below it, x-ray drawn above it. */
  private scanSolid = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private scanXray = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private scanBand = { value: new THREE.Vector4(0, 1, 0, 1e6) };
  private xrayMat: THREE.ShaderMaterial;
  /** The light's front as it travels in: a bright point leading the lit path. */
  private front: THREE.Sprite;
  private sunLight = new THREE.DirectionalLight(0xfff1de, 3.4);
  /** Sky above, a warm floor below: shade that still reads, as in a studio. */
  private sky = new THREE.HemisphereLight(0xc4d4ee, 0x2b2622, 1.1);
  private fill = new THREE.DirectionalLight(0xd6e0f0, 0.55);
  /** A cool edge from behind, so silhouettes read against black. */
  private rim = new THREE.DirectionalLight(0xb4ccf0, 0.9);

  private sunlight: Stream;
  private downlink: Stream | null = null;
  private beamGroup = new THREE.Group();
  private gimbal: THREE.Group | null = null;
  private bore = new THREE.Vector3(0, 0, 1);
  private gimbalQ = new THREE.Quaternion();
  private feed = new THREE.Object3D();
  private wfiHousing: THREE.Mesh[] = [];
  /**
   * The element wheel and its slots, with their own materials. Solid while
   * the light crosses them; once the picture builds they turn to x-ray like
   * the rest, so the detectors behind them can be seen.
   */
  private wheel: { mesh: THREE.Mesh; own: THREE.Material }[] = [];
  private wheelGhost = false;
  private linings: THREE.MeshStandardMaterial[] = [];
  private mats: THREE.MeshStandardMaterial[] = [];
  private exposure: Exposure | null = null;
  private exposureTex: THREE.CanvasTexture | null = null;
  private skyCam: { P: THREE.Matrix4; local: THREE.Matrix4 } | null = null;
  private drawn = { frames: -1, readout: -1, kind: '', seed: -1 };
  private clock = 0;

  private tagHost: HTMLDivElement;
  private svg: SVGSVGElement;
  private tags = new Map<string, Tag>();

  private readonly reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private baseQ = new THREE.Quaternion();
  private euler = new THREE.Euler();

  constructor(private renderer: THREE.WebGLRenderer, uiRoot: HTMLElement) {
    this.holder.name = 'roman-in-orbit';
    this.holder.visible = false;
    this.holder.scale.setScalar(MODEL_SCALE);
    this.holder.add(this.frame);
    this.frame.add(this.body);
    this.body.position.set(0, -LENGTH / 2, 0);
    this.renderer.localClippingEnabled = true;
    this.xrayMat = xrayMaterial(this.scanXray, this.scanBand);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, 'rgba(235,245,255,0.7)'); grad.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.front = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.front.scale.setScalar(1.6);
    this.front.renderOrder = 20;
    this.front.visible = false;
    this.body.add(this.front);

    // Sunlight arriving on the shield's face (z ≈ 2.7 m): streaks drifting in
    // along the Sun's direction and ending on the array.
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const px = Math.min(devicePixelRatio || 1, 2);
    this.sunlight = stream({
      n: 150, dir: SUN_DIR, len: 12, tail: 2.2, speed: 0.2, size: 2.4 * px, color: 0xffd49a, inbound: true,
      lane: () => new THREE.Vector3(-2.3 + rnd() * 4.6, 2.6 + rnd() * 4.8, 2.74),
    });
    this.body.add(this.sunlight.obj);

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.setScalar(2048);
    Object.assign(this.sunLight.shadow.camera, { left: -0.22, right: 0.22, top: 0.22, bottom: -0.22, near: 0.4, far: 1.8 });
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.0006;
    for (const l of [this.sunLight, this.fill, this.rim]) l.target = this.holder;
    // The lights stay on for good. Nothing else in the globe's scene is lit,
    // and the number of visible lights is baked into every lit program, so
    // switching them with the model would recompile its shaders each time.

    this.tagHost = document.createElement('div');
    this.tagHost.className = 'roman-tags';
    Object.assign(this.tagHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', display: 'none', zIndex: '45' });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(this.svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' });
    this.tagHost.append(this.svg);
    uiRoot.prepend(this.tagHost);
  }

  /** The lights live beside the holder in the globe's scene; add them all. */
  get objects(): THREE.Object3D[] {
    return [this.holder, this.sunLight, this.sky, this.fill, this.rim];
  }

  /* ------------------------------------------------------------- loading -- */

  async load(camera: THREE.Camera) {
    const model = await loadRomanModel();
    const root = model.root;
    root.updateMatrixWorld(true);

    // Everything measured here is in the model's own frame: the root is not
    // parented yet, so world space is model space.
    this.light = new LightPath(model);
    for (const [sub, meshes] of model.bySubsystem) this.centres.set(sub, boundsOf(meshes).getCenter(new THREE.Vector3()));
    this.wfiHousing = model.meshes.filter((m) => (partOf(m) ?? '').startsWith('WFI.Body'));
    this.wheel = model.meshes.filter((m) => (partOf(m) ?? '').startsWith('WFI.Element'))
      .map((mesh) => ({ mesh, own: mesh.material as THREE.Material }));

    // The antenna's gimbal: the dish, feed and struts turn together about the
    // gimbal's centre. Their origins stay on the deploy hinge, so unfolding
    // still swings them out on it, with the gimbal at rest.
    const P = (p: string) => model.byPart.get(p);
    const dish = P('HGA.Dish'), feed = P('HGA.Feed'), elev = P('HGA.GimbalElevation');
    if (dish) this.centres.set('dish', boundsOf([dish]).getCenter(new THREE.Vector3()));
    if (dish && feed && elev && dish.parent) {
      const comms = dish.parent;
      const g = new THREE.Group();
      g.name = 'hga-gimbal';
      g.position.copy(comms.worldToLocal(boundsOf([elev]).getCenter(new THREE.Vector3())));
      comms.add(g);
      g.updateMatrixWorld(true);
      for (const m of model.meshes) {
        const pn = partOf(m) ?? '';
        if (GIMBALLED.some((p) => pn.startsWith(p))) { g.attach(m); m.userData.basePosition = m.position.clone(); }
      }
      const fc = boundsOf([feed]).getCenter(new THREE.Vector3()), dc = boundsOf([dish]).getCenter(new THREE.Vector3());
      this.bore.copy(comms.worldToLocal(fc.clone())).sub(comms.worldToLocal(dc.clone())).normalize();
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
    model.sky.map.value = this.exposureTex;
    this.skyCam = { P: cam.projectionMatrix.clone(), local: cam.matrixWorld.clone() };
    this.centres.set('focal-plane', c.clone().setY(bb.max.y));

    // Fix every material's variant now, once.
    const env = makeL2Environment(this.renderer);
    for (const mesh of model.meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mesh.castShadow = mesh.receiveShadow = true;
      if (mat.name === 'Detector') continue;
      const cutMe = CUT.has(subsystemOf(mesh) ?? '');
      const solid = STAYS_SOLID.has(mat.name);
      const planes = [...(cutMe ? [this.clip] : []), ...(solid ? [] : [this.scanSolid])];
      Object.assign(mat, {
        transparent: false, opacity: 1, depthWrite: true, envMap: env, envMapIntensity: mat.envMapIntensity === 1 ? 1.0 : mat.envMapIntensity,
        clippingPlanes: planes.length ? planes : null, side: cutMe ? THREE.DoubleSide : THREE.FrontSide,
        emissiveIntensity: 0,
      });
      // Its x-ray twin rides along as a child, so it follows every fold,
      // explode and gimbal the part makes.
      if (!solid) {
        const x = new THREE.Mesh(mesh.geometry, this.xrayMat);
        x.renderOrder = 8;
        x.castShadow = x.receiveShadow = false;
        x.userData.xray = true;
        mesh.add(x);
      }
      mat.needsUpdate = true;
      this.mats.push(mat);
      if (mat.userData.inner) this.linings.push(mat);
    }
    const det = model.detectors[0]?.material as THREE.MeshStandardMaterial | undefined;
    if (det) { det.envMap = env; det.needsUpdate = true; this.mats.push(det); }

    this.body.add(root, this.light.group);
    this.light.set(0, false, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.model = model;

    // Compile every program now, off the critical path, rather than in the
    // first frame the camera arrives. compileAsync skips hidden objects, so
    // everything the story can reveal is shown for the pass; capped, since a
    // hidden tab never resolves it.
    let scene: THREE.Object3D = this.holder;
    while (scene.parent) scene = scene.parent;
    const reveal = [this.holder, this.light.group, this.beamGroup, this.sunlight.obj];
    const was = reveal.map((o) => o.visible);
    for (const o of reveal) o.visible = true;
    this.light.set(this.light.length, false, 1);
    try {
      await Promise.race([
        this.renderer.compileAsync(this.holder, camera, (scene as THREE.Scene).isScene ? scene as THREE.Scene : null),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
    } catch { /* compiles lazily instead */ }
    reveal.forEach((o, i) => { o.visible = was[i]; });
    this.light.set(0, false, 0);
  }

  /* ------------------------------------------------------------ attitude -- */

  /**
   * The shield on the Sun leaves one angle free: the roll about the Sun
   * line. Where nothing else chooses it, it stands the telescope upright.
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

  /** Where the Ka-band stream leaves the dish, in the globe's frame. */
  feedWorld(out = new THREE.Vector3()) {
    return this.feed.getWorldPosition(out);
  }

  /** Earth's direction in the model's own frame (unit), as the gimbal sees it. */
  readonly earthLocal = new THREE.Vector3(0, 0, 1);

  setLive(c: THREE.Color) {
    this.downlink?.u.uColor.value.copy(c);
    this.light?.setLive(c);
  }

  /* --------------------------------------------------------------- frame -- */

  update(o: {
    draw: THREE.Vector3; toSun: THREE.Vector3; toEarth: THREE.Vector3;
    camera: THREE.PerspectiveCamera; dt: number; w: number; h: number; showTags: boolean;
    state: OrbitState;
    /** Screen rectangles the names stay out of (the story's words and controls). */
    avoid?: { x0: number; y0: number; x1: number; y1: number }[] | null;
  }) {
    const m = this.model;
    const s = o.state;
    // Where it is and which way it faces — the shield on the Sun, then the
    // roll — kept even while it isn't drawn, so a camera can frame it in its
    // own terms before arriving.
    this.holder.position.copy(o.draw);
    this.holder.quaternion.copy(this.attitude(o.toSun, this.baseQ));
    this.frame.quaternion.setFromAxisAngle(SUN_DIR, s.roll);
    this.holder.updateMatrixWorld(true);
    this.body.getWorldQuaternion(this.tmpQ);
    this.earthLocal.copy(o.toEarth).applyQuaternion(this.tmpQ.clone().invert()).normalize();

    const on = this.visible && !!m;
    this.holder.visible = on;
    this.tagHost.style.display = on && o.showTags ? '' : 'none';
    if (!on || !m) return;
    const dt = Math.min(o.dt, 0.1);
    this.clock += dt;

    // The antenna on Earth, once it is deployed.
    const g = this.gimbal;
    if (g?.parent) {
      g.parent.getWorldQuaternion(this.tmpQ).invert();
      const earth = this.tmp.copy(o.toEarth).applyQuaternion(this.tmpQ).normalize();
      const goal = new THREE.Quaternion().setFromUnitVectors(this.bore, earth);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(goal.w)));
      if (ang > GIMBAL_LIMIT) goal.slerp(new THREE.Quaternion(), 1 - GIMBAL_LIMIT / ang);
      this.gimbalQ.slerp(goal, 1 - Math.exp(-3 * dt));
      g.quaternion.identity().slerp(this.gimbalQ, s.deploy.hga);
    }

    // Lights: the Sun where it is; a soft fill from the viewer's side; a rim
    // from behind; reflections turned with the model.
    const size = MODEL_SCALE * LENGTH;
    this.sunLight.position.copy(o.draw).addScaledVector(o.toSun, size * 4);
    this.fill.position.copy(o.camera.position);
    this.rim.position.copy(o.draw).multiplyScalar(2).sub(o.camera.position).addScaledVector(o.camera.up, size * 2);
    this.sky.position.copy(o.draw).add(new THREE.Vector3(0, 1, 0).applyQuaternion(this.body.getWorldQuaternion(this.tmpQ)));
    this.body.getWorldQuaternion(this.tmpQ);
    this.euler.setFromQuaternion(this.tmpQ, 'ZYX');
    for (const mat of this.mats) mat.envMapRotation.set(this.euler.x, this.euler.y, this.euler.z, 'XYZ');

    this.applyParts(o.camera, s);

    // Streams.
    const motion = this.reducedMotion ? 0.25 : 1;
    this.sunlight.u.uTime.value += dt * motion;
    this.sunlight.u.uOpacity.value = 0.85 * s.sun;
    this.sunlight.obj.visible = s.sun > 0.01;
    if (this.downlink) {
      this.downlink.u.uTime.value += dt * motion;
      this.downlink.u.uOpacity.value = s.beam;
    }
    this.beamGroup.visible = s.beam > 0.01;

    // Light, and the picture it makes.
    const L = this.light!;
    L.setResolution(o.w, o.h);
    const lit = s.light >= 0.999 ? L.length : s.light * L.length;
    const seen = Math.max(s.cut > 0.2 ? 0.55 : 0, s.xray > 0.5 ? 0.95 : 0);
    L.set(lit, false, Math.min(1, s.light * 8) * seen);
    L.tick(dt * motion, lit, 0.6 * s.photons);
    // The front: leading the light in, gone once it has arrived.
    const going = seen > 0 && s.light > 0.002 && s.light < 0.995;
    this.front.visible = going;
    if (going) {
      L.at(lit, this.front.position);
      (this.front.material as THREE.SpriteMaterial).opacity = Math.min(1, s.light * 20) * Math.min(1, (1 - s.light) * 20);
    }
    this.paintExposure(s);
    // The x-ray material is already compiled for every twin: swapping to it costs nothing.
    const ghost = s.frames > 0.01;
    if (ghost !== this.wheelGhost) {
      this.wheelGhost = ghost;
      for (const w of this.wheel) w.mesh.material = ghost ? this.xrayMat : w.own;
    }
    m.sky.gain.value = s.frames > 0 ? 1.6 : 0;
    if (this.skyCam && s.frames > 0) {
      const wm = new THREE.Matrix4().multiplyMatrices(this.body.matrixWorld, this.skyCam.local);
      m.sky.vp.value.multiplyMatrices(this.skyCam.P, wm.invert());
    }

    this.placeTags(o.camera, o.w, o.h, o.showTags ? s.labels : [], o.avoid ?? null);
  }

  private paintExposure(s: OrbitState) {
    const e = this.exposure;
    if (!e || !this.exposureTex) return;
    const frames = Math.round(s.frames), read = Math.round(s.readout * 100) / 100;
    const d = this.drawn;
    if (d.kind !== s.field.kind || d.seed !== s.field.seed) {
      e.setScene(s.field.kind, s.field.seed);
      d.kind = s.field.kind; d.seed = s.field.seed; d.frames = -1;
    }
    if (d.frames === frames && d.readout === read) return;
    e.drawAt(frames, read);
    this.exposureTex.needsUpdate = true;
    d.frames = frames; d.readout = read;
  }

  private applyParts(camera: THREE.PerspectiveCamera, s: OrbitState) {
    const m = this.model!;
    // Section plane through the long axis, facing away from the camera, so
    // the near half is the half cut away; parked 12 m toward the camera when
    // nothing is cut, clear of everything, taken apart included.
    const axisO = this.body.localToWorld(new THREE.Vector3(0, 0, 0));
    const axisD = new THREE.Vector3(0, 1, 0).applyQuaternion(this.body.getWorldQuaternion(this.tmpQ));
    const n = new THREE.Vector3().subVectors(axisO, camera.position);
    n.addScaledVector(axisD, -n.dot(axisD));
    if (n.lengthSq() < 1e-12) n.set(0, 0, -1);
    n.normalize();
    const park = (1 - s.cut) * (1 - s.cut) * 12 * MODEL_SCALE;
    this.clip.setFromNormalAndCoplanarPoint(n, axisO.addScaledVector(n, -park));
    for (const mat of this.linings) (mat.userData.inner as THREE.Color).copy(mat.userData.innerBase).lerp(LINING_CUT, s.cut);

    // The scan front, down the long axis; parked above the aperture at 0.
    const y = SCAN_TOP + (SCAN_BOTTOM - SCAN_TOP) * s.xray;
    const q = this.body.getWorldQuaternion(new THREE.Quaternion());
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    const at = this.body.localToWorld(new THREE.Vector3(0, y, 0));
    this.scanSolid.setFromNormalAndCoplanarPoint(down, at);
    this.scanXray.setFromNormalAndCoplanarPoint(down.clone().negate(), at);
    const moving = s.xray > 0.001 && s.xray < 0.999;
    this.scanBand.value.set(down.x, down.y, down.z, moving ? this.scanSolid.constant : 1e6);
    this.xrayMat.uniforms.uOpacity.value = s.xray > 0.001 ? 0.9 : 0;

    const e = s.explode;
    for (const mesh of m.meshes) {
      const sub = subsystemOf(mesh) ?? '';
      const off = EXPLODE[sub];
      if (off && sub !== 'TEL.DeployableApertureCover') {
        const b = mesh.userData.basePosition as THREE.Vector3;
        mesh.position.set(b.x + off[0] * e, b.y + off[1] * e, b.z + off[2] * e);
      }
      // Shadow maps ignore the section plane; a cut shell must not shade the
      // interior it no longer covers.
      if ((mesh.material as THREE.Material).name !== 'Detector') mesh.castShadow = !(CUT.has(sub) && s.cut > 0.02);
    }
    for (const h of this.wfiHousing) h.visible = s.cut < 0.3;

    if (m.dac) {
      const st = num('DAC_H_STOWED') / num('DAC_H_DEPLOYED');
      m.dac.scale.y = st + (1 - st) * s.deploy.dac;
      const b = m.dac.userData.basePosition as THREE.Vector3 | undefined;
      const off = EXPLODE['TEL.DeployableApertureCover'];
      if (b) m.dac.position.set(b.x + off[0] * e, b.y + off[1] * e, b.z + off[2] * e);
    }
    for (const d of m.deployables) {
      const sub = subsystemOf(d.node);
      const which = sub === 'OSS.LowerInstrumentSunShade' ? s.deploy.liss
        : sub === 'COMMUNICATIONS' ? s.deploy.hga : s.deploy.sass;
      d.node.rotation[d.axis] = d.base + (1 - which) * d.stowed;
    }
  }

  /* --------------------------------------------------------------- labels -- */

  /** A point in the model's frame, in the globe's. */
  toWorld(p: THREE.Vector3, out = new THREE.Vector3()) {
    return this.body.localToWorld(out.copy(p));
  }

  /**
   * Names on the model: a small point where it is, a hairline out to the
   * text. Each name tries the side of its point with room, then the other
   * side, then above and below, and takes the first slot that is on screen,
   * clear of `avoid` and clear of every name already placed. A name with no
   * clear slot is not drawn. The story fades them with `alpha`.
   */
  private placeTags(camera: THREE.PerspectiveCamera, w: number, h: number, labels: OrbitLabel[],
    avoid: { x0: number; y0: number; x1: number; y1: number }[] | null) {
    const M = 10, GAP = 34, th = 18, PX = 8, PY = 5;
    type Box = { x: number; y: number; w: number; h: number };
    const placed: Box[] = [];
    const seen = new Set<string>();
    const clash = (b: Box) =>
      b.x < M || b.y < M || b.x + b.w > w - M || b.y + b.h > h - M ||
      placed.some((q) => b.x < q.x + q.w + PX && b.x + b.w + PX > q.x && b.y < q.y + q.h + PY && b.y + b.h + PY > q.y) ||
      !!avoid?.some((a) => b.x < a.x1 && b.x + b.w > a.x0 && b.y < a.y1 && b.y + b.h > a.y0);
    const rows = labels.map((t) => {
      const p = this.toWorld(t.at, this.tmp).project(camera);
      return { t, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, ok: p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05 };
    }).sort((a, b) => Number(!!b.t.strong) - Number(!!a.t.strong) || a.y - b.y);
    const hide = (tag: Tag) => {
      tag.el.style.display = tag.dot.style.display = tag.line.style.display = 'none';
      tag.on = false;
    };
    for (const r of rows) {
      const a = r.t.alpha ?? 1;
      const dot: Box = { x: r.x - 3, y: r.y - 3, w: 6, h: 6 };
      if (!r.ok || a < 0.02 || r.x < 4 || r.x > w - 4 || avoid?.some((q) => dot.x < q.x1 && dot.x + 6 > q.x0 && dot.y < q.y1 && dot.y + 6 > q.y0)) continue;
      const tag = this.tag(r.t.id);
      if (tag.text.textContent !== r.t.text) tag.text.textContent = r.t.text;
      tag.el.classList.toggle('strong', !!r.t.strong);
      // Measured while shown: a hidden name has no width.
      if (!tag.on) { tag.el.style.display = ''; tag.el.style.opacity = '0'; }
      const tw = tag.el.offsetWidth || 120;
      const rightFirst = r.x < w * 0.62;
      const sides: ['right' | 'left' | 'above' | 'below', number, number][] = [
        ['right', r.x + GAP, r.y - GAP], ['left', r.x - GAP - tw, r.y - GAP],
        ['above', r.x - tw / 2, r.y - GAP - th], ['below', r.x - tw / 2, r.y + GAP],
        ['right', r.x + GAP, r.y + GAP / 2], ['left', r.x - GAP - tw, r.y + GAP / 2],
      ];
      if (!rightFirst) [sides[0], sides[1]] = [sides[1], sides[0]];
      let slot: { side: string; box: Box } | null = null;
      for (const [side, x, y] of sides) {
        const box = { x, y, w: tw, h: th };
        if (!clash(box)) { slot = { side, box }; break; }
      }
      if (!slot) { if (tag.on) hide(tag); else tag.el.style.display = 'none'; continue; }
      const { side, box: { x, y } } = slot;
      placed.push(slot.box);
      tag.el.style.translate = `${x}px ${y}px`;
      tag.el.style.opacity = String(a);
      tag.dot.style.translate = `${r.x - 2.5}px ${r.y - 2.5}px`;
      tag.dot.style.opacity = String(a);
      const lx = side === 'right' ? x - 4 : side === 'left' ? x + tw + 4 : Math.max(x, Math.min(x + tw, r.x));
      const ly = side === 'above' ? y + th + 2 : side === 'below' ? y - 2 : y + th / 2;
      tag.line.setAttribute('x1', String(r.x)); tag.line.setAttribute('y1', String(r.y));
      tag.line.setAttribute('x2', String(lx)); tag.line.setAttribute('y2', String(ly));
      tag.line.style.opacity = String(a * 0.6);
      if (!tag.on) { tag.dot.style.display = ''; tag.line.style.display = ''; tag.on = true; }
      seen.add(r.t.id);
    }
    for (const [id, tag] of this.tags) if (!seen.has(id) && tag.on) hide(tag);
  }

  private tag(id: string): Tag {
    let t = this.tags.get(id);
    if (t) return t;
    const el = document.createElement('div');
    el.className = 'roman-tag';
    const text = document.createElement('span');
    el.append(text);
    const dot = document.createElement('span');
    dot.className = 'roman-tag-dot';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', 'rgba(242,241,236,0.9)');
    line.setAttribute('stroke-width', '1');
    for (const e of [el, dot]) e.style.display = 'none';
    line.style.display = 'none';
    this.svg.append(line);
    this.tagHost.append(el, dot);
    t = { el, text, dot, line, on: false };
    this.tags.set(id, t);
    return t;
  }

  dispose() {
    this.light?.dispose();
    this.sunlight.dispose();
    this.downlink?.dispose();
    this.exposureTex?.dispose();
    this.tagHost.remove();
  }
}
