<script lang="ts">
  /**
   * The Roman story's page: an empty scroll over the 3D scene. Scrolling moves
   * the camera and everything on the model (roman-story.ts reads the position
   * from uiStore.romanStoryT); the words for each part of the way fade in and
   * out with it. Dragging turns the camera a little, then lets it settle back.
   * Past the end, the page hands over to the tracker.
   */
  import { uiStore } from '../../stores/ui.svelte';
  import { CHAPTERS, STORY_LENGTH, type ChapterId } from '../../scene/roman-story';
  import { DEPLOYMENTS, LAUNCH } from '../../roman/chapters';

  let scroller = $state<HTMLDivElement | null>(null);
  let t = $state(0);
  let raw = 0;
  let raf = 0;
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const v = $derived(uiStore.romanView);
  const km = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
  const day = $derived(Math.max(0, Math.floor((Date.now() - LAUNCH) / 86_400_000)));
  const moonDate = $derived(v?.moonCrossing ? new Date(v.moonCrossing).toLocaleDateString('en-US', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : null);

  /** Opacity of a chapter's words at `t`: in over the first 0.28 screens, out over the last 0.28. */
  function alpha(id: ChapterId) {
    const [a, b] = CHAPTERS[id];
    const k = 0.28;
    const first = id === 'hero';
    const i = first ? 1 : Math.min(1, Math.max(0, (t - a) / k));
    const o = Math.min(1, Math.max(0, (b - t) / k));
    return Math.min(i, o);
  }
  const shift = (id: ChapterId) => (1 - alpha(id)) * (t < CHAPTERS[id][0] + 0.3 ? 14 : -14);

  // The light, stop by stop, in the order it travels; which one it has
  // reached comes from the story, so the words match the 3D exactly.
  const STOPS: [string, string][] = [
    ['Aperture', 'Starlight comes in at the aperture, shaded by the visor.'],
    ['Primary mirror', 'The 2.4 m primary gathers it and sends it up to the secondary.'],
    ['Secondary mirror', 'The 581 mm secondary sends it back down the axis.'],
    ['Through the primary', 'Down a baffle through the primary’s centre.'],
    ['Fold mirror 1', 'Fold mirror 1, tipped and focused by actuators, turns it aside.'],
    ['Intermediate focus', 'Between the folds it comes to a first focus.'],
    ['Fold mirror 2', 'Fold mirror 2 turns it again.'],
    ['Tertiary mirror', 'The concave tertiary forms the image.'],
    ['Element wheel', 'It crosses one of the wheel’s slots: a filter, the grism or the prism.'],
    ['Focal plane', 'And lands on the detectors.'],
  ];
  const stop = $derived(STOPS[Math.max(0, Math.min(STOPS.length - 1, uiStore.romanStoryStop))]);
  const step = $derived(t < 4.8 ? 0 : t < 5.45 ? 1 : t < 5.9 ? 2 : 3);

  function tick(now: number, last: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    // Eased, so a wheel's steps become one continuous move.
    t = reduce ? raw : t + (raw - t) * (1 - Math.exp(-7 * dt));
    uiStore.romanStoryT = t;
    if (raw >= STORY_LENGTH - 0.02 && t >= STORY_LENGTH - 0.12) { uiStore.onExitStory?.('end'); return; }
    raf = requestAnimationFrame((n) => tick(n, now));
  }

  function onScroll() {
    if (scroller) raw = scroller.scrollTop / Math.max(1, scroller.clientHeight);
  }

  $effect(() => {
    if (!uiStore.romanStoryActive || !scroller) return;
    // Start where the app asked (the top, or the observatory from its label).
    // (Nothing here may read `t`: this effect would re-run on every frame.)
    const t0 = uiStore.romanStoryStart;
    scroller.scrollTop = t0 * scroller.clientHeight;
    raw = t0;
    t = t0;
    uiStore.romanStoryT = t0;
    document.body.classList.add('roman-story-on');
    const start = performance.now();
    raf = requestAnimationFrame((n) => tick(n, start));
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') uiStore.onExitStory?.('skip'); };
    addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', key);
      document.body.classList.remove('roman-story-on');
    };
  });

  // Drag to look around: horizontal and vertical on a mouse, sideways on touch
  // (vertical touch is the page's own scroll).
  let drag: { x: number; y: number; id: number; touch: boolean } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse' };
    uiStore.onStoryDrag?.(0, 0, true);
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = drag.touch ? 0 : e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    uiStore.onStoryDrag?.(dx, dy, true);
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    uiStore.onStoryDrag?.(0, 0, false);
  }
</script>

