<script lang="ts">
  /**
   * Phased array beam pattern.
   *
   * Draws the array factor of a uniformly-fed line of N elements at spacing d,
   * electronically steered to a scan angle — the thing that lets a flat panel
   * point without moving. Everything here comes out of patternDb() and the band
   * table, so it agrees with the Link Budget window by construction rather than
   * by coincidence.
   *
   * The two effects worth seeing: scan loss, because a patch radiates like
   * cos(theta) so steering off boresight costs gain you cannot get back; and
   * grating lobes, which appear the moment element spacing passes ~0.5λ and put
   * a second full-strength beam somewhere you did not intend to transmit.
   */
  import { onDestroy } from 'svelte';
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import Slider from './shared/Slider.svelte';
  import Select from './shared/Select.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { observerStore } from '../stores/observer.svelte';
  import { palette } from './shared/theme';
  import { BANDS, CLIGHT, patternDb, DEG } from '../data/spacecraft';

  const RE_KM = 6371;

  let bandKey = $state('Ku');
  let elements = $state(16);
  let spacing = $state(0.5);
  let scanDeg = $state(0);
  let followSat = $state(true);

  const band = $derived(BANDS[bandKey]);
  const lambda = $derived(CLIGHT / (band.f * 1e9));

  /**
   * Track whatever the app is tracking, so the scan angle is a real look angle.
   * Same great-circle derivation as the Link Budget window, so the two windows
   * report the same off-nadir angle for the same satellite rather than drifting.
   */
  const tracked = $derived(uiStore.selectedSatData.length === 1 ? uiStore.selectedSatData[0] : null);
  const liveScan = $derived.by(() => {
    if (!tracked) return null;
    const o = observerStore.location;
    const la1 = o.lat * DEG, lo1 = o.lon * DEG;
    const la2 = tracked.latDeg * DEG, lo2 = tracked.lonDeg * DEG;
    const gamma = Math.acos(Math.min(1, Math.max(-1,
      Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(lo2 - lo1))));
    const rOrb = RE_KM + tracked.altKm;
    const el = Math.atan2(Math.cos(gamma) - RE_KM / rOrb, Math.sin(gamma)) / DEG;
    if (el <= 0) return null;
    return Math.max(0, Math.min(75, 90 - el - gamma / DEG));
  });
  const scan = $derived(followSat && liveScan !== null ? liveScan : scanDeg);

  /** Sample the pattern once and reuse it for the plot and every readout. */
  const pattern = $derived.by(() => {
    const N = 361;
    const pts: { deg: number; db: number }[] = [];
    let peak = -999, peakDeg = 0;
    for (let i = 0; i < N; i++) {
      const deg = -90 + (180 * i) / (N - 1);
      const db = patternDb(deg * DEG, scan * DEG, elements, spacing * lambda, lambda);
      pts.push({ deg, db });
      if (db > peak) { peak = db; peakDeg = deg; }
    }
    return { pts, peak, peakDeg };
  });

  /** -3 dB width, first sidelobe, and any grating lobe, read off the samples. */
  const metrics = $derived.by(() => {
    const { pts, peak, peakDeg } = pattern;
    const half = pts.filter((p) => p.db >= peak - 3).map((p) => p.deg);
    const beamwidth = half.length ? Math.max(...half) - Math.min(...half) : 0;

    // A grating lobe is a second main beam: within 6 dB of peak, well away from it.
    let grating: number | null = null;
    let sidelobe = -999;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      if (p.db <= pts[i - 1].db || p.db <= pts[i + 1].db) continue; // local maxima only
      if (Math.abs(p.deg - peakDeg) < Math.max(4, beamwidth)) continue;
      if (p.db > sidelobe) sidelobe = p.db;
      if (p.db > peak - 6 && grating === null) grating = p.deg;
    }
    // Scan loss is the cos(theta) element pattern, not an array effect.
    const scanLoss = -10 * Math.log10(Math.max(Math.cos(scan * DEG), 1e-4));
    return { beamwidth, sidelobe, grating, scanLoss, peak, peakDeg };
  });

  /** Spacing at which the first grating lobe enters real space, for this scan. */
  const gratingThreshold = $derived(1 / (1 + Math.abs(Math.sin(scan * DEG))));

  let cv = $state<HTMLCanvasElement | null>(null);
  let ro: ResizeObserver | null = null;

  function draw() {
    if (!cv) return;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const accent = palette.live || '#4ec07a';
    const dim = palette.textGhost || '#5c6b78';
    const grid = palette.gridSubtle || '#26333d';
    const danger = palette.danger || '#c0453b';

    const FLOOR = -40;
    const cx = w / 2, cy = h - 12, R = Math.min(w / 2 - 10, h - 24);

    // polar grid: rings every 10 dB, radials every 30°
    g.strokeStyle = grid; g.lineWidth = 1; g.font = '8px monospace'; g.fillStyle = dim;
    for (let db = 0; db >= FLOOR; db -= 10) {
      const r = R * (1 - db / FLOOR);
      g.beginPath(); g.arc(cx, cy, r, Math.PI, 2 * Math.PI); g.stroke();
      if (db < 0) g.fillText(`${db}`, cx + 2, cy - r + 9);
    }
    for (let a = -90; a <= 90; a += 30) {
      const rad = (a - 90) * DEG;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad));
      g.stroke();
      g.fillText(`${a}°`, cx + (R + 4) * Math.cos(rad) - (a > 0 ? 0 : 12), cy + (R + 4) * Math.sin(rad));
    }

    // steer direction
    const srad = (scan - 90) * DEG;
    g.strokeStyle = dim; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(srad), cy + R * Math.sin(srad)); g.stroke();
    g.setLineDash([]);

    // the pattern itself
    g.beginPath();
    pattern.pts.forEach((p, i) => {
      const db = Math.max(p.db, FLOOR);
      const r = R * (1 - db / FLOOR);
      const rad = (p.deg - 90) * DEG;
      const x = cx + r * Math.cos(rad), y = cy + r * Math.sin(rad);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = metrics.grating !== null ? danger : accent;
    g.lineWidth = 1.5;
    g.stroke();

    // fill under the curve, faintly
    g.lineTo(cx, cy); g.closePath();
    g.globalAlpha = 0.12;
    g.fillStyle = metrics.grating !== null ? danger : accent;
    g.fill();
    g.globalAlpha = 1;

    // grating lobe marker
    if (metrics.grating !== null) {
      const rad = (metrics.grating - 90) * DEG;
      g.strokeStyle = danger; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad)); g.stroke();
      g.fillStyle = danger;
      g.fillText('grating', cx + (R * 0.62) * Math.cos(rad) - 14, cy + (R * 0.62) * Math.sin(rad) - 3);
    }
  }

  $effect(() => {
    // touch every input so the plot redraws when any of them change
    void [pattern, metrics, bandKey];
    draw();
  });
  $effect(() => {
    const el = cv;
    if (!el || ro) return;
    ro = new ResizeObserver(() => draw());
    ro.observe(el);
  });
  onDestroy(() => ro?.disconnect());

  const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
