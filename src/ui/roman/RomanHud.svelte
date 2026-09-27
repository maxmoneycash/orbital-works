<script lang="ts">
  /**
   * The words over Roman while the camera is up close: what it is doing, a
   * line of live numbers, and the shows. Everything else happens on the model
   * itself; the app's floating windows step aside until the camera leaves.
   */
  import { uiStore, type RomanShow } from '../../stores/ui.svelte';
  import { DEPLOYMENTS } from '../../roman/chapters';
  import { PHASES, PHASE_LABEL } from '../../roman/sim';

  const v = $derived(uiStore.romanView);

  const SHOWS: { id: RomanShow; label: string; short: string }[] = [
    { id: 'live', label: 'Live', short: 'Live' },
    { id: 'light', label: 'Light path', short: 'Light' },
    { id: 'apart', label: 'Take apart', short: 'Apart' },
    { id: 'unfold', label: 'Unfold', short: 'Unfold' },
  ];

  const km = (n: number) => Math.round(n).toLocaleString('en-US');

  const PHASE_NOTE: Record<string, string> = {
    slew: 'Turning to the next field. It rolls about the Sun line, so the shield never leaves the Sun.',
    settle: 'Settling on the field.',
    expose: 'Starlight comes down the barrel, off the 2.4 m primary, back from the secondary and through the aft optics onto 18 detectors.',
    readout: 'Reading out, each detector top to bottom.',
  };

  const copy = $derived.by(() => {
    if (!v) return { title: '', body: '' };
    switch (v.show) {
      case 'light': return { title: 'How it will see', body: PHASE_NOTE[v.phase ?? 'settle'] };
      case 'apart': return { title: 'Every part', body: 'Drag to turn it. Point at any part to name it; click to hold it.' };
      case 'unfold': return { title: 'Unfolding, as flown', body: DEPLOYMENTS[v.step].what };
      default: return {
        title: 'Roman, right now',
        body: `Shield on the Sun, antenna on Earth. ${v.station ? `Sending to ${v.station} over Ka-band.` : 'No station has it in view; the dish holds on Earth.'}`,
      };
    }
  });

  // Step aside: the app's windows fade out from the moment the camera sets
  // off for Roman until it leaves.
  $effect(() => {
    document.body.classList.toggle('roman-focus', !!v || uiStore.romanFlying);
    return () => document.body.classList.remove('roman-focus');
  });
</script>

