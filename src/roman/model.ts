/**
 * Loading and indexing the Roman model for the explorer.
 *
 * The .glb comes out of scripts/roman (npm run roman:glb). Every mesh carries
 * `userData.subsystem` and `userData.part` extras; the parts that fold for
 * launch carry `deploy_axis` and `stowed_deg`, with their origin already on
 * the hinge. glTF is Y-up, so the observatory's long axis is +Y here, from the
 * launch adapter at y = 0 to the aperture cover's rim at y ≈ 12.70, and the
 * sun side (Blender −Y) is +Z.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { foilNormalMap } from '../scene/spacecraft-render';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/roman.glb`;
export const LENGTH = 12.7;

export interface Deployable {
  node: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  /** Radians, from the deployed pose as built. */
  stowed: number;
  base: number;
}

export interface RomanModel {
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  bySubsystem: Map<string, THREE.Mesh[]>;
  byPart: Map<string, THREE.Mesh>;
  deployables: Deployable[];
  /** Parent pivot of the aperture cover; its origin is the cover's base. */
  dac: THREE.Object3D | null;
  detectors: THREE.Mesh[];
  /** Uniforms shared by every detector's sky projection. */
  sky: { map: { value: THREE.Texture | null }; vp: { value: THREE.Matrix4 }; gain: { value: number } };
}

export const subsystemOf = (o: THREE.Object3D | null): string | null => {
  for (let n = o; n; n = n.parent) if (typeof n.userData?.subsystem === 'string') return n.userData.subsystem;
  return null;
};
export const partOf = (o: THREE.Object3D | null): string | null => {
  for (let n = o; n; n = n.parent) if (typeof n.userData?.part === 'string') return n.userData.part;
  return null;
};

/* ------------------------------------------------------------ materials -- */

/**
 * The .glb carries flat PBR colours only — every texture in the Blender pass is
 * procedural, and glTF drops procedural textures — so each material is
 * re-authored here by name. Standard, not Physical: the anisotropic and
 * clearcoat variants compile to far heavier shaders that ANGLE-on-Metal builds
 * slowly and phones pay for every frame.
 */
/**
 * Near-black cells with rounded corners on a red-orange substrate, as NASA's
 * integration photos show the Solar Array Sun Shield — the grid of orange
 * lines is what makes it read as Roman's array rather than anyone's.
 */
