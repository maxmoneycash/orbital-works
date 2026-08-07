<script lang="ts">
  /**
   * Ku downlink waveform.
   *
   * Starlink's user downlink is proprietary OFDM, not DVB-S2X, and every number
   * here comes from the OFDM/STARLINK_MCS tables — Humphreys et al., "Signal
   * Structure of the Starlink Ku-Band Downlink", IEEE TAES 2023, the UT Austin
   * teardown of the live signal. Only 4QAM and 16QAM have ever been observed on
   * air, which is why the constellation picker stops there.
   *
   * Three views of the same signal: the subcarrier spectrum, the time-domain sum
   * of those subcarriers, and the constellation the receiver actually decides on.
   */
  import { onDestroy } from 'svelte';
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import Slider from './shared/Slider.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { palette } from './shared/theme';
  import { OFDM, STARLINK_MCS, ofdmRateMbps } from '../data/spacecraft';

  type View = 'spectrum' | 'time' | 'constellation';

  let view = $state<View>('spectrum');
  let mcsIdx = $state(2);
  let esno = $state(14);
  let carriers = $state(24);

  const mcs = $derived(STARLINK_MCS[mcsIdx]);
  const rate = $derived(ofdmRateMbps(mcs));
  const usable = $derived(Math.round(OFDM.N * OFDM.occupancy));
  /** A MODCOD closes when Es/N0 clears its required threshold. */
  const closes = $derived(esno >= mcs.req);
  const best = $derived.by(() => {
    let b = -1;
    STARLINK_MCS.forEach((m, i) => { if (esno >= m.req) b = i; });
    return b;
  });

  let cv = $state<HTMLCanvasElement | null>(null);
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let phase = 0;

  /** Deterministic noise so the constellation does not shimmer between frames. */
  function rand(i: number) {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function gauss(i: number) {
    const u = Math.max(1e-6, rand(i)), v = rand(i + 7919);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

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

    const live = palette.live || '#4ec07a';
    const dim = palette.textGhost || '#5c6b78';
    const grid = palette.gridSubtle || '#26333d';
    const danger = palette.danger || '#c0453b';
    const pad = 10;

    if (view === 'spectrum') {
      // Subcarriers across the 240 MHz channel, with the guard band at the edges.
      const n = 128; // drawn bins, standing in for 1024 real subcarriers
      const bw = (w - pad * 2) / n;
      const active = Math.round(n * OFDM.occupancy);
      const edge = Math.floor((n - active) / 2);
      g.strokeStyle = grid;
      g.beginPath(); g.moveTo(pad, h - 18); g.lineTo(w - pad, h - 18); g.stroke();
      for (let i = 0; i < n; i++) {
        const on = i >= edge && i < edge + active;
        // slight ripple so it reads as a real signal, not a solid block
        const amp = on ? 0.62 + 0.3 * Math.abs(Math.sin(i * 0.7 + phase * 0.35)) : 0;
        const bh = amp * (h - 34);
        g.fillStyle = on ? live : grid;
        g.globalAlpha = on ? 0.75 : 0.5;
        g.fillRect(pad + i * bw, h - 18 - bh, Math.max(1, bw - 1), on ? bh : 3);
      }
      g.globalAlpha = 1;
      g.fillStyle = dim; g.font = '8px monospace';
      g.fillText('guard', pad + 1, h - 6);
      g.fillText(`${usable} active subcarriers · ${(OFDM.subcarrierHz / 1000).toFixed(2)} kHz spacing`, pad + 42, h - 6);
      g.fillText('guard', w - pad - 28, h - 6);
    } else if (view === 'time') {
      // Sum of `carriers` equally-spaced tones — the OFDM symbol in the time domain.
      const mid = (h - 20) / 2 + 6;
      g.strokeStyle = grid;
      g.beginPath(); g.moveTo(pad, mid); g.lineTo(w - pad, mid); g.stroke();
      g.beginPath();
      const N = Math.max(2, Math.floor(w - pad * 2));
      let peak = 0;
      const vals: number[] = [];
      for (let x = 0; x < N; x++) {
        const t = x / N;
        let v = 0;
        for (let k = 1; k <= carriers; k++) v += Math.cos(2 * Math.PI * k * t * 2 + phase + k * 1.7);
        v /= Math.sqrt(carriers);
        vals.push(v);
        peak = Math.max(peak, Math.abs(v));
      }
      vals.forEach((v, x) => {
        const y = mid - (v / Math.max(peak, 0.001)) * (mid - 14);
        x ? g.lineTo(pad + x, y) : g.moveTo(pad + x, y);
      });
      g.strokeStyle = live; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = dim; g.font = '8px monospace';
      // PAPR is why OFDM needs a backed-off, linear amplifier.
      const papr = 10 * Math.log10((peak * peak) / (vals.reduce((a, v) => a + v * v, 0) / vals.length));
      g.fillText(`${carriers} subcarriers summed · PAPR ${papr.toFixed(1)} dB · symbol ${OFDM.symbolUs} µs`, pad, h - 6);
    } else {
      // Constellation with AWGN scaled to the chosen Es/N0.
      const size = Math.min(w, h) - 26;
      const cx = w / 2, cy = (h - 14) / 2 + 4;
      g.strokeStyle = grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - size / 2, cy); g.lineTo(cx + size / 2, cy);
      g.moveTo(cx, cy - size / 2); g.lineTo(cx, cy + size / 2); g.stroke();

      const m = mcs.bits === 2 ? 2 : 4; // 4QAM -> 2x2, 16QAM -> 4x4
      const sigma = Math.pow(10, -esno / 20) * 0.72;
      const step = size / (m + 1);
      let i = 0;
      for (let a = 0; a < m; a++) {
        for (let b = 0; b < m; b++) {
          const ix = (a - (m - 1) / 2) * step;
          const iy = (b - (m - 1) / 2) * step;
          for (let s = 0; s < 26; s++, i++) {
            const x = cx + ix + gauss(i) * sigma * size * 0.5;
            const y = cy + iy + gauss(i + 4001) * sigma * size * 0.5;
            g.fillStyle = closes ? live : danger;
            g.globalAlpha = 0.5;
            g.fillRect(x, y, 1.6, 1.6);
          }
          g.globalAlpha = 1;
          g.fillStyle = dim;
          g.fillRect(cx + ix - 1, cy + iy - 1, 2, 2);
        }
      }
      g.fillStyle = dim; g.font = '8px monospace';
      g.fillText(`${mcs.mod} · Es/N0 ${esno.toFixed(1)} dB · needs ${mcs.req} dB`, pad, h - 4);
    }
  }

  /** Only the two animated views need a frame loop; the constellation is static. */
  $effect(() => {
    const animated = view !== 'constellation';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(raf);
    if (animated && !reduce) {
      const tick = () => { phase += 0.03; draw(); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    } else {
      draw();
    }
    return () => cancelAnimationFrame(raf);
  });
  $effect(() => { void [view, mcsIdx, esno, carriers]; draw(); });
  $effect(() => {
    const el = cv;
    if (!el || ro) return;
    ro = new ResizeObserver(() => draw());
    ro.observe(el);
  });
  onDestroy(() => { cancelAnimationFrame(raf); ro?.disconnect(); });

  const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '—');
