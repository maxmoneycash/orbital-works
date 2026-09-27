/**
 * How an exposure becomes an image, simulated the way a detector does it:
 * every pixel collects photons at a rate set by the scene, with shot noise
 * (Poisson, √N) and read noise, frame after frame, so the picture climbs out
 * of the noise as √t. Then each detector is read out, row by row.
 *
 * The scenes are synthetic fields, not Roman data, and the UI says so; what
 * is real is the arithmetic of an exposure and the mosaic's own layout, taken
 * from the model's eighteen detectors.
 */
import { paintBulgeField } from './sky';

export type FieldKind = 'bulge' | 'deep';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deep extragalactic field, the kind Roman's high-latitude surveys map for
 * weak lensing and supernovae: a few foreground stars and many galaxies,
 * small, faint and randomly oriented, redder the fainter they are.
 */
export function paintDeepField(w: number, h: number, seed = 11): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#010102';
  g.fillRect(0, 0, w, h);
  const rand = mulberry32(seed * 7919);
  const n = Math.round((w * h) / 90);
  for (let k = 0; k < n; k++) {
    const x = rand() * w, y = rand() * h;
    const b = Math.pow(rand(), 3.2);                 // most galaxies are faint
    const size = 0.8 + b * 7 + (rand() < 0.02 ? 9 : 0);
    const ell = 0.25 + rand() * 0.75, rot = rand() * Math.PI;
    // Bright, near galaxies read bluer-white; faint, distant ones redder.
    const red = 1 - b;
    const col = `${Math.round(210 + 45 * red)},${Math.round(200 + 20 * b)},${Math.round(170 + 85 * b)}`;
    g.save();
    g.translate(x, y); g.rotate(rot); g.scale(1, ell);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, size);
    grad.addColorStop(0, `rgba(${col},${0.35 + b * 0.65})`);
    grad.addColorStop(0.25, `rgba(${col},${0.12 + b * 0.3})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, size, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  for (let k = 0; k < n / 40; k++) {
    const x = rand() * w, y = rand() * h, b = Math.pow(rand(), 6);
    const r = 0.6 + b * 2.2;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 2.5);
    grad.addColorStop(0, 'rgba(255,248,236,1)');
    grad.addColorStop(1, 'rgba(255,248,236,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r * 2.5, 0, Math.PI * 2); g.fill();
  }
  return c;
}

export interface Point { x: number; y: number }

/** A precomputed table of standard normals; offsets into it are cheap noise. */
const NORMALS = (() => {
  const t = new Float32Array(1 << 16);
  const rand = mulberry32(4242);
  for (let i = 0; i < t.length; i += 2) {
    const u = Math.max(1e-9, rand()), v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    t[i] = r * Math.cos(2 * Math.PI * v);
    t[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return t;
})();

/**
 * One exposure on the mosaic. `integrate` adds frames of photons; `draw`
 * shows the running mean, stretched like an astronomer's display; `readout`
 * sweeps each detector's read line across it.
 */
export class Exposure {
  readonly canvas: HTMLCanvasElement;
  /** Frames integrated so far. */
  frames = 0;
  private readonly W: number;
  private readonly H: number;
  private rate: Float32Array;
  private acc: Float32Array;
  private mask: Uint8Array;
  private tileOf: Int8Array;
  private tiles: { minY: number; maxY: number }[];
  private img: ImageData;
  private g: CanvasRenderingContext2D;
  private cursor = 0;
  /** 0 before readout, 1 when every row of every detector has been read. */
  read = 0;
  /** The mosaic's box within the canvas, for cropping it into a display. */
  readonly bounds: { x: number; y: number; w: number; h: number };

  /**
   * `outlines`: the detectors' corner points. By default they are fitted into
   * the W × H canvas; with `scale` they are taken as screen pixels of a
   * projection pose and scaled, so the canvas can be projected back onto the
   * 3D detectors from that pose.
   */
  constructor(outlines: Point[][], W = 360, H = 180, opts: { scale?: number } = {}, readonly photons = 5, readonly readNoise = 1.6) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.img = this.g.createImageData(W, H);
    this.rate = new Float32Array(W * H * 3);
    this.acc = new Float32Array(W * H * 3);

    // Fit the mosaic into the canvas, keeping its shape.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of outlines) for (const p of q) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 6;
    const k = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
    const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
    const sc = opts.scale;
    const fit = (p: Point) => (sc ? { x: p.x * sc, y: p.y * sc } : { x: ox + (p.x - minX) * k, y: oy + (p.y - minY) * k });
    const polys = outlines.map((q) => q.map(fit));
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const q of polys) for (const p of q) {
      bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y);
    }
    this.bounds = { x: Math.max(0, bx0 - 3), y: Math.max(0, by0 - 3), w: Math.min(W, bx1 + 3) - Math.max(0, bx0 - 3), h: Math.min(H, by1 + 3) - Math.max(0, by0 - 3) };

    // Rasterise which detector each pixel belongs to; the gaps collect nothing.
    const m = document.createElement('canvas');
    m.width = W; m.height = H;
    const mg = m.getContext('2d', { willReadFrequently: true })!;
    this.mask = new Uint8Array(W * H);
    this.tileOf = new Int8Array(W * H).fill(-1);
    this.tiles = polys.map((poly, i) => {
      mg.clearRect(0, 0, W, H);
      mg.fillStyle = '#fff';
      mg.beginPath();
      poly.forEach((p, j) => (j ? mg.lineTo(p.x, p.y) : mg.moveTo(p.x, p.y)));
      mg.closePath(); mg.fill();
      // Only scan the chip's own box.
      const x0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.x)))), x1 = Math.min(W - 1, Math.ceil(Math.max(...poly.map((p) => p.x))));
      const y0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.y)))), y1 = Math.min(H - 1, Math.ceil(Math.max(...poly.map((p) => p.y))));
      if (x1 < x0 || y1 < y0) return { minY: 0, maxY: 0 };
      const bw = x1 - x0 + 1;
      const d = mg.getImageData(x0, y0, bw, y1 - y0 + 1).data;
      let lo = H, hi = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (d[((y - y0) * bw + (x - x0)) * 4 + 3] > 127) {
          this.mask[y * W + x] = 1; this.tileOf[y * W + x] = i;
          lo = Math.min(lo, y); hi = Math.max(hi, y);
        }
      }
      return { minY: lo, maxY: hi };
    });
  }

  /** Point the mosaic at a new scene and start from zero photons. */
  setScene(kind: FieldKind, seed = 7) {
    const W = this.W, H = this.H;
    const src = kind === 'bulge' ? paintBulgeField(W * 2, H * 2, 0.9, seed) : paintDeepField(W * 2, H * 2, seed);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) {
      for (let ch = 0; ch < 3; ch++) this.rate[i * 3 + ch] = (d[i * 4 + ch] / 255) ** 1.6;
    }
    this.reset();
  }

  reset() {
    this.acc.fill(0);
    this.frames = 0;
    this.read = 0;
  }

  /** Add `n` frames: expected counts λ = rate·photons, drawn as λ + √λ·N + read noise. */
  integrate(n = 1) {
    const { acc, rate, mask, photons, readNoise } = this;
    const N = NORMALS, M = N.length - 1;
    for (let f = 0; f < n; f++) {
      let j = (this.cursor = (this.cursor + 7919 * (f + 1)) & M);
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        for (let ch = 0; ch < 3; ch++) {
          const lam = rate[i * 3 + ch] * photons + 0.02; // plus a little sky
          acc[i * 3 + ch] += lam + Math.sqrt(lam) * N[j = (j + 1) & M] + readNoise * N[j = (j + 3) & M];
        }
      }
      this.frames++;
    }
  }

  /** Signal-to-noise at a pixel of unit rate after the frames so far. */
  get snr() {
    const s = this.frames * this.photons;
    return s / Math.sqrt(s + this.frames * this.readNoise * this.readNoise || 1);
  }

  draw() {
    const { acc, mask, tileOf, tiles, W, H } = this;
    const out = this.img.data;
    const norm = 1 / Math.max(1, this.frames * this.photons);
    const readRow = (t: number) => {
      // Each detector reads top to bottom in the same time.
      const tl = tiles[t];
      return tl.minY + (tl.maxY - tl.minY + 1) * this.read;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        if (!mask[i]) { out[o] = 5; out[o + 1] = 6; out[o + 2] = 8; out[o + 3] = 255; continue; }
        const t = tileOf[i];
        const row = this.read > 0 ? readRow(t) : -1;
        const done = y < row, line = Math.abs(y - row) < 1;
        for (let ch = 0; ch < 3; ch++) {
          // asinh stretch: faint things visible without blowing out the bright.
          const v = Math.max(0, acc[i * 3 + ch] * norm);
          let s = Math.asinh(v * 9) / Math.asinh(9);
          if (this.frames === 0) s = 0;
          out[o + ch] = Math.min(255, s * 255);
        }
        if (line) { out[o] = 120; out[o + 1] = 255; out[o + 2] = 140; }
        else if (this.read > 0 && !done) { out[o] *= 0.55; out[o + 1] *= 0.55; out[o + 2] *= 0.55; }
        out[o + 3] = 255;
      }
    }
    this.g.putImageData(this.img, 0, 0);
  }
}
