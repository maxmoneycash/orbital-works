<script lang="ts">
  /**
   * The orbital census: what is in orbit and where. A sheet on phones, a
   * window on wide screens; the same content either way. Tapping a type or
   * an orbit shows only those objects on the globe; tapping a dot names it.
   */
  import { uiStore } from '../../stores/ui.svelte';
  import MobileSheet from '../shared/MobileSheet.svelte';
  import DraggableWindow from '../shared/DraggableWindow.svelte';
  import { CENSUS_TYPES, FAMILY_OF, FAMILY_COLORS, REGIMES } from '../../scene/census-layer';

  const TYPE_LABEL: Record<(typeof CENSUS_TYPES)[number], string> = {
    'payload': 'Satellites',
    'payload-debris': 'Satellite debris',
    'rocket-body': 'Rocket bodies',
    'rocket-debris': 'Rocket debris',
    'debris': 'Debris, source unclear',
    'unknown': 'Unidentified',
  };
  const DEBRIS = new Set([1, 3, 4]);
  const fmt = new Intl.NumberFormat('en-US');
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0) + '%';

  const s = $derived(uiStore.censusSummary);
  const selType = $derived(uiStore.censusType);
  const selRegime = $derived(uiStore.censusRegime);
  const pick = $derived(uiStore.censusPick);
  /** Counts for each type, within the chosen orbit if there is one. */
  const typeCounts = $derived(s ? s.table.map((row) => (selRegime == null ? row.reduce((a, b) => a + b, 0) : row[selRegime])) : []);
  /** Counts for each orbit, of the chosen type if there is one. */
  const regimeCounts = $derived(s ? REGIMES.map((_, j) => (selType == null ? s.table.reduce((a, row) => a + row[j], 0) : s.table[selType][j])) : []);
  const shown = $derived(typeCounts.reduce((a, b) => a + b, 0));
  const typeMax = $derived(Math.max(1, ...typeCounts));
  const regimeMax = $derived(Math.max(1, ...regimeCounts));
  const debrisTotal = $derived(s ? s.table.reduce((a, row, i) => a + (DEBRIS.has(i) ? row.reduce((x, y) => x + y, 0) : 0), 0) : 0);
  const asOf = $derived(s ? new Date(s.generatedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

  function toggleType(i: number) { uiStore.censusType = uiStore.censusType === i ? null : i; uiStore.censusPick = null; }
  function toggleRegime(j: number) { uiStore.censusRegime = uiStore.censusRegime === j ? null : j; uiStore.censusPick = null; }
  function clearAll() { uiStore.censusType = null; uiStore.censusRegime = null; uiStore.censusPick = null; }
  const km = (n: number) => fmt.format(n) + ' km';
</script>

{#snippet body()}
  <div class="census" class:mobile={uiStore.isMobile}>
    {#if uiStore.censusState === 'loading' || uiStore.censusState === 'idle'}
      <p class="state"><i class="breathe" aria-hidden="true"></i>Loading the catalogue</p>
    {:else if uiStore.censusState === 'failed'}
      <div class="state failed">
        <p>The catalogue didn’t load. Check the connection, then try again.</p>
        <button type="button" class="action" onclick={() => uiStore.onRetryCensus?.()}>Try again</button>
      </div>
    {:else if s}
      {#if pick}
        <section class="pick" aria-live="polite">
          <div class="pick-head">
            <span class="swatch" class:debris={DEBRIS.has(CENSUS_TYPES.indexOf(pick.type))} style="--c: {FAMILY_COLORS[FAMILY_OF[CENSUS_TYPES.indexOf(pick.type)]]}"></span>
            <h3>{pick.name}</h3>
            <button type="button" class="x" aria-label="Close {pick.name}" onclick={() => (uiStore.censusPick = null)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </div>
          <p class="what">{TYPE_LABEL[pick.type]}{pick.type === 'payload' ? (pick.working ? ', working' : ', no longer working') : ''} · {REGIMES[pick.regime].name}</p>
          <dl>
            <dt>Height</dt><dd>{pick.perigeeKm === pick.apogeeKm ? km(pick.perigeeKm) : `${km(pick.perigeeKm)} to ${km(pick.apogeeKm)}`}</dd>
            <dt>Tilt</dt><dd>{pick.inclinationDeg.toFixed(1)}° to the equator</dd>
            {#if pick.launchYear}<dt>Launched</dt><dd>{pick.launchYear}</dd>{/if}
            <dt>Catalogue</dt><dd>NORAD {pick.norad}</dd>
          </dl>
        </section>
      {:else}
        <header class="sum">
          <p class="big"><b>{fmt.format(selType == null && selRegime == null ? s.total : shown)}</b> {selType == null && selRegime == null ? 'objects in orbit' : 'shown'}</p>
          {#if selType == null && selRegime == null}
            <p class="sub">{fmt.format(s.working)} are working satellites; {fmt.format(debrisTotal)} are pieces of debris.</p>
          {:else}
            <p class="sub">
              {selType != null ? TYPE_LABEL[CENSUS_TYPES[selType]] : 'Everything'}{selRegime != null ? ` in ${REGIMES[selRegime].name.toLowerCase()}` : ''}, of {fmt.format(s.total)}.
              <button type="button" class="link" onclick={clearAll}>Show all</button>
            </p>
          {/if}
        </header>
      {/if}

      <h4>What</h4>
      <ul class="rows">
        {#each CENSUS_TYPES as t, i (t)}
          <li>
            <button type="button" class="row" class:on={selType === i} class:off={selType != null && selType !== i} aria-pressed={selType === i} onclick={() => toggleType(i)}>
              <span class="swatch" class:debris={DEBRIS.has(i)} style="--c: {FAMILY_COLORS[FAMILY_OF[i]]}"></span>
              <span class="label">{TYPE_LABEL[t]}</span>
              <span class="n">{fmt.format(typeCounts[i])}</span>
              <span class="bar" aria-hidden="true"><b style="width: {(typeCounts[i] / typeMax) * 100}%; --c: {FAMILY_COLORS[FAMILY_OF[i]]}"></b></span>
            </button>
          </li>
        {/each}
      </ul>

      <h4>Where</h4>
      <ul class="rows">
        {#each REGIMES as r, j (r.id)}
          <li>
            <button type="button" class="row two" class:on={selRegime === j} class:off={selRegime != null && selRegime !== j} aria-pressed={selRegime === j} onclick={() => toggleRegime(j)}>
              <span class="label">{r.name}<small>{r.range}</small></span>
              <span class="n">{fmt.format(regimeCounts[j])}<small>{pct(regimeCounts[j], selType == null ? s.total : typeCounts[selType])}</small></span>
              <span class="bar" aria-hidden="true"><b style="width: {(regimeCounts[j] / regimeMax) * 100}%"></b></span>
            </button>
          </li>
        {/each}
      </ul>

      <p class="note">
        CelesTrak catalogue, {asOf}. Each dot flies its catalogued height and tilt; where it sits along that orbit isn’t catalogued, so that part is illustrative. {uiStore.isMobile ? 'Tap' : 'Click'} a dot to name it.
      </p>
    {/if}
  </div>
{/snippet}

{#if uiStore.isMobile}
  <MobileSheet id="census" title="Orbital census">
    {@render body()}
  </MobileSheet>
{:else if uiStore.censusOpen}
  <DraggableWindow title="Orbital census" id="census" bind:open={uiStore.censusOpen} initialX={Math.max(16, window.innerWidth - 380)} initialY={96} noPad>
    {@render body()}
  </DraggableWindow>
{/if}

<style>
  .census { width: 340px; max-height: min(72vh, 640px); overflow-y: auto; font-size: 12px; color: var(--text); }
  .census.mobile { width: auto; max-height: none; overflow: visible; font-size: 14px; }

  .state { display: flex; align-items: center; gap: 10px; margin: 0; padding: 14px 12px; color: var(--text-dim); }
  .state.failed { display: grid; gap: 10px; }
  .state p { margin: 0; }
  .breathe { width: 6px; height: 6px; border-radius: 50%; background: var(--live); animation: breathe 1.2s ease-in-out infinite alternate; }
  @keyframes breathe { from { opacity: 1; } to { opacity: 0.25; } }
  .action { justify-self: start; min-height: 36px; padding: 0 14px; font: inherit; color: var(--text); background: none; border: 1px solid var(--border); cursor: pointer; }
  .mobile .action { min-height: 44px; }
  .action:hover { border-color: var(--live); }

  .sum { padding: 10px 12px 4px; }
  .mobile .sum { padding: 2px 0 4px; }
  .big { margin: 0; font-size: 13px; color: var(--text-dim); }
  .big b { font-size: 20px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .mobile .big b { font-size: 24px; }
  .sub { margin: 4px 0 0; color: var(--text-dim); line-height: 1.45; }
  .link { font: inherit; color: var(--live); background: none; border: none; padding: 0 0 0 4px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }

  h4 { margin: 10px 12px 2px; font-size: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-ghost); }
  .mobile h4 { margin: 12px 0 2px; font-size: 11px; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row {
    width: 100%; display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; grid-template-rows: auto 4px; column-gap: 8px; row-gap: 5px;
    align-items: center; padding: 6px 12px; min-height: 36px; font: inherit; color: inherit; text-align: left;
    background: none; border: none; cursor: pointer;
  }
  .mobile .row { padding: 8px 0; min-height: 48px; }
  .row.two { grid-template-columns: minmax(0, 1fr) auto; }
  .row:hover, .row.on { background: var(--card-bg); }
  .mobile .row:hover { background: none; }
  .mobile .row.on { background: none; }
  .row.off { opacity: 0.5; }
  .row:focus-visible { outline: 1px solid var(--live); outline-offset: -1px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.two .label { white-space: normal; }
  .label small, .n small { display: block; font-size: 10.5px; color: var(--text-ghost); }
  .mobile .label small, .mobile .n small { font-size: 12px; }
  .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--text); }
  .row.on .label { color: var(--text); }
  .bar { grid-column: 1 / -1; height: 3px; background: color-mix(in srgb, var(--border) 60%, transparent); }
  .row:not(.two) .bar { grid-column: 2 / -1; }
  .bar b { display: block; height: 100%; background: var(--c, var(--text-dim)); }
  .row.on .bar b { background: var(--c, var(--live)); }
  .swatch { width: 10px; height: 10px; border-radius: 50%; background: var(--c); justify-self: center; }
  .swatch.debris { width: 6px; height: 6px; opacity: 0.75; }

  .pick { padding: 10px 12px 6px; border-bottom: 1px solid var(--border); }
  .mobile .pick { padding: 2px 0 10px; }
  .pick-head { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .pick h3 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .mobile .pick h3 { font-size: 17px; }
  .x { width: 32px; height: 32px; display: grid; place-items: center; background: none; border: none; color: var(--text-dim); cursor: pointer; margin: -6px -8px -6px 0; }
  .mobile .x { width: 44px; height: 44px; margin: -12px -12px -12px 0; }
  .x svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .x:hover { color: var(--text); }
  .what { margin: 4px 0 8px 20px; color: var(--text-dim); }
  .pick dl { margin: 0 0 0 20px; display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-variant-numeric: tabular-nums; }
  .pick dt { color: var(--text-ghost); }
  .pick dd { margin: 0; }

  .note { margin: 10px 12px 12px; font-size: 10.5px; line-height: 1.55; color: var(--text-ghost); }
  .mobile .note { margin: 12px 0 4px; font-size: 12px; }
  @media (prefers-reduced-motion: reduce) { .breathe { animation: none; } }
</style>