</script>

{#if uiStore.waveformOpen}
  <DraggableWindow
    title="Waveform"
    id="waveform"
    bind:open={uiStore.waveformOpen}
    focus={uiStore.waveformFocus}
    initialX={500}
    initialY={160}
    noPad
  >
    <div class="wf">
      <div class="tabs">
        {#each [['spectrum', 'Spectrum'], ['time', 'Time'], ['constellation', 'Constellation']] as [id, label]}
          <button class="tab" class:on={view === id} onclick={() => (view = id as View)}>{label}</button>
        {/each}
      </div>

      <canvas bind:this={cv}></canvas>

      <div class="ctrl">
        {#if view === 'time'}
          <Slider
            label="Subcarriers summed" min={1} max={64} step={1} value={carriers}
            display={String(carriers)}
            oninput={(e: Event) => (carriers = +(e.currentTarget as HTMLInputElement).value)}
          />
        {:else}
          <Slider
            label="Es/N0" min={0} max={24} step={0.1} value={esno}
            display={`${fmt(esno, 1)} dB`}
            oninput={(e: Event) => (esno = +(e.currentTarget as HTMLInputElement).value)}
          />
        {/if}
      </div>

      <div class="mcs">
        {#each STARLINK_MCS as m, i}
          <button
            class="row" class:on={mcsIdx === i} class:ok={esno >= m.req} class:pick={best === i}
            onclick={() => (mcsIdx = i)}
          >
            <span class="mod">{m.mod} {m.rate}</span>
            <span class="req">{m.req} dB</span>
            <span class="rate">{fmt(ofdmRateMbps(m))} Mbps</span>
          </button>
        {/each}
      </div>

      <div class="grid">
        <div class="cell"><span class="lbl">Channel</span><b>{OFDM.fsMHz} MHz</b></div>
        <div class="cell"><span class="lbl">Frame</span><b>{OFDM.frameHz} Hz</b></div>
        <div class="cell"><span class="lbl">Selected rate</span><b class:bad={!closes}>{fmt(rate)} Mbps</b></div>
        <div class="cell"><span class="lbl">Cyclic prefix</span><b>{OFDM.cpNs} ns</b></div>
      </div>

      <p class="note">
        {#if best < 0}
          At {fmt(esno, 1)} dB nothing closes — even 4QAM 1/2 needs {STARLINK_MCS[0].req} dB. The link is down.
        {:else if !closes}
          {mcs.mod} {mcs.rate} needs {mcs.req} dB and you have {fmt(esno, 1)}. The receiver would fall back to
          {STARLINK_MCS[best].mod} {STARLINK_MCS[best].rate} at {fmt(ofdmRateMbps(STARLINK_MCS[best]))} Mbps.
        {:else}
          {OFDM.N} subcarriers, {usable} of them carrying data across {OFDM.channels} channels of
          {OFDM.fsMHz} MHz. {OFDM.dataSymbols} data symbols per {OFDM.frameHz} Hz frame. Only 4QAM and 16QAM
          have ever been observed on air — no 64QAM, no APSK.
        {/if}
      </p>
    </div>
  </DraggableWindow>
{/if}

<style>
  .wf { width: 330px; }
  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tab {
    flex: 1; background: none; border: none; border-right: 1px solid var(--border);
    color: var(--text-ghost); font: inherit; font-size: 9px; text-transform: uppercase;
    letter-spacing: .09em; padding: 6px 2px; cursor: pointer;
  }
  .tab:last-child { border-right: none; }
  .tab:hover { color: var(--text); }
  .tab.on { color: var(--live); background: var(--card-bg); }
  canvas { display: block; width: 100%; height: 165px; border-bottom: 1px solid var(--border); }
  .ctrl { padding: 6px 8px 0; }
  .mcs { padding: 2px 8px 6px; }
  .row {
    display: grid; grid-template-columns: 1fr auto auto; gap: 8px; width: 100%;
    background: none; border: none; border-left: 2px solid transparent;
    color: var(--text-ghost); font: inherit; font-size: 10px; padding: 2px 6px;
    cursor: pointer; text-align: left;
  }
  .row.ok { color: var(--text-dim); }
  .row.on { background: var(--card-bg); color: var(--text); }
  .row.pick { border-left-color: var(--live); }
  .rate { color: var(--text-ghost); min-width: 68px; text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--border); }
  .cell { padding: 6px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .cell .lbl { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .cell b { font-size: 12.5px; }
  .cell b.bad { color: var(--danger); }
  .note { padding: 8px; font-size: 10px; line-height: 1.55; color: var(--text-dim); }
</style>