{#if uiStore.romanStoryActive}
  <div
    class="roman-story"
    bind:this={scroller}
    onscroll={onScroll}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="region"
    aria-label="Nancy Grace Roman Space Telescope, a scrolling story"
  >
    <div class="track" style="height: {(STORY_LENGTH + 1) * 100}svh"></div>

    <div class="words">
      <section class="ch hero" style="opacity: {alpha('hero')}; translate: 0 {shift('hero')}px">
        <h1>Nancy Grace Roman<br />Space Telescope</h1>
        <p>Launched 30 August 2026. Today, day {day}, it is <b>{km(v?.distKm)} km</b> from Earth, on its way to its orbit around L2.</p>
        <p class="cue"><i></i>Scroll</p>
      </section>

      <section class="ch" style="opacity: {alpha('out')}; translate: 0 {shift('out')}px">
        <h2>{day} days out</h2>
        <p>{#if moonDate}It passed the Moon’s distance on {moonDate}.{' '}{/if}Ahead, 1.5 million km from Earth, JWST and Euclid already circle Sun–Earth L2.</p>
      </section>

      <section class="ch" style="opacity: {alpha('arrive')}; translate: 0 {shift('arrive')}px">
        <h2>The observatory</h2>
        <p>A 2.4 m mirror, the size of Hubble’s, feeding a camera that sees about 100 times as much sky at once as Hubble’s infrared camera.</p>
      </section>

      <section class="ch" style="opacity: {alpha('unfold')}; translate: 0 {shift('unfold')}px">
        <h2>Folded for launch</h2>
        <p>It rode a Falcon Heavy folded up, and opened in space in three moves.</p>
        <ol class="steps">
          {#each DEPLOYMENTS as d, i (d.key)}
            <li class:on={i === step} class:done={i < step}><span>{d.when}</span>{d.what}</li>
          {/each}
        </ol>
      </section>

      <section class="ch" style="opacity: {alpha('sun')}; translate: 0 {shift('sun')}px">
        <h2>One side to the Sun</h2>
        <p>Six solar panels make about 4 kW and double as its sun shield. Behind them the telescope stays in shade, and cold.</p>
      </section>

      <section class="ch" style="opacity: {alpha('light')}; translate: 0 {shift('light')}px">
        <h2>Follow the light</h2>
        <p class="now"><b>{stop[0]}</b>{stop[1]}</p>
        <div class="ticks" aria-hidden="true">
          {#each STOPS as s, i (s[0])}<i class:done={i <= uiStore.romanStoryStop && t >= 7.95}></i>{/each}
        </div>
      </section>

      <section class="ch" style="opacity: {alpha('image')}; translate: 0 {shift('image')}px">
        <h2>300 million pixels</h2>
        <p>Eighteen detectors, 4,096 pixels square, cooled to about −178 °C. The picture builds up photon by photon.</p>
        <p class="fine">A simulated field: science begins after commissioning.</p>
      </section>

      <section class="ch" style="opacity: {alpha('home')}; translate: 0 {shift('home')}px">
        <h2>Sending it home</h2>
        <p>The 1.7 m dish tracks Earth and sends up to 500 Mb/s over Ka-band, about 1.4 TB a day. {v?.station ? `Right now ${v.station} has it in view.` : 'No station has it in view right now.'}</p>
      </section>

      <section class="ch" style="opacity: {alpha('apart')}; translate: 0 {shift('apart')}px">
        <h2>Every part</h2>
        <p>The telescope, its two instruments, and the spacecraft that carries them.</p>
      </section>

      <section class="ch" style="opacity: {alpha('end')}; translate: 0 {shift('end')}px">
        <h2>Day {day}</h2>
        <p><b>{km(v?.distKm)} km</b> from Earth{#if v?.l2Km != null}, {km(v.l2Km)} km from L2{/if}. Keep scrolling for the tracker.</p>
        <p class="fine">Drawn about 60,000 times life size. Positions from JPL Horizons.</p>
      </section>
    </div>

    <div class="rail" aria-hidden="true"><i style="transform: scaleY({Math.min(1, t / STORY_LENGTH)})"></i></div>
    <button class="skip" onclick={() => uiStore.onExitStory?.('skip')}>Skip to the tracker</button>
  </div>
{/if}

<style>
  .roman-story {
    --ink: #f2f1ec;
    --ink-2: rgba(242, 241, 236, 0.74);
    --ink-3: rgba(242, 241, 236, 0.48);
    position: fixed; inset: 0; z-index: 50;
    overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
    scrollbar-width: none; touch-action: pan-y;
    font-family: 'Overpass Mono', ui-monospace, monospace; color: var(--ink);
    cursor: grab;
  }
  .roman-story::-webkit-scrollbar { display: none; }
  .roman-story:active { cursor: grabbing; }
  .track { width: 1px; }

  .words { position: fixed; inset: 0; pointer-events: none; }
  .ch {
    position: absolute; left: clamp(20px, 6vw, 96px); top: 50%; transform: translateY(-50%);
    width: min(440px, calc(100vw - 40px));
    text-shadow: 0 1px 18px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8);
  }
  h1 { margin: 0 0 18px; font-size: clamp(30px, 4vw, 46px); line-height: 1.04; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 0 0 12px; font-size: clamp(24px, 2.8vw, 34px); line-height: 1.08; font-weight: 600; letter-spacing: -0.015em; }
  p { margin: 0 0 10px; font-size: 15px; line-height: 1.6; color: var(--ink-2); }
  p b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .fine { font-size: 11px; color: var(--ink-3); }
  .cue { margin-top: 26px; display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--ink-3); letter-spacing: 0.06em; }
  .cue i { width: 1px; height: 26px; background: linear-gradient(var(--live), transparent); animation: cue 2.2s ease-in-out infinite; }
  @keyframes cue { 0% { transform: scaleY(0); transform-origin: top; } 50% { transform: scaleY(1); transform-origin: top; } 51% { transform-origin: bottom; } 100% { transform: scaleY(0); transform-origin: bottom; } }

  .steps { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
  .steps li { font-size: 13px; line-height: 1.5; color: var(--ink-3); padding-left: 14px; border-left: 1px solid rgba(242, 241, 236, 0.16); transition: color 0.3s, border-color 0.3s; }
  .steps li span { display: block; font-size: 11px; color: inherit; font-variant-numeric: tabular-nums; }
  .steps li.done { color: var(--ink-2); }
  .steps li.on { color: var(--ink); border-left-color: var(--live); }
  .steps li.on span { color: var(--live); }

  .now { min-height: 4.8em; }
  .now b { display: block; color: var(--live); font-weight: 600; margin-bottom: 2px; }
  .ticks { display: flex; gap: 4px; margin-top: 6px; }
  .ticks i { width: 18px; height: 2px; background: rgba(242, 241, 236, 0.18); transition: background 0.2s; }
  .ticks i.done { background: var(--live); }

  .rail { position: fixed; right: 22px; top: 50%; height: 34vh; width: 1px; transform: translateY(-50%); background: rgba(242, 241, 236, 0.16); pointer-events: none; }
  .rail i { position: absolute; inset: 0; background: var(--live); transform-origin: top; }

  .skip {
    position: fixed; right: 18px; top: 14px; z-index: 2;
    font: inherit; font-size: 11px; color: var(--ink-3); background: none; border: none; padding: 6px 4px; cursor: pointer;
    letter-spacing: 0.02em;
  }
  .skip:hover { color: var(--ink); }
  .skip:focus-visible { outline: 1px solid var(--live); outline-offset: 2px; }

  /* The tracker steps aside while the story plays. */
  :global(body.roman-story-on #ui-overlay > *:not(.roman-story)) { visibility: hidden !important; }

  /* Names on the model (drawn by roman-orbit.ts). */
  :global(.roman-tag) {
    position: absolute; left: 0; top: 0; white-space: nowrap; pointer-events: none;
    font: 500 11.5px/18px 'Overpass Mono', ui-monospace, monospace; color: rgba(242, 241, 236, 0.92);
    letter-spacing: 0.01em; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.95), 0 0 2px #000;
    transition: opacity 0.15s linear;
  }
  :global(.roman-tag.strong) { color: var(--live, #44ff44); }
  :global(.roman-tag-dot) {
    position: absolute; left: 0; top: 0; width: 5px; height: 5px; border-radius: 50%; pointer-events: none;
    background: #f2f1ec; box-shadow: 0 0 0 3px rgba(242, 241, 236, 0.14), 0 0 8px rgba(0, 0, 0, 0.8);
  }

  @media (max-width: 760px) {
    /* The words sit low over the scene: a scrim keeps them readable over anything. */
    .words::before {
      content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 58svh;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.88), rgba(0, 0, 0, 0.55) 48%, rgba(0, 0, 0, 0));
    }
    .ch { top: auto; bottom: 36px; transform: none; left: 20px; width: calc(100vw - 40px); }
    .hero { bottom: 14vh; }
    h1 { font-size: 30px; }
    h2 { font-size: 24px; }
    p { font-size: 14px; }
    .steps li { font-size: 12px; }
    .rail { right: 10px; height: 22vh; top: 30%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cue i { animation: none; }
  }
</style>
