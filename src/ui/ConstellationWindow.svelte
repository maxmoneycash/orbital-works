<script lang="ts">
  /**
   * Starlink shell architecture, licensed against observed.
   *
   * The licence column is what the FCC granted. The observed column counts
   * objects in the currently loaded catalogue that actually sit in each shell,
   * matched on inclination and altitude. The gap between the two is the
   * interesting part: shells are rarely filled to their grant, satellites spend
   * months raising orbit before they arrive, and several Gen2 shells were
   * lowered years after being authorised.
   *
   * Load a Starlink source in Data Sources to populate the observed column —
   * with only the default 100 Brightest loaded it will be nearly empty, which is
   * itself correct rather than broken.
   */
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { SHELLS, POPULATION, CONSTELLATION_FACTS } from '../data/constellation';

  let openShell = $state<string | null>(null);

  const census = $derived(uiStore.shellCensus);
  const observedTotal = $derived(Object.values(census).reduce((a, n) => a + n, 0));
  const licensedTotal = $derived(SHELLS.reduce((a, s) => a + (s.licensed || 0), 0));
  const maxCount = $derived(Math.max(1, ...SHELLS.map((s) => Math.max(s.licensed || 0, census[s.id] || 0))));
  const gen1 = $derived(SHELLS.filter((s) => s.gen === 'Gen1'));
  const gen2 = $derived(SHELLS.filter((s) => s.gen === 'Gen2'));

  const fmt = (n: number) => n.toLocaleString();
</script>

{#if uiStore.constellationOpen}
  <DraggableWindow
    title="Constellation"
    id="constellation"
    bind:open={uiStore.constellationOpen}
    focus={uiStore.constellationFocus}
    initialX={560}
    initialY={140}
    noPad
  >
    <div class="cn">
      <div class="pop">
        <div class="pr"><span>Launched</span><b>{fmt(POPULATION.launched)}</b></div>
        <div class="pr"><span>In orbit</span><b>{fmt(POPULATION.inOrbit)}</b></div>
        <div class="pr"><span>In an operational shell</span><b>{fmt(POPULATION.inOperationalShell)}</b></div>
        <div class="pr dim"><span>Failed or decaying</span><b>{fmt(POPULATION.failedOrDecaying)}</b></div>
      </div>
      <p class="asof">Snapshot {POPULATION.asOf} · {POPULATION.source}. These move by one or two a day.</p>

      {#each [['Gen1 — as licensed', gen1], ['Gen2 — partial grant', gen2]] as [heading, list]}
        <div class="sec">{heading}</div>
        {#each list as s}
          <button class="shell" class:on={openShell === s.id} onclick={() => (openShell = openShell === s.id ? null : s.id)}>
            <div class="top">
              <span class="geo">{s.incDeg.toFixed(1)}° · {s.altKm} km</span>
              <span class="counts">
                {#if census[s.id]}<b class="obs">{census[s.id]}</b>{/if}
                <span class="lic">{s.licensed ? fmt(s.licensed) : '—'}</span>
              </span>
            </div>
            <div class="track">
              <div class="licbar" style="width:{((s.licensed || 0) / maxCount) * 100}%"></div>
              <div class="obsbar" style="width:{((census[s.id] || 0) / maxCount) * 100}%"></div>
            </div>
            {#if s.planes}
              <span class="planes">{s.planes} planes × {s.perPlane}</span>
            {/if}
          </button>
          {#if openShell === s.id}
            <p class="note">{s.note}</p>
          {/if}
        {/each}
      {/each}

      <div class="sec">Observed in the loaded catalogue</div>
      {#if observedTotal === 0}
        <p class="note">
          Nothing in the current catalogue matches a Starlink shell. Open Data Sources and load a
          Starlink group to fill this in — the default 100 Brightest contains almost none.
        </p>
      {:else}
        <p class="note">
          {fmt(observedTotal)} of {fmt(uiStore.satCount)} loaded objects sit in a licensed shell, against
          {fmt(licensedTotal)} licensed across Gen1. Matching is on inclination within 1.5° and altitude
          within 30 km, so satellites still raising orbit after launch will not be counted anywhere.
        </p>
      {/if}

      <div class="facts">
        {#each CONSTELLATION_FACTS as [k, v]}
          <div class="fr"><span>{k}</span><b>{v}</b></div>
        {/each}
      </div>
    </div>
  </DraggableWindow>
{/if}

<style>
  .cn { width: 320px; max-height: 70vh; overflow-y: auto; }
  .pop { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border); }
  .pr { padding: 6px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .pr span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .09em; color: var(--text-ghost); }
  .pr b { font-size: 13px; }
  .pr.dim b { color: var(--text-dim); }
  .asof { padding: 6px 8px; font-size: 9px; color: var(--text-ghost); line-height: 1.5; }
  .sec {
    padding: 7px 8px 3px; font-size: 8.5px; text-transform: uppercase;
    letter-spacing: .1em; color: var(--text-ghost); border-top: 1px solid var(--border);
  }
  .shell {
    display: block; width: 100%; background: none; border: none; color: var(--text);
    font: inherit; padding: 4px 8px 6px; cursor: pointer; text-align: left;
  }
  .shell:hover, .shell.on { background: var(--card-bg); }
  .top { display: flex; justify-content: space-between; align-items: baseline; font-size: 10.5px; }
  .geo { color: var(--text-dim); }
  .counts { display: flex; gap: 7px; align-items: baseline; }
  .obs { color: var(--live); font-size: 11px; }
  .lic { color: var(--text-ghost); font-size: 9.5px; }
  .track { position: relative; height: 6px; margin-top: 4px; background: var(--card-bg); border: 1px solid var(--border); }
  .licbar { position: absolute; inset: 0 auto 0 0; background: var(--border); }
  .obsbar { position: absolute; inset: 0 auto 0 0; background: var(--live); }
  .planes { font-size: 8.5px; color: var(--text-ghost); }
  .note { padding: 4px 8px 8px; font-size: 10px; line-height: 1.55; color: var(--text-dim); }
  .facts { border-top: 1px solid var(--border); }
  .fr { display: flex; justify-content: space-between; gap: 8px; padding: 3px 8px; font-size: 9.5px; }
  .fr span { color: var(--text-ghost); }
  .fr b { color: var(--text-dim); font-weight: normal; }
</style>