</script>

{#if uiStore.phasedArrayOpen}
  <DraggableWindow
    title="Phased Array"
    id="phased-array"
    bind:open={uiStore.phasedArrayOpen}
    focus={uiStore.phasedArrayFocus}
    initialX={430}
    initialY={120}
    noPad
  >
    <div class="pa">
      <div class="pick">
        <Select id="pa-band" value={bandKey} onchange={(e: Event) => (bandKey = (e.currentTarget as HTMLSelectElement).value)}>
          {#each Object.keys(BANDS) as k}<option value={k}>{BANDS[k].label}</option>{/each}
        </Select>
        <span class="freq">{band.f} GHz · λ {fmt(lambda * 1000, 1)} mm</span>
      </div>

      <canvas bind:this={cv}></canvas>

      <div class="ctrl">
        <Slider
          label="Elements" min={2} max={64} step={1} value={elements}
          display={`${elements} × ${elements} = ${elements * elements}`}
          oninput={(e: Event) => (elements = +(e.currentTarget as HTMLInputElement).value)}
        />
        <Slider
          label="Element spacing" min={0.2} max={1.2} step={0.01} value={spacing}
          display={`${fmt(spacing, 2)} λ`}
          oninput={(e: Event) => (spacing = +(e.currentTarget as HTMLInputElement).value)}
        />
        <Slider
          label="Scan angle" min={0} max={75} step={0.5}
          value={scan}
          display={followSat && liveScan !== null ? `${fmt(scan)}° tracked` : `${fmt(scan)}°`}
          oninput={(e: Event) => { followSat = false; scanDeg = +(e.currentTarget as HTMLInputElement).value; }}
        />
      </div>

      {#if tracked}
        <button class="follow" class:on={followSat} onclick={() => (followSat = !followSat)}>
          {followSat ? '● steering at' : '○ steer at'} {tracked.name}
        </button>
      {/if}

      <div class="grid">
        <div class="cell"><span class="lbl">Beamwidth</span><b>{fmt(metrics.beamwidth)}°</b></div>
        <div class="cell"><span class="lbl">Scan loss</span><b>−{fmt(metrics.scanLoss, 2)} dB</b></div>
        <div class="cell">
          <span class="lbl">First sidelobe</span>
          <b>{metrics.sidelobe > -900 ? fmt(metrics.sidelobe, 1) + ' dB' : '—'}</b>
        </div>
        <div class="cell">
          <span class="lbl">Grating lobe</span>
          <b class:bad={metrics.grating !== null}>{metrics.grating !== null ? fmt(metrics.grating) + '°' : 'none'}</b>
        </div>
      </div>

      <p class="note">
        {#if metrics.grating !== null}
          At {fmt(spacing, 2)} λ and {fmt(scan)}° of scan a second full-strength beam has appeared at
          {fmt(metrics.grating)}°. Everything radiated there is interference to someone. Below
          {fmt(gratingThreshold, 2)} λ it disappears.
        {:else}
          Spacing is under the {fmt(gratingThreshold, 2)} λ limit for this scan angle, so there is one beam
          and one only. Steering to {fmt(scan)}° still costs {fmt(metrics.scanLoss, 2)} dB, because a patch
          radiates like cos θ and no amount of phasing recovers that.
        {/if}
      </p>
    </div>
  </DraggableWindow>
{/if}

<style>
  .pa { width: 330px; }
  .pick { display: flex; align-items: center; gap: 8px; padding: 8px 8px 4px; }
  .freq { font-size: 9px; color: var(--text-ghost); white-space: nowrap; }
  canvas { display: block; width: 100%; height: 190px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .ctrl { padding: 6px 8px 2px; }
  .follow {
    display: block; width: calc(100% - 16px); margin: 0 8px 8px; background: none;
    border: 1px solid var(--border); color: var(--text-dim); font: inherit; font-size: 9.5px;
    padding: 4px; cursor: pointer; text-align: center;
  }
  .follow.on { border-color: var(--accent); color: var(--accent); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--border); }
  .cell { padding: 6px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .cell .lbl { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .cell b { font-size: 13px; }
  .cell b.bad { color: var(--danger); }
  .note { padding: 8px; font-size: 10px; line-height: 1.55; color: var(--text-dim); }
</style>