{#if v}
  <section class="hud" aria-label="Roman Space Telescope">
    <div class="copy" aria-live="polite">
      {#if v.show === 'light'}
        <ol class="phases" aria-label="Observing cycle">
          {#each PHASES as p (p)}
            {@const i = PHASES.indexOf(p)}
            {@const now = PHASES.indexOf(v.phase ?? 'settle')}
            <li class:on={i === now} class:done={i < now}>
              {PHASE_LABEL[p]}
              {#if i === now}<i style="transform: scaleX({v.phaseProgress})"></i>{/if}
            </li>
          {/each}
        </ol>
      {:else if v.show === 'unfold'}
        <ol class="phases steps" aria-label="Deployments">
          {#each DEPLOYMENTS as d, i (d.key)}
            <li class:on={i === v.step} class:done={i < v.step}>{d.when}</li>
          {/each}
        </ol>
      {/if}
      <h2>{copy.title}</h2>
      <p class="body">{copy.body}</p>
      {#if v.part}
        <p class="part"><b>{v.part.name}</b>{#if v.part.subsystem} · {v.part.subsystem}{/if}<span>{v.part.blurb}</span></p>
      {/if}
      <dl class="stats">
        <div><dt>From Earth</dt><dd>{km(v.distKm)} km</dd></div>
        <div><dt>Signal delay</dt><dd>{v.lightSec.toFixed(2)} s</dd></div>
        {#if v.l2Km !== null}<div><dt>From L2</dt><dd>{km(v.l2Km)} km</dd></div>{/if}
        <div><dt>Speed</dt><dd>{v.speedKmS.toFixed(2)} km/s</dd></div>
      </dl>
      <p class="fine">
        {#if v.show === 'light'}{v.target} · simulated cycle, compressed to under a minute; science starts after commissioning and these fields are synthetic. {/if}
        {#if v.extrapolated}Past the published trajectory: held at its last point. {/if}
        Drawn about 60,000× life size. Position: JPL Horizons.
      </p>
    </div>

    <nav class="bar" aria-label="Roman shows">
      <div class="shows" role="group">
        {#each SHOWS as s (s.id)}
          <button class:on={v.show === s.id} aria-pressed={v.show === s.id} onclick={() => uiStore.onRomanShow?.(s.id)}><span class="long">{s.label}</span><span class="short" aria-hidden="true">{s.short}</span></button>
        {/each}
      </div>
      <button class="ghost" disabled={v.replaying} onclick={() => uiStore.onReplayRoman?.()}>{#if v.replaying}Replaying…{:else}Replay<span class="long">the flight</span>{/if}</button>
      <button class="ghost" onclick={() => uiStore.onLeaveRoman?.()}>
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" /></svg>
        Earth
      </button>
    </nav>
  </section>
{/if}

<style>
  .hud {
    --ink: #f2f1ec;
    --ink-2: rgba(242, 241, 236, 0.72);
    --ink-3: rgba(242, 241, 236, 0.46);
    --rule: rgba(242, 241, 236, 0.16);
    position: absolute; inset: auto 0 0 0; pointer-events: none;
    font-family: 'Overpass Mono', ui-monospace, monospace; color: var(--ink);
    z-index: 40;
  }
  .hud button { font: inherit; color: inherit; pointer-events: auto; }
  .hud :focus-visible { outline: 1px solid var(--live); outline-offset: 2px; }

  .copy {
    position: absolute; left: 16px; bottom: 40px; width: min(430px, calc(100vw - 32px));
    padding: 14px 16px 12px; pointer-events: auto;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0.42));
    border-left: 1px solid var(--live);
  }
  h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .body { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink-2); min-height: 3em; }
  .part { margin: 8px 0 0; font-size: 12px; line-height: 1.45; display: grid; gap: 2px; }
  .part b { font-weight: 600; color: var(--live); }
  .part span { color: var(--ink-2); font-size: 11.5px; }

  .phases { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-wrap: wrap; gap: 2px; }
  .phases li { position: relative; padding: 2px 7px 3px; font-size: 10.5px; color: var(--ink-3); border-bottom: 1px solid var(--rule); }
  .phases li.done { color: var(--ink-2); }
  .phases li.on { color: var(--ink); }
  .phases li i { position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--live); transform-origin: left; }
  .steps li.on { color: var(--live); border-bottom-color: var(--live); }

  .stats { margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .stats div { display: grid; }
  .stats dt { font-size: 10px; color: var(--ink-3); }
  .stats dd { margin: 0; font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .fine { margin: 8px 0 0; font-size: 10px; line-height: 1.45; color: var(--ink-3); }

  .bar {
    position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
    display: flex; gap: 6px; align-items: center; pointer-events: none;
  }
  .shows { display: flex; border: 1px solid var(--rule); background: rgba(0, 0, 0, 0.55); pointer-events: auto; }
  .shows button { background: none; border: none; padding: 7px 13px; font-size: 11.5px; color: var(--ink-2); cursor: pointer; white-space: nowrap; }
  .shows button + button { border-left: 1px solid var(--rule); }
  .shows button:hover { color: var(--ink); }
  .shows button.on { color: #000; background: var(--live); font-weight: 600; }
  .hud .ghost {
    display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer;
    background: rgba(0, 0, 0, 0.55); border: 1px solid var(--rule); padding: 7px 11px; font-size: 11.5px;
  }
  .ghost:hover { border-color: var(--ink); }
  .ghost:disabled { color: var(--ink-3); cursor: default; border-color: var(--rule); }

  .short { display: none; }

  /* The app's windows step aside while the camera is with Roman. */
  :global(body.roman-focus .draggable-window) { opacity: 0; visibility: hidden; transition: opacity 0.3s ease, visibility 0s 0.3s; }
  :global(body:not(.roman-focus) .draggable-window) { transition: opacity 0.3s ease; }

  @media (max-width: 900px) {
    .copy { bottom: calc(var(--mobile-nav-footprint, 66px) + 52px); left: 10px; width: calc(100vw - 20px); padding: 10px 12px; }
    h2 { font-size: 16px; }
    .body { font-size: 12px; min-height: 0; }
    .bar {
      left: 10px; right: 10px; transform: none; top: auto; bottom: calc(var(--mobile-nav-footprint, 66px) + 8px);
      overflow-x: auto; scrollbar-width: none; pointer-events: auto;
    }
    .shows button { padding: 7px 9px; }
    .hud .ghost { padding: 7px 9px; }
    .long { display: none; }
    .short { display: inline; }
  }
  @media (max-width: 900px) and (max-height: 760px) {
    .fine { display: none; }
  }
</style>
