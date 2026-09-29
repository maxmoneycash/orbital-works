<script lang="ts">
  /**
   * Live telemetry: frames volunteer SatNOGS ground stations decoded from
   * satellites in the last half hour or so, streamed in the order they were
   * heard. A sheet on phones, a window on wide screens. The focused frame's
   * pass is drawn on the globe: the station, where the satellite was when the
   * station heard it, and the downlink between them.
   */
  import { onDestroy } from 'svelte';
  import { uiStore } from '../../stores/ui.svelte';
  import MobileSheet from '../shared/MobileSheet.svelte';
  import DraggableWindow from '../shared/DraggableWindow.svelte';
  import { fetchTelemetry, decodeFrame, ago, type TelemetryObservation, type DecodedFrame } from '../../data/telemetry';

  interface Entry { key: string; obs: TelemetryObservation; t: string; d: DecodedFrame; length: number; fresh: boolean }

  const POLL_MS = 90_000;
  const MAX_SHOWN = 60;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let phase = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  let shown = $state<Entry[]>([]);
  let pinned = $state<string | null>(null);
  let now = $state(Date.now());
  const seen = new Set<string>();
  let queue: Entry[] = [];
  let pollTimer = 0, revealTimer = 0, clockTimer = 0;
  let abort: AbortController | null = null;

  const active = $derived(uiStore.telemetryActive && !uiStore.romanStoryActive);
  const stations = $derived(new Set(shown.map((e) => e.obs.station.name)).size);
  const sats = $derived(new Set(shown.map((e) => e.obs.norad)).size);
  const focusKey = $derived(pinned ?? shown[0]?.key ?? null);

  async function load() {
    if (phase !== 'ready') phase = 'loading';
    abort?.abort();
    abort = new AbortController();
    try {
      const feed = await fetchTelemetry(abort.signal);
      const incoming: Entry[] = [];
      for (const obs of feed.observations) {
        for (const f of obs.frames) {
          const key = `${obs.id}:${f.t}:${f.hex.slice(0, 24)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          incoming.push({ key, obs, t: f.t, d: decodeFrame(f.hex), length: f.length, fresh: true });
        }
      }
      incoming.sort((a, b) => a.t.localeCompare(b.t));
      const first = phase !== 'ready';
      phase = 'ready';
      if (first) {
        // The backlog lands at once and its newest frames play in, in the
        // order they were heard; later arrivals stream in the same way.
        const tail = reduced ? 0 : Math.min(8, incoming.length);
        shown = incoming.slice(0, incoming.length - tail).reverse().slice(0, MAX_SHOWN).map((e) => ({ ...e, fresh: false }));
        queue = incoming.slice(incoming.length - tail);
      } else {
        queue.push(...incoming);
      }
      if (!revealTimer) revealNext();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (phase !== 'ready') phase = 'failed';
    }
  }

  function revealNext() {
    const next = queue.shift();
    if (!next) { revealTimer = 0; return; }
    shown = [next, ...shown.map((e) => (e.fresh ? { ...e, fresh: false } : e))].slice(0, MAX_SHOWN);
    revealTimer = window.setTimeout(revealNext, reduced ? 200 : 1600);
  }

  function start() {
    load();
    pollTimer = window.setInterval(load, POLL_MS);
    clockTimer = window.setInterval(() => (now = Date.now()), 15_000);
  }
  function stop() {
    clearInterval(pollTimer); clearInterval(clockTimer); clearTimeout(revealTimer);
    pollTimer = clockTimer = revealTimer = 0;
    abort?.abort();
    uiStore.telemetryFocus = null;
  }
  $effect(() => {
    if (!active) return;
    start();
    return stop;
  });
  onDestroy(stop);

  // The globe follows the newest frame until one is chosen, turning to each new station.
  let lastFocus: string | null = null;
  let lastStation: string | null = null;
  $effect(() => {
    const e = shown.find((x) => x.key === focusKey);
    if (!active || !e) return;
    if (e.key === lastFocus) return;
    const fly = lastFocus === null || pinned === e.key || e.obs.station.name !== lastStation;
    lastFocus = e.key;
    lastStation = e.obs.station.name;
    uiStore.telemetryFocus = { obs: e.obs, t: e.t };
    if (fly) uiStore.onTelemetryFly?.();
  });

  function choose(e: Entry) {
    pinned = pinned === e.key ? null : e.key;
    if (pinned === null) lastFocus = null;
  }

  const clock = (iso: string) => iso.slice(11, 19);
  const baud = (b: number | null) => { if (!b) return ''; if (b < 1000) return `${b}`; const k = Math.floor(b / 1000), r = Math.round((b % 1000) / 100); return r ? `${k}k${r}` : `${k}k`; };
  const mhz = (hz: number | null) => (hz ? `${(hz / 1e6).toFixed(3)} MHz` : '');
  function hexRows(d: DecodedFrame, n = 24) {
    const out: { b: string; head: boolean }[] = [];
    for (let i = 0; i < Math.min(n, d.bytes.length); i++) out.push({ b: d.bytes[i].toString(16).padStart(2, '0'), head: i < d.headerLen });
    return out;
  }
</script>

{#snippet body()}
  <div class="tel" class:mobile={uiStore.isMobile}>
    <header class="head">
      <span class="live" class:off={phase !== 'ready'}><i aria-hidden="true"></i>{phase === 'ready' ? 'Live' : 'Listening'}</span>
      {#if phase === 'ready' && shown.length}
        <p class="sum"><b>{shown.length}</b> frames from <b>{sats}</b> satellites, heard by <b>{stations}</b> ground stations</p>
      {/if}
    </header>

    {#if phase === 'loading' || phase === 'idle'}
      <p class="state"><i class="breathe" aria-hidden="true"></i>Tuning in to the SatNOGS network</p>
    {:else if phase === 'failed'}
      <div class="state failed">
        <p>The ground-station network didn’t answer. Check the connection, then try again.</p>
        <button type="button" class="action" onclick={() => { phase = 'idle'; load(); }}>Try again</button>
      </div>
    {:else if !shown.length}
      <p class="state">No decoded frames in the last half hour. New passes arrive every few minutes.</p>
    {:else}
      <ol class="feed" aria-live="polite" aria-relevant="additions">
        {#each shown as e (e.key)}
          <li class:focus={e.key === focusKey} class:fresh={e.fresh && !reduced}>
            <button type="button" class="entry" aria-pressed={pinned === e.key} onclick={() => choose(e)}>
              <span class="l1">
                <span class="sat">{e.obs.satellite}</span>
                <svg class="arrow" viewBox="0 0 16 8" aria-hidden="true"><path d="M1 4h13M10 1l4 3-4 3" /></svg>
                <span class="stn" title={e.obs.station.name}>{e.obs.station.name}</span>
                <time datetime={e.t}>{clock(e.t)}Z</time>
              </span>
              <span class="l2">{[e.obs.mode, baud(e.obs.baud), mhz(e.obs.frequencyHz)].filter(Boolean).join(' · ')} · {ago(e.t, now)}</span>
              {#if e.d.src}
                <span class="ax"><b>{e.d.src}</b> to {e.d.dst}</span>
              {/if}
              {#if e.d.text}
                <span class="txt">{e.d.text}</span>
              {/if}
              <span class="hex" aria-hidden="true">{#each hexRows(e.d, uiStore.isMobile ? 16 : 24) as h, i (i)}<span class:h={h.head}>{h.b}</span>{/each}{#if e.length > (uiStore.isMobile ? 16 : 24)}<span class="more">+{e.length - (uiStore.isMobile ? 16 : 24)}</span>{/if}</span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}

    <p class="note">
      Frames decoded by volunteer <a href="https://network.satnogs.org" target="_blank" rel="noopener">SatNOGS</a> ground stations, minutes after they were heard. The globe shows the station and where the satellite was at that moment. {uiStore.isMobile ? 'Tap' : 'Click'} a frame to hold it there.
    </p>
  </div>
{/snippet}

{#if uiStore.isMobile}
  <MobileSheet id="telemetry" title="Live telemetry">
    {@render body()}
  </MobileSheet>
{:else if uiStore.telemetryOpen}
  <DraggableWindow title="Live telemetry" id="telemetry" bind:open={uiStore.telemetryOpen} initialX={16} initialY={96} noPad>
    {@render body()}
  </DraggableWindow>
{/if}

<style>
  .tel { width: 372px; max-height: min(74vh, 700px); overflow-y: auto; font-size: 12px; color: var(--text); }
  .tel.mobile { width: auto; max-height: none; overflow: visible; font-size: 14px; }

  .head { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px 8px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--ui-bg); z-index: 1; }
  .mobile .head { padding: 0 0 10px; position: static; background: none; }
  .live { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--live); }
  .mobile .live { font-size: 11px; }
  .live i { width: 7px; height: 7px; border-radius: 50%; background: var(--live); box-shadow: 0 0 8px var(--live); animation: beat 1.6s ease-in-out infinite; }
  .live.off { color: var(--text-dim); }
  .live.off i { background: var(--text-dim); box-shadow: none; }
  @keyframes beat { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .sum { margin: 0; color: var(--text-dim); line-height: 1.4; }
  .sum b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

  .state { display: flex; align-items: center; gap: 10px; margin: 0; padding: 14px 12px; color: var(--text-dim); line-height: 1.45; }
  .mobile .state { padding: 14px 0; }
  .state.failed { display: grid; gap: 10px; }
  .state p { margin: 0; }
  .breathe { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--live); animation: beat 1.2s ease-in-out infinite; }
  .action { justify-self: start; min-height: 36px; padding: 0 14px; font: inherit; color: var(--text); background: none; border: 1px solid var(--border); cursor: pointer; }
  .mobile .action { min-height: 44px; }
  .action:hover { border-color: var(--live); }

  .feed { list-style: none; margin: 0; padding: 0; }
  .feed li { border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
  .entry {
    width: 100%; display: grid; gap: 3px; padding: 8px 12px 9px 14px; font: inherit; color: inherit; text-align: left;
    background: none; border: none; border-left: 2px solid transparent; cursor: pointer; min-height: 44px;
  }
  .mobile .entry { padding: 11px 0 12px 12px; gap: 4px; }
  .entry:hover { background: var(--card-bg); }
  .mobile .entry:hover { background: none; }
  .focus .entry { border-left-color: var(--live); background: color-mix(in srgb, var(--live) 6%, transparent); }
  .entry[aria-pressed='true'] { background: color-mix(in srgb, var(--live) 10%, transparent); }
  .entry:focus-visible { outline: 1px solid var(--live); outline-offset: -1px; }

  .l1 { display: grid; grid-template-columns: auto 14px minmax(0, 1fr) auto; align-items: center; gap: 6px; }
  .sat { font-weight: 600; color: var(--text); white-space: nowrap; }
  .arrow { width: 14px; height: 8px; fill: none; stroke: var(--live); stroke-width: 1.3; }
  .stn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); }
  time { font-variant-numeric: tabular-nums; color: var(--text-ghost); font-size: 10.5px; }
  .mobile time { font-size: 12px; }
  .l2 { color: var(--text-ghost); font-size: 10.5px; }
  .mobile .l2 { font-size: 12px; }
  .ax { color: var(--text-dim); font-size: 11px; }
  .mobile .ax { font-size: 13px; }
  .ax b { color: var(--live); font-weight: 600; letter-spacing: 0.02em; }
  .txt {
    color: var(--text); line-height: 1.45; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .hex { display: flex; flex-wrap: wrap; gap: 0 5px; font-size: 10px; line-height: 1.5; color: var(--text-faint); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .mobile .hex { font-size: 12px; gap: 0 6px; }
  .hex .h { color: color-mix(in srgb, var(--live) 70%, var(--text-faint)); }
  .hex .more { color: var(--text-ghost); }

  /* A new frame types itself in, then settles. */
  .fresh .entry { animation: arrive 1.4s ease-out both; }
  .fresh .hex { animation: typein 0.9s steps(24, end) both; }
  @keyframes arrive { from { background: color-mix(in srgb, var(--live) 18%, transparent); } to { background: transparent; } }
  @keyframes typein { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }

  .note { margin: 10px 12px 12px; font-size: 10.5px; line-height: 1.55; color: var(--text-ghost); }
  .mobile .note { margin: 14px 0 4px; font-size: 12px; }
  .note a { color: var(--text-dim); }
  @media (prefers-reduced-motion: reduce) {
    .live i, .breathe { animation: none; }
  }
</style>
