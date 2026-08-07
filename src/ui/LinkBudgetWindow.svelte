<script lang="ts">
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import Select from './shared/Select.svelte';
  import Slider from './shared/Slider.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { observerStore } from '../stores/observer.svelte';
  import { palette } from './shared/theme';
  import {
    PARTS, FLEET, PART_BY_ID, BANDS, linkBudget, patternDb, lookGeometry,
    type Part,
  } from '../data/spacecraft';

  const RE_KM = 6371;
  const D2R = Math.PI / 180;

  /* Which hardware is this? Guess from the TLE name, let the operator override. */
  function guessCraft(name: string): string {
    const n = name.toUpperCase();
    if (n.includes('STARLINK')) return 'sl-v2mini';
    if (n.includes('ONEWEB')) return 'ow-g1';
    if (n.includes('ICEYE')) return 'iceye-x';
    if (n.includes('FLOCK') || n.includes('DOVE')) return 'planet-dove';
    if (n.includes('SENTINEL-2')) return 'sentinel-2';
    if (n.includes('NAVSTAR') || n.includes('GPS')) return 'gps-iii';
    if (n.includes('BLUEBIRD')) return 'ast-bb2';
    if (n.includes('WORLDVIEW') || n.includes('LEGION')) return 'legion';
    return 'sl-v2mini';
  }

  let manualCraft = $state<string | null>(null);
  let manualAntenna = $state<string | null>(null);
  let spacing = $state(0.5);
  let rain = $state(0);
  let zoom = $state(false);

  /* The satellite satvisor is actually tracking, if there is exactly one. */
  const tracked = $derived(uiStore.selectedSatData.length ? uiStore.selectedSatData[0] : null);
  const craftId = $derived(manualCraft ?? (tracked ? guessCraft(tracked.name) : 'sl-v2mini'));
  const craft = $derived(FLEET.find((f) => f.id === craftId)!);

  const antennas = $derived(
    craft.parts.map((id) => PART_BY_ID[id]).filter((p): p is Part => !!p && !!p.rf),
  );
  const antenna = $derived(
    antennas.find((a) => a.id === manualAntenna) ?? antennas[0] ?? PARTS.find((p) => p.rf)!,
  );

  /* Live geometry: observer to the tracked subsatellite point.
     Great-circle central angle -> elevation, slant range and off-nadir scan. */
  const live = $derived.by(() => {
    if (!tracked) return null;
    const o = observerStore.location;
    const la1 = o.lat * D2R, lo1 = o.lon * D2R;
    const la2 = tracked.latDeg * D2R, lo2 = tracked.lonDeg * D2R;
    const gamma = Math.acos(
      Math.min(1, Math.max(-1,
        Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(lo2 - lo1))),
    );
    const h = tracked.altKm;
    const rOrb = RE_KM + h;
    const slant = Math.sqrt(RE_KM ** 2 + rOrb ** 2 - 2 * RE_KM * rOrb * Math.cos(gamma));
    // elevation of the satellite above the observer's horizon
    const el = Math.atan2(Math.cos(gamma) - RE_KM / rOrb, Math.sin(gamma)) / D2R;
    // the angle the satellite must steer its beam off nadir to reach the observer
    const scan = Math.max(0, 90 - el - gamma / D2R);
    return { gamma: gamma / D2R, slant, el, scan, h, visible: el > 0 };
  });

  const scanDeg = $derived(live?.visible ? live.scan : 20);
  const altKm = $derived(live ? live.h : craft.alt);

  const L = $derived(linkBudget(antenna, { scanDeg, spacing, altKm, rainPct: rain }));

  /* ---- radiation pattern, drawn as a dB envelope so narrow lobes survive ---- */
  const patternPath = $derived.by(() => {
    const W = 420, H = 130, FLOOR = -45;
    const span = zoom ? Math.max(L.theta3Deg * 6, 1) : 90;
    const c = zoom ? scanDeg : 0;
    const lo = Math.max(-90, c - span), hi = Math.min(90, c + span);
    const cols = 300, sub = 12;
    let d = '';
    for (let i = 0; i <= cols; i++) {
      const a0 = lo + ((hi - lo) * i) / cols;
      let m = -999;
      for (let j = 0; j < sub; j++) {
        const a = a0 + ((hi - lo) / cols) * (j / sub);
        const v = patternDb(a * D2R, scanDeg * D2R, L.isAperture ? 0 : L.N, L.d, L.lambda);
        if (v > m) m = v;
      }
      const x = i * (W / cols);
      const y = H - ((Math.max(m, FLOOR) - FLOOR) / -FLOOR) * (H - 10) - 5;
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return { d, lo, hi, W, H, beamX: ((scanDeg - lo) / (hi - lo)) * W };
  });

  const fmt = (n: number, d = 0) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
</script>

{#if uiStore.linkBudgetOpen}
  <DraggableWindow
    title="Link budget"
    id="linkbudget"
    bind:open={uiStore.linkBudgetOpen}
    focus={uiStore.linkBudgetFocus}
    initialX={340}
    initialY={90}
    noPad
  >
    <div class="lb">
      <div class="pick">
        <label class="lbl" for="lb-craft">Hardware</label>
        <Select
          id="lb-craft"
          value={craftId}
          onchange={(e: Event) => {
            manualCraft = (e.currentTarget as HTMLSelectElement).value;
            manualAntenna = null;
          }}
        >
          {#each FLEET as f}<option value={f.id}>{f.name}</option>{/each}
        </Select>
        <label class="lbl" for="lb-ant">Antenna</label>
        <Select
          id="lb-ant"
          value={antenna.id}
          onchange={(e: Event) => (manualAntenna = (e.currentTarget as HTMLSelectElement).value)}
        >
          {#each antennas as a}<option value={a.id}>{a.name}</option>{/each}
        </Select>
      </div>

      {#if tracked}
        <div class="live" class:down={!live?.visible}>
          {#if live?.visible}
            <span class="tag">tracking</span>
            <b>{tracked.name}</b> at {fmt(live.el, 1)}° elevation ·
            {fmt(live.slant)} km slant · beam steered {fmt(live.scan, 1)}° off nadir
          {:else}
            <span class="tag off">below horizon</span>
            <b>{tracked.name}</b> is {fmt(Math.abs(live?.el ?? 0), 1)}° under your horizon.
            Showing a 20° reference geometry instead.
          {/if}
        </div>
      {:else}
        <div class="live down">
          <span class="tag off">no satellite</span>
          Select a satellite to compute the budget against its live geometry.
        </div>
      {/if}

      <div class="plot">
        <svg viewBox="0 0 {patternPath.W} {patternPath.H}" preserveAspectRatio="none">
          {#each [-10, -20, -30, -40] as db}
            <line
              x1="0" x2={patternPath.W}
              y1={patternPath.H - ((db + 45) / 45) * (patternPath.H - 10) - 5}
              y2={patternPath.H - ((db + 45) / 45) * (patternPath.H - 10) - 5}
              stroke={palette.gridSubtle} stroke-width="1"
            />
          {/each}
          <line x1={patternPath.beamX} x2={patternPath.beamX} y1="0" y2={patternPath.H}
                stroke={palette.live} stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />
          <path d={patternPath.d} fill="none" stroke={palette.live} stroke-width="1.4" />
        </svg>
        <div class="plot-foot">
          <span>{Math.round(patternPath.lo)}°</span>
          <button class="link" onclick={() => (zoom = !zoom)}>
            {zoom ? 'full space' : 'main lobe'}
          </button>
          <span>{Math.round(patternPath.hi)}°</span>
        </div>
      </div>

      {#if L.grating}
        <div class="warn">
          Grating lobe at {spacing.toFixed(2)}λ — the array is radiating a second
          full-strength beam into the wrong part of the sky.
        </div>
      {/if}

      <div class="ctrls">
        <Slider
          label="Spacing" min={0.35} max={1.1} step={0.01}
          value={spacing} display={spacing.toFixed(2) + 'λ'}
          oninput={(e: Event) => (spacing = +(e.currentTarget as HTMLInputElement).value)}
        />
        <Slider
          label="Rain" min={0} max={100} step={1}
          value={rain} display={rain + '%'}
          oninput={(e: Event) => (rain = +(e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="grid">
        <div class="cell">
          <span class="lbl">Rate</span>
          <b>{L.mbps >= 1000 ? fmt(L.mbps / 1000, 2) + ' Gbps' : fmt(L.mbps) + ' Mbps'}</b>
        </div>
        <div class="cell">
          <span class="lbl">Modulation</span>
          <b>{L.best ? L.best.mod + ' ' + L.best.rate : 'no link'}</b>
        </div>
        <div class="cell">
          <span class="lbl">Es/N0</span><b>{fmt(L.esno, 1)} dB</b>
        </div>
        <div class="cell">
          <span class="lbl">Ground cell</span><b>{fmt(L.spotKm, 1)} km</b>
        </div>
      </div>

      <table class="budget">
        <tbody>
          <tr><td>Band</td><td>{L.band.f} GHz · {fmt(L.band.bwMHz)} MHz</td></tr>
          <tr><td>Aperture</td><td>{L.isAperture ? 'dish' : L.N + ' × ' + L.Nh + ' elements'}</td></tr>
          <tr><td>Boresight gain</td><td>{fmt(L.g0, 1)} dBi</td></tr>
          <tr><td>Scan loss</td><td>−{fmt(L.scanLoss, 2)} dB</td></tr>
          <tr><td>EIRP</td><td class="hi">{fmt(L.eirp, 1)} dBW</td></tr>
          <tr><td>Free space</td><td>−{fmt(L.fspl, 1)} dB</td></tr>
          <tr><td>Rain</td><td>−{fmt(L.rain, 2)} dB</td></tr>
          <tr><td>Received</td><td>{fmt(L.pr, 1)} dBW</td></tr>
          <tr><td>C/N0</td><td>{fmt(L.cn0, 1)} dB-Hz</td></tr>
          <tr><td>Co-channel C/I</td><td>{fmt(L.band.ci, 0)} dB</td></tr>
        </tbody>
      </table>

      <div class="note">
        {L.wave === 'ofdm'
          ? 'Starlink OFDM: 1024 subcarriers, 750 Hz frames, 4QAM and 16QAM only.'
          : L.wave === 'lte'
            ? 'LTE Band 25. Rate is measured in the field, not modelled.'
            : 'Gateway waveform is unpublished; DVB-S2X used as a stand-in.'}
      </div>
    </div>
  </DraggableWindow>
{/if}

<style>
  .lb { min-width: 430px; display: flex; flex-direction: column; }
  @media (max-width: 767px) { .lb { min-width: unset; width: 100%; } }
  .pick {
    display: grid; grid-template-columns: auto 1fr auto 1fr;
    gap: 6px; align-items: center; padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .lbl {
    font-size: 10px; color: var(--text-ghost);
    text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
  }
  .live {
    padding: 7px 12px; font-size: 11px; line-height: 1.45;
    border-bottom: 1px solid var(--border); color: var(--text-dim);
  }
  .live b { color: var(--text); }
  .tag {
    display: inline-block; font-size: 9px; letter-spacing: 0.6px;
    text-transform: uppercase; color: var(--live);
    border: 1px solid var(--live); border-radius: 2px;
    padding: 0 4px; margin-right: 6px;
  }
  .tag.off { color: var(--text-ghost); border-color: var(--border); }
  .live.down { color: var(--text-ghost); }
  .plot { padding: 6px 12px 0; }
  .plot svg { width: 100%; height: 130px; display: block; }
  .plot-foot {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 9px; color: var(--text-ghost); padding: 2px 0 6px;
  }
  .link {
    background: none; border: none; color: var(--live);
    font: inherit; cursor: pointer; padding: 0;
  }
  .warn {
    margin: 0 12px 6px; padding: 5px 8px; font-size: 10.5px; line-height: 1.4;
    color: var(--text-dim); border-left: 2px solid var(--warning);
  }
  .ctrls { padding: 4px 12px 8px; display: flex; flex-direction: column; gap: 4px; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--border);
  }
  .cell {
    padding: 6px 12px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 1px;
  }
  .cell:nth-child(2n) { border-right: none; }
  .cell b { font-size: 15px; color: var(--text); font-weight: 500; }
  .budget { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .budget td { padding: 2px 12px; color: var(--text-ghost); }
  .budget td:last-child { text-align: right; color: var(--text-dim); }
  .budget td.hi { color: var(--live); }
  .note {
    padding: 8px 12px; font-size: 10px; line-height: 1.5;
    color: var(--text-ghost); border-top: 1px solid var(--border);
  }
</style>
