/**
 * Realistic rendering for the spacecraft viewports.
 *
 * The parts viewers looked like flat plastic toys for a specific, fixable
 * reason: the materials declare high metalness, but the scenes had no
 * environment. A metal in a physically-based renderer takes nearly all of its
 * colour from what it reflects, so a metal with nothing to reflect resolves to
 * dead grey no matter what base colour you give it. Gold foil in particular
 * simply cannot look like gold without an environment.
 *
 * So this module supplies the three things that were missing — an environment
 * to reflect, filmic tone mapping, and shadows — plus the procedural maps that
 * turn flat rectangles into solar arrays and crinkled thermal blanket.
 *
 * Everything is generated at runtime. No new texture downloads: the first-paint
 * budget is already the app's weak point, and a 2 kB canvas beats a 2 MB PNG.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * The light a spacecraft in low Earth orbit actually sits in: one brutally
 * bright sun, a large soft blue bounce off the Earth below, and black
 * everywhere else. That contrast is what reads as "space" rather than "studio".
 */
export function makeSpaceEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const env = new THREE.Scene();

  // Deep space. Not pure black — a faint cool ambient keeps shadowed faces from
  // going to absolute zero, which reads as a rendering error rather than as dark.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide }),
  );
  env.add(sky);

  // Earth below: a big dim blue emitter. This is the fill light that gives the
  // undersides of panels their colour, and it is why orbital photography looks
  // blue-shaded rather than neutral grey.
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(38, 32, 16, 0, Math.PI * 2, Math.PI * 0.52, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x2a5f96, side: THREE.BackSide }),
  );
  env.add(earth);

  // The sun. Small, and far brighter than everything else — the specular
  // highlight this produces on metal is most of what sells the material.
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  sun.position.set(22, 26, 16);
  sun.scale.setScalar(1);
  (sun.material as THREE.MeshBasicMaterial).color.setScalar(14);
  env.add(sun);

  // A weaker opposing source so the shadow side keeps some shape.
  const bounce = new THREE.Mesh(
    new THREE.SphereGeometry(9, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0x2b3d55 }),
  );
  bounce.position.set(-26, -6, -20);
  env.add(bounce);

  const texture = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  sky.geometry.dispose();
  earth.geometry.dispose();
  sun.geometry.dispose();
  bounce.geometry.dispose();
  return texture;
}

/** Filmic tone mapping and soft shadows — the difference between a render and a screenshot. */
export function configureRenderer(renderer: THREE.WebGLRenderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/**
 * Key, fill and rim. The key casts; the others only shape. One shadow-casting
 * light is enough here and costs a single depth pass — a satellite is a small
 * object and multiple shadow maps would buy nothing visible.
 */
export function addSpacecraftLighting(scene: THREE.Scene) {
  // Kept low: with an environment present, most ambient fill now comes from the
  // Earth bounce. Leaving the old flat ambient in would wash that out.
  scene.add(new THREE.AmbientLight(0x2c3e50, 0.25));

  const key = new THREE.DirectionalLight(0xfff4e2, 3.1);
  key.position.set(6, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  const extent = 9;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  // Solar arrays are thin planes; without a bias they self-shadow into stripes.
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x4e9fc0, 0.55);
  fill.position.set(-7, -3, -6);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xbcd8ff, 0.7);
  rim.position.set(-4, 5, -8);
  scene.add(rim);

  return key;
}

/* ------------------------------------------------------------------ maps -- */

let _solarMap: THREE.Texture | null = null;
let _hullNormal: THREE.Texture | null = null;
let _hullRough: THREE.Texture | null = null;
let _foilNormal: THREE.Texture | null = null;

/**
 * Solar array cells. A photovoltaic panel is not a blue rectangle — it is a
 * grid of dark cells separated by bright gaps, with silver busbars running
 * across them. At any distance that pattern is the single strongest cue that
 * you are looking at a solar array.
 */
export function solarCellMap(): THREE.Texture {
  if (_solarMap) return _solarMap;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;

  g.fillStyle = '#1d2f52';
  g.fillRect(0, 0, S, S);

  const cells = 8;
  const cell = S / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // Slight per-cell variation so the array doesn't read as a printed decal.
      const v = 0.86 + ((x * 7 + y * 13) % 5) * 0.03;
      g.fillStyle = `rgb(${Math.round(38 * v)}, ${Math.round(66 * v)}, ${Math.round(140 * v)})`;
      g.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3);

      // Busbars: two fine silver lines per cell.
      g.strokeStyle = 'rgba(205, 222, 245, 0.5)';
      g.lineWidth = 1;
      for (const f of [0.34, 0.66]) {
        g.beginPath();
        g.moveTo(x * cell + 2, y * cell + cell * f);
        g.lineTo(x * cell + cell - 2, y * cell + cell * f);
        g.stroke();
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _solarMap = tex;
  return tex;
}

/**
 * Multi-layer insulation is wrinkled foil, and the wrinkles are the whole look:
 * they break the reflection into a hundred moving highlights. Flat gold reads
 * as painted plastic, and no amount of colour tuning fixes that — it needs
 * surface normals.
 */