function solarCells(): THREE.Texture {
  // 3,902 cells over six panels is ~650 each: 16 x 12 cells, repeated 2 x 2.
  const S = 512, cols = 16, rows = 12, gap = 3;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b3461f';
  g.fillRect(0, 0, S, S);
  const cw = (S - gap) / cols, ch = (S - gap) / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 11 + ((x * 7 + y * 5) % 4);
      g.fillStyle = `rgb(${v},${v + 3},${v + 16})`;
      g.beginPath();
      g.roundRect(gap + x * cw, gap + y * ch, cw - gap, ch - gap, 3);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

/**
 * Blankets that are one colour outside and another inside: the barrel is
 * silver-grey MLI over a matte black interior, the visor silver over glossy
 * black. A face is "inside" when its normal points at the part's own axis,
 * judged in the part's local space so it still holds in the exploded view.
 */
function twoSided(m: THREE.MeshStandardMaterial, inner: number, innerRough: number, innerMetal: number) {
  const col = new THREE.Color(inner);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uInner = { value: col };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vInner;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInner = dot(objectNormal.xz, transformed.xz) < 0.0 ? 1.0 : 0.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInner;\nvarying float vInner;')
      .replace('#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (vInner > 0.5) {
          diffuseColor.rgb = uInner;
          metalnessFactor = ${innerMetal.toFixed(3)};
          roughnessFactor = ${innerRough.toFixed(3)};
        }`);
  };
  m.customProgramCacheKey = () => `roman-two-sided-${inner}-${innerRough}`;
  return m;
}

/**
 * Shader patches by material name. Material.clone() does not carry
 * onBeforeCompile across, and every mesh gets its own clone, so patches are
 * re-applied to each clone from here.
 */
const PATCHES = new Map<string, (m: THREE.MeshStandardMaterial) => void>();

function author(src: THREE.Material, foil: THREE.Texture, sky: RomanModel['sky']): THREE.Material {
  const name = src.name;
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ name, ...o });
  const crinkle = (k: number) => ({ normalMap: foil, normalScale: new THREE.Vector2(k, k) });
  switch (name) {
    // Silver-grey, low-sheen crinkled MLI: the barrel, bus and instruments.
    // Roman's flight blankets are silver, not the gold of the Blender source:
    // nasa.gov/wp-content/uploads/2025/02/dac-group-photo.jpg (barrel, visor),
    // nasa.gov/missions/roman-space-telescope/nasa-installs-key-sunblock-shield-on-roman-space-telescope/
    // (bus, lower sun shade). Recorded in roman_dims.py CORRECTIONS.
    case 'MLI_Silver':
    case 'MLI_Gold':
      return std({ color: 0xc9cbce, metalness: 0.85, roughness: 0.4, ...crinkle(0.32) });
    case 'MLI_Barrel':
      PATCHES.set(name, (m) => twoSided(m, 0x060607, 0.92, 0));
      return std({ color: 0xb7b9bc, metalness: 0.8, roughness: 0.42, ...crinkle(0.3) });
    case 'Visor':
      PATCHES.set(name, (m) => twoSided(m, 0x040405, 0.18, 0.1));
      return std({ color: 0xc2c4c7, metalness: 0.75, roughness: 0.38, ...crinkle(0.22) });
    case 'HGA_Carbon':
      return std({ color: 0x2b2d31, metalness: 0.2, roughness: 0.62 });
    case 'Filter':
      return std({ color: 0x33445a, metalness: 0.4, roughness: 0.06, envMapIntensity: 1.6 });
    case 'Mirror':
      return std({ color: 0xf3f1ea, metalness: 1, roughness: 0.035 });
    case 'SolarArray':
      return std({ map: solarCells(), metalness: 0.35, roughness: 0.3 });
    case 'Baffle_Black':
      return std({ color: 0x050506, metalness: 0, roughness: 0.95 });
    case 'Composite':
      return std({ color: 0x24272c, metalness: 0.15, roughness: 0.58 });
    case 'Structure_White':
      return std({ color: 0xb9bbbe, metalness: 0, roughness: 0.55 });
    case 'Radiator':
      return std({ color: 0xc8cacd, metalness: 0.1, roughness: 0.3 });
    case 'ULE_Glass':
      return std({ color: 0xb9c0c5, metalness: 0.05, roughness: 0.32 });
    case 'Detector': {
      const m = std({ color: 0x1b1330, metalness: 0.5, roughness: 0.24, emissive: 0xffffff, emissiveIntensity: 1 });
      // Paint the sky onto the chips as the focal-plane shot's camera saw it,
      // so the footprint drawn over the star field and the physical detectors
      // are the same pixels as the view pulls back.
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uSky = sky.map;
        sh.uniforms.uSkyVP = sky.vp;
        sh.uniforms.uSkyGain = sky.gain;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uSkyVP;\nvarying vec4 vSkyClip;\nvarying float vSkyTop;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvSkyClip = uSkyVP * modelMatrix * vec4(transformed, 1.0);\nvSkyTop = objectNormal.y > 0.5 ? 1.0 : 0.0;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uSky;\nuniform float uSkyGain;\nvarying vec4 vSkyClip;\nvarying float vSkyTop;')
          .replace('#include <emissivemap_fragment>',
            'vec2 skyUv = vSkyClip.xy / vSkyClip.w * 0.5 + 0.5;\n' +
            '// Only the light-sensitive top face carries the image; the sides stay dark.\n' +
            'totalEmissiveRadiance = uSkyGain > 0.0 ? texture2D(uSky, skyUv).rgb * uSkyGain * vSkyTop : vec3(0.0);');
      };
      m.customProgramCacheKey = () => 'roman-detector-sky';
      return m;
    }
    default:
      return src;
  }
}

/* --------------------------------------------------------------- loading -- */

let cached: Promise<RomanModel> | null = null;

export function loadRomanModel(): Promise<RomanModel> {
  cached ??= Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
  ]).then(([{ GLTFLoader }, { DRACOLoader }]) => {
    // Draco quantises inside the codec and decodes back to each part's own
    // coordinates, so hinge pivots and the local-space shaders stay exact —
    // unlike meshopt quantisation, which rewrites node transforms.
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    draco.setDecoderConfig({ type: 'wasm' });
    return new GLTFLoader().setDRACOLoader(draco).loadAsync(MODEL_URL);
  }).then(index);
  cached.catch(() => { cached = null; });
  return cached;
}

function index(gltf: GLTF): RomanModel {
  const root = gltf.scene;
  const foil = foilNormalMap().clone();
  foil.repeat.set(6, 6);
  foil.needsUpdate = true;

  const sky: RomanModel['sky'] = {
    map: { value: null }, vp: { value: new THREE.Matrix4() }, gain: { value: 0 },
  };
  const shared = new Map<string, THREE.Material>();
  const meshes: THREE.Mesh[] = [];
  const bySubsystem = new Map<string, THREE.Mesh[]>();
  const byPart = new Map<string, THREE.Mesh>();
  const deployables: Deployable[] = [];
  const detectors: THREE.Mesh[] = [];
  let dac: THREE.Object3D | null = null;

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.Material;
    if (!shared.has(src.name)) shared.set(src.name, author(src, foil, sky));
    const base = shared.get(src.name)!;
    // Detectors share one program and one set of uniforms; everything else
    // gets its own copy so selection can dim and cut parts independently.
    if (src.name === 'Detector') mesh.material = base;
    else {
      const m = base.clone() as THREE.MeshStandardMaterial;
      PATCHES.get(src.name)?.(m);
      // The element wheel is a lightweight metal disc, not painted structure.
      if (mesh.userData.part === 'WFI.ElementWheel') { m.color.set(0x5b5e63); m.metalness = 0.8; m.roughness = 0.34; }
      mesh.material = m;
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.basePosition = mesh.position.clone();
    meshes.push(mesh);

    const sub = subsystemOf(mesh) ?? 'unknown';
    if (!bySubsystem.has(sub)) bySubsystem.set(sub, []);
    bySubsystem.get(sub)!.push(mesh);
    const part = partOf(mesh);
    if (part) byPart.set(part, mesh);
    if (part?.startsWith('WFI.H4RG')) detectors.push(mesh);
    if (sub === 'TEL.DeployableApertureCover' && !dac && mesh.parent) dac = mesh.parent;

    const ax = mesh.userData.deploy_axis as string | undefined;
    if (ax) {
      // Blender Z-up to glTF Y-up is a proper rotation: Z becomes Y, X stays.
      const axis = ax === 'Z' ? 'y' : ax === 'X' ? 'x' : 'z';
      deployables.push({
        node: mesh, axis, base: mesh.rotation[axis],
        stowed: THREE.MathUtils.degToRad(Number(mesh.userData.stowed_deg) || 0),
      });
    }
  });
  if (dac) (dac as THREE.Object3D).userData.basePosition = (dac as THREE.Object3D).position.clone();
  return { root, meshes, bySubsystem, byPart, deployables, dac, detectors, sky };
}

/** Exact world-space bounds of a set of meshes. */
export function boundsOf(meshes: THREE.Object3D[], out = new THREE.Box3()): THREE.Box3 {
  out.makeEmpty();
  const b = new THREE.Box3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    out.union(b.setFromObject(m, true));
  }
  return out;
}
