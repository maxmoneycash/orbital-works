<script lang="ts">
  import { onMount } from 'svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { sourcesStore } from '../stores/sources.svelte';
  import { ICON_SEARCH, ICON_COMMAND, ICON_SELECTION, ICON_VIEW, ICON_TIME, ICON_SETTINGS, ICON_OBSERVER, ICON_HELP, ICON_2D, ICON_3D, ICON_SKY, ICON_PASSES, ICON_DATA_SOURCES, ICON_DATABASE, ICON_RADAR, ICON_FEEDBACK, ICON_DESIGNER, ICON_ARRAY, ICON_WAVEFORM, ICON_SHELLS } from './shared/icons';
  import { observerStore } from '../stores/observer.svelte';
  import { ViewMode } from '../types';

  let canvasEl: HTMLCanvasElement | undefined = $state();

  onMount(() => { uiStore.planetCanvasEl = canvasEl; });

  let sourceLabel = $derived.by(() => {
    const n = sourcesStore.enabledSources.length;
    if (n === 0) return 'No sources';
    if (n === 1) return sourcesStore.enabledSources[0].name;
    return `${n} sources`;
  });
</script>

<div class="toolbar">
  <button class="planet-btn" title="Solar System Explorer" onclick={() => uiStore.onPlanetButtonClick?.()}>
    <canvas bind:this={canvasEl} width="56" height="56"></canvas>
  </button>

  <div class="toolbar-row">
    <!-- Data sources -->
    <div class="btn-group">
      <button class="source-btn" class:active={uiStore.dataSourcesOpen} title="Data Sources (D)" onclick={() => uiStore.dataSourcesOpen = !uiStore.dataSourcesOpen}>
        <span class="source-icon">{@html ICON_DATA_SOURCES}</span>
        <span class="source-label" class:no-sources={sourcesStore.enabledSources.length === 0}>{sourceLabel}</span>
      </button>
    </div>

    <div class="separator"></div>

    <!-- Search group -->
    <div class="btn-group">
      <button class="icon-btn" title="Search Satellite (Ctrl+F)" onclick={() => { uiStore.commandPaletteSatMode = true; uiStore.commandPaletteOpen = true; }}>
        {@html ICON_SEARCH}
      </button>
      <button class="icon-btn" title="Command Palette (Ctrl+K)" onclick={() => uiStore.commandPaletteOpen = true}>
        {@html ICON_COMMAND}
      </button>
    </div>

    <div class="separator"></div>

    <!-- View toggle -->
    <div class="btn-group">
      <button class="icon-btn" title="Toggle 2D / 3D (M)" disabled={uiStore.orreryMode || uiStore.viewMode === ViewMode.VIEW_SKY} onclick={() => uiStore.onToggleViewMode?.()}>
        {@html uiStore.viewMode === ViewMode.VIEW_3D ? ICON_2D : ICON_3D}
      </button>
      <button class="icon-btn" title="Sky View (S)" class:active={uiStore.viewMode === ViewMode.VIEW_SKY} disabled={!observerStore.isSet || uiStore.orreryMode} onclick={() => uiStore.onToggleSkyView?.()}>
        {@html ICON_SKY}
      </button>
    </div>

    <div class="separator"></div>

    <!-- Windows group -->
    <div class="btn-group">
      <button class="icon-btn" class:active={uiStore.satDatabaseOpen} title="SatNOGS Database" onclick={() => uiStore.satDatabaseOpen = !uiStore.satDatabaseOpen}>
        {@html ICON_DATABASE}
      </button>
      <button class="icon-btn" class:active={uiStore.designerOpen} title="Designer" onclick={() => uiStore.designerOpen = !uiStore.designerOpen}>
        {@html ICON_DESIGNER}
      </button>
      <button class="icon-btn" class:active={uiStore.constellationOpen} title="Constellation" onclick={() => uiStore.constellationOpen = !uiStore.constellationOpen}>
        {@html ICON_SHELLS}
      </button>
      <button class="icon-btn" class:active={uiStore.phasedArrayOpen} title="Phased Array" onclick={() => uiStore.phasedArrayOpen = !uiStore.phasedArrayOpen}>
        {@html ICON_ARRAY}
      </button>
      <button class="icon-btn" class:active={uiStore.waveformOpen} title="Waveform" onclick={() => uiStore.waveformOpen = !uiStore.waveformOpen}>
        {@html ICON_WAVEFORM}
      </button>
      <button class="icon-btn" class:active={uiStore.selectionWindowOpen} title="Selection" onclick={() => uiStore.selectionWindowOpen = !uiStore.selectionWindowOpen}>
        {@html ICON_SELECTION}
      </button>
      <button class="icon-btn" class:active={uiStore.passesWindowOpen} title="Passes (P)" onclick={() => uiStore.passesWindowOpen = !uiStore.passesWindowOpen}>
        {@html ICON_PASSES}
      </button>
      <button class="icon-btn" class:active={uiStore.rotatorOpen} title="Rotator (R)" onclick={() => uiStore.rotatorOpen = !uiStore.rotatorOpen}>
        {@html ICON_RADAR}
      </button>
      <button class="icon-btn" class:active={uiStore.viewWindowOpen} title="View" onclick={() => uiStore.viewWindowOpen = !uiStore.viewWindowOpen}>
        {@html ICON_VIEW}
      </button>
      <button class="icon-btn" class:active={uiStore.timeWindowOpen} title="Time Control" onclick={() => uiStore.timeWindowOpen = !uiStore.timeWindowOpen}>
        {@html ICON_TIME}
      </button>
      <button class="icon-btn" class:active={uiStore.observerWindowOpen} title="Observer (O)" onclick={() => uiStore.observerWindowOpen = !uiStore.observerWindowOpen}>
        {@html ICON_OBSERVER}
      </button>
      <button class="icon-btn" class:active={uiStore.feedbackWindowOpen} title="Feedback (F)" onclick={() => uiStore.feedbackWindowOpen = !uiStore.feedbackWindowOpen}>
        {@html ICON_FEEDBACK}
      </button>
      <button class="icon-btn" class:active={uiStore.settingsOpen} title="Settings" onclick={() => uiStore.settingsOpen = !uiStore.settingsOpen}>
        {@html ICON_SETTINGS}
      </button>
      <button class="icon-btn" title="Help" onclick={() => uiStore.infoModalOpen = true}>
        {@html ICON_HELP}
      </button>
    </div>
  </div>