export function foilNormalMap(): THREE.Texture {
  if (_foilNormal) return _foilNormal;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);

  // Value noise, then a Sobel gradient of it, encoded as a tangent-space normal.
  const h = new Float32Array(S * S);
  const rnd = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0, amp = 1, f = 0.055;
      for (let o = 0; o < 4; o++) {
        const xi = Math.floor(x * f), yi = Math.floor(y * f);
        const xf = x * f - xi, yf = y * f - yi;
        const s = (a: number) => a * a * (3 - 2 * a);
        const a = rnd(xi, yi), b = rnd(xi + 1, yi), cc = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
        v += amp * (a + (b - a) * s(xf) + (cc - a) * s(yf) + (a - b - cc + d) * s(xf) * s(yf));
        amp *= 0.5; f *= 2.1;
      }
      h[y * S + x] = v;
    }
  }
  const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _foilNormal = tex;
  return tex;
}

/**
 * Hull detail: panel seams and a little surface variation.
 *
 * A spacecraft body is not one milled face — it is bolted panels with seams
 * between them, and the seams are what tell your eye the object is built rather
 * than modelled. Without them a bus reads as an untextured box no matter how
 * good the lighting is. Returned as a normal map (the seams) plus a roughness
 * map (uneven wear), because varying roughness across a surface is most of what
 * separates a real metal from a CG one.
 */
export function hullDetailMaps(): { normal: THREE.Texture; roughness: THREE.Texture } {
  if (_hullNormal && _hullRough) return { normal: _hullNormal, roughness: _hullRough };
  const S = 512;

  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  const ng = nc.getContext('2d')!;
  // Flat tangent-space normal is (0.5, 0.5, 1.0).
  ng.fillStyle = 'rgb(128,128,255)';
  ng.fillRect(0, 0, S, S);

  // Seams, drawn as paired light/dark lines so they read as a groove rather
  // than a painted stripe.
  const seam = (x0: number, y0: number, x1: number, y1: number) => {
    const vertical = Math.abs(x1 - x0) < Math.abs(y1 - y0);
    ng.lineWidth = 2;
    ng.strokeStyle = vertical ? 'rgb(96,128,255)' : 'rgb(128,96,255)';
    ng.beginPath(); ng.moveTo(x0, y0); ng.lineTo(x1, y1); ng.stroke();
    ng.strokeStyle = vertical ? 'rgb(160,128,255)' : 'rgb(128,160,255)';
    ng.beginPath();
    ng.moveTo(x0 + (vertical ? 2 : 0), y0 + (vertical ? 0 : 2));
    ng.lineTo(x1 + (vertical ? 2 : 0), y1 + (vertical ? 0 : 2));
    ng.stroke();
  };
  for (const f of [0.25, 0.5, 0.75]) { seam(f * S, 0, f * S, S); seam(0, f * S, S, f * S); }
  // A few shorter seams so the grid does not look perfectly regular.
  seam(0.125 * S, 0, 0.125 * S, 0.5 * S);
  seam(0.625 * S, 0.5 * S, 0.625 * S, S);
  seam(0.5 * S, 0.375 * S, S, 0.375 * S);

  const rc = document.createElement('canvas'); rc.width = rc.height = S;
  const rg = rc.getContext('2d')!;
  rg.fillStyle = '#9a9a9a';
  rg.fillRect(0, 0, S, S);
  // Blotches of differing roughness — scuffs, handling marks, coating variation.
  for (let i = 0; i < 120; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 12345.6789) % 1;
    const r = 12 + (Math.abs(Math.sin(i * 3.7)) * 46);
    const shade = 128 + Math.round(Math.sin(i * 5.1) * 44);
    rg.fillStyle = `rgba(${shade},${shade},${shade},0.20)`;
    rg.beginPath();
    rg.arc(Math.abs(x) * S, Math.abs(y) * S, r, 0, Math.PI * 2);
    rg.fill();
  }
  // Seams are slightly rougher than the panels they separate.
  rg.strokeStyle = 'rgba(190,190,190,0.55)';
  rg.lineWidth = 3;
  for (const f of [0.25, 0.5, 0.75]) {
    rg.beginPath(); rg.moveTo(f * S, 0); rg.lineTo(f * S, S); rg.stroke();
    rg.beginPath(); rg.moveTo(0, f * S); rg.lineTo(S, f * S); rg.stroke();
  }

  _hullNormal = new THREE.CanvasTexture(nc);
  _hullNormal.wrapS = _hullNormal.wrapT = THREE.RepeatWrapping;
  _hullRough = new THREE.CanvasTexture(rc);
  _hullRough.wrapS = _hullRough.wrapT = THREE.RepeatWrapping;
  return { normal: _hullNormal, roughness: _hullRough };
}

/**
 * Sun glint.
 *
 * Photographs of hardware in orbit bloom hard off metal, because the sun is
 * unfiltered and the dynamic range is enormous. Rendering specular highlights
 * that stop politely at white is a large part of why CG spacecraft look like
 * CG. A tight bloom with a high threshold only touches the few pixels that are
 * genuinely blown out — foil creases, panel edges, the feed horn — and leaves
 * the body of the object alone.
 *
 * Returns a composer to render with instead of the raw renderer, plus a resize
 * hook. Null if the browser cannot support it, in which case the caller falls
 * back to rendering directly and simply loses the glint.
 */
export function makeGlintComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): { composer: EffectComposer; setSize: (w: number, h: number) => void } | null {
  try {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.78);
    composer.addPass(bloom);
    // Tone mapping and colour conversion move to the end of the chain once a
    // composer is in play; without this the image comes out washed out.
    composer.addPass(new OutputPass());
    return {
      composer,
      setSize: (w, h) => {
        composer.setSize(w, h);
        bloom.setSize(w, h);
      },
    };
  } catch {
    return null;
  }
}
