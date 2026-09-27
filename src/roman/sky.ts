/**
 * A synthetic star field in the direction of the Galactic bulge — the field
 * Roman's Galactic Bulge Time Domain Survey stares at — for the explorer's
 * opening chapter.
 *
 * It is generated, not observed, and the UI says so. What it is for is scale:
 * the Wide Field Instrument's eighteen detectors and Hubble's infrared camera
 * are drawn over it at their real angular sizes.
 */

/** One H4RG-10: 4096 px at 0.11″/px. */
export const DETECTOR_ARCMIN = (4096 * 0.11) / 60;
/** Hubble WFC3/IR field: 136″ × 123″. */
export const HUBBLE_IR_ARCMIN: [number, number] = [136 / 60, 123 / 60];

function hash(x: number, y: number, s: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, s: number, oct = 5) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) {
    v += amp * valueNoise(x * f, y * f, s + o * 13);
    amp *= 0.5; f *= 2.03;
  }
  return v;
}

/** Deterministic PRNG so the field is the same on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint the field into a canvas of the given pixel size.
 * `arcminPerPx` sets the star density to something plausible for the scale.
 */
export function paintBulgeField(w: number, h: number, arcminPerPx: number, seed = 7): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#020203';
  g.fillRect(0, 0, w, h);

  // Diffuse light of unresolved stars, cut by dust lanes. Low resolution and
  // smoothed up: it is a glow, and a per-pixel pass at 4K would cost seconds.
  const GW = 360, GH = Math.max(2, Math.round((360 * h) / w));
  const glow = document.createElement('canvas');
  glow.width = GW; glow.height = GH;
  const gg = glow.getContext('2d')!;
  const img = gg.createImageData(GW, GH);
  const density = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const nx = x / GW * 3.2, ny = y / GH * 3.2 * (GH / GW) * 1.8;
      // A band running corner to corner, brightest along its spine.
      const band = Math.exp(-(((y / GH - 0.5) - (x / GW - 0.5) * 0.35) ** 2) / 0.09);
      const lanes = Math.max(0, fbm(nx * 1.7 + 4, ny * 2.3, seed + 3) - 0.47) * 3.4;
      const clump = fbm(nx, ny, seed);
      const v = Math.max(0, band * (0.35 + clump * 0.9) - lanes * 0.85);
      density[y * GW + x] = v;
      const i = (y * GW + x) * 4;
      img.data[i] = Math.min(255, 150 * v + 6);
      img.data[i + 1] = Math.min(255, 104 * v + 5);
      img.data[i + 2] = Math.min(255, 70 * v + 7);
      img.data[i + 3] = 255;
    }
  }
  gg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.globalAlpha = 0.42;
  g.drawImage(glow, 0, 0, w, h);
  g.globalAlpha = 1;

  // Stars. Bulge fields are old populations: mostly yellow-orange giants and
  // dwarfs, a few blue foreground stars. Counts scale with sky area.
  const rand = mulberry32(seed * 9973);
  const areaArcmin = w * h * arcminPerPx * arcminPerPx;
  const count = Math.min(70_000, Math.round(areaArcmin * 14));
  const palette = ['255,214,170', '255,228,196', '255,196,140', '255,240,222', '214,226,255', '255,176,120'];
  for (let k = 0; k < count; k++) {
    const x = rand() * w, y = rand() * h;
    const d = density[Math.min(GH - 1, (y / h * GH) | 0) * GW + Math.min(GW - 1, (x / w * GW) | 0)];
    if (rand() > 0.12 + d * 1.1) continue;         // dust hides stars too
    const b = Math.pow(rand(), 11);                  // most stars are faint
    const col = palette[(rand() * (rand() < 0.08 ? palette.length : 4)) | 0];
    if (b < 0.06) {
      const a = 0.18 + b * 9;
      g.fillStyle = `rgba(${col},${a})`;
      g.fillRect(x, y, 1, 1);
      if (a > 0.5) g.fillRect(x - 0.5, y - 0.5, 2, 2);
    } else {
      const r = 0.55 + b * 2.4;
      const grad = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
      grad.addColorStop(0, `rgba(${col},1)`);
      grad.addColorStop(0.3, `rgba(${col},${0.3 + b * 0.5})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}