</div>

<style>
  .toolbar {
    position: absolute;
    bottom: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    background: color-mix(in srgb, var(--ui-bg) 72%, transparent);
    -webkit-backdrop-filter: blur(16px) saturate(1.5);
    backdrop-filter: blur(16px) saturate(1.5);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  }
  /* Same fallback as the mobile nav — a translucent bar with no blur behind it
     is unreadable over the globe. */
  @supports not (backdrop-filter: blur(4px)) {
    .toolbar-row { background: var(--ui-bg); }
  }
  .btn-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .separator {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 3px;
  }

  .icon-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 9px;
    color: var(--text-faint);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 27px;
    height: 27px;
    padding: 0;
    cursor: pointer;
    position: relative;
    transition: color .16s ease, background-color .16s ease;
  }
  @media (prefers-reduced-motion: reduce) { .icon-btn { transition: none; } }
  .icon-btn:hover { color: var(--text-dim); background: color-mix(in srgb, var(--text) 8%, transparent); }
  /* Seated pill rather than a 2px underline tick — same active treatment as the
     mobile nav, and it stays legible against a moving globe behind the blur. */
  .icon-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .icon-btn:disabled { color: var(--text-ghost); cursor: default; opacity: 0.4; }
  .icon-btn:disabled:hover { color: var(--text-ghost); background: none; }
  .icon-btn :global(svg) { width: 13px; height: 13px; }

  .source-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 9px;
    color: var(--text-faint);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 27px;
    padding: 0 9px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    position: relative;
  }
  .source-btn:hover { color: var(--text-dim); background: color-mix(in srgb, var(--text) 8%, transparent); }
  .source-btn.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .source-icon { display: flex; align-items: center; }
  .source-icon :global(svg) { width: 13px; height: 13px; }
  .source-label { white-space: nowrap; margin-top: 2px; }
  .source-label.no-sources { color: var(--danger); }

  .planet-btn {
    background: none;
    border: none;
    width: 36px;
    height: 36px;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: flex-end;
    margin-right: 6px;
    margin-bottom: 14px;
  }
  .planet-btn canvas {
    width: 36px;
    height: 36px;
    transition: filter 0.15s;
    display: block;
  }
  .planet-btn:hover canvas { filter: brightness(1.4); }

  @media (max-width: 600px) {
    .source-label { display: none; }
  }
</style>
