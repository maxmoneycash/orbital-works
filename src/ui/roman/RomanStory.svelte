<script lang="ts">
  /**
   * The Roman story's page: a scroll over the 3D scene. Scrolling moves the
   * camera and everything on the model (roman-story.ts reads the position
   * from uiStore.romanStoryT); the words for each part of the way fade in and
   * out with it. Dragging sideways turns the camera a little, then lets it
   * settle back. Past the end, the page hands over to the tracker.
   *
   * The document itself scrolls, not a box inside it: a tall empty track is
   * added to <body> while the canvas and the UI stay fixed. That keeps the
   * platform's own scrolling — momentum, the keyboard (Space, Page Down,
   * arrows), a phone toolbar that slides away, a tap on the status bar to go
   * back to the top — and nothing here ever intercepts it.
   */
  import { uiStore } from '../../stores/ui.svelte';
  import { CHAPTERS, HOLD, STORY_LENGTH, RomanStory, type ChapterId } from '../../scene/roman-story';
  import { DEPLOYMENTS, LAUNCH } from '../../roman/chapters';

  let root = $state<HTMLDivElement | null>(null);
  const sections: Partial<Record<ChapterId, HTMLElement>> = {};
  let t = $state(0);
  let raw = 0;
  let raf = 0;
  /** One screen of scroll, in px: the large viewport, so a phone's sliding toolbar does not move the story. */
  let unit = 1;

  const motionQuery = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = $state(!!motionQuery?.matches);

  const v = $derived(uiStore.romanView);
  const km = (n: number) => Math.round(n).toLocaleString('en-US');
  const day = $derived(Math.max(0, Math.floor((Date.now() - LAUNCH) / 86_400_000)));
  const moonDate = $derived(v?.moonCrossing ? new Date(v.moonCrossing).toLocaleDateString('en-US', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : null);
  const chapter = $derived(RomanStory.chapter(t));
  const ORDER = Object.keys(CHAPTERS) as ChapterId[];

  /** Opacity of a chapter's words at `t`: in over the first 0.28 screens, out over the last 0.28. */
  function alpha(id: ChapterId) {
    const [a, b] = CHAPTERS[id];
    const k = 0.28;
    const i = id === 'hero' ? 1 : Math.min(1, Math.max(0, (t - a) / k));
    const o = Math.min(1, Math.max(0, (b - t) / k));
    return Math.min(i, o);
  }
  /** The words drift as they fade; with reduced motion they only fade. */
  const shift = (id: ChapterId) => (reduce ? 0 : (1 - alpha(id)) * (t < CHAPTERS[id][0] + 0.3 ? 14 : -14));
  const fill = (id: ChapterId) => { const [a, b] = CHAPTERS[id]; return Math.min(1, Math.max(0, (t - a) / (b - a))); };

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
  /** Past the Earth chapters the story needs the model; say so while it is on its way, or if it failed. */
  const modelNote = $derived(t >= CHAPTERS.arrive[0] - 0.2 && t < CHAPTERS.end[1] ? uiStore.romanModel : 'ready');

  let endSince = 0;
  function tick(now: number, last: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    // Eased, so a wheel's steps become one continuous move.
    t = reduce ? raw : t + (raw - t) * (1 - Math.exp(-7 * dt));
    uiStore.romanStoryT = t;
    // Hand over only once the reader has stayed at the end a moment: a
    // flick that runs past it does not throw them out mid-thought.
    if (raw >= STORY_LENGTH - 0.02) {
      endSince ||= now;
      if (now - endSince > 380 && t >= STORY_LENGTH - 0.12) { uiStore.onExitStory?.('end'); return; }
    } else endSince = 0;
    raf = requestAnimationFrame((n) => tick(n, now));
  }

  function measureUnit(probe: HTMLElement) {
    unit = probe.offsetHeight || window.innerHeight || 1;
  }

  /** Stories opened after the first one came from the tracker: Back returns there. */
  let opened = 0;

  $effect(() => {
    if (!uiStore.romanStoryActive || !root) return;
    const html = document.documentElement;
    // Start where the app asked (the top, or the observatory from its label).
    // (Nothing here may read `t`: this effect would re-run on every frame.)
    const t0 = uiStore.romanStoryStart;

    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100vh;height:100lvh;visibility:hidden;pointer-events:none';
    const track = document.createElement('div');
    track.className = 'roman-story-track';
    track.setAttribute('aria-hidden', 'true');
    track.style.height = `${(STORY_LENGTH + 1) * 100}vh`;
    track.style.height = `${(STORY_LENGTH + 1) * 100}lvh`;
    document.body.append(probe, track);
    measureUnit(probe);
    html.classList.add('roman-story-on');
    const restore = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.scrollTo(0, t0 * unit);
    raw = t0; t = t0;
    uiStore.romanStoryT = t0;

    // The browser's own bar goes black with the page.
    const meta = document.querySelector('meta[name="theme-color"]');
    const themeColor = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', '#000000');

    const onScroll = () => { raw = window.scrollY / unit; };
    // A turned phone changes the screen: keep the reader where they were.
    const onResize = () => {
      const was = raw;
      measureUnit(probe);
      window.scrollTo(0, was * unit);
      raw = was;
      measureAvoid();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') uiStore.onExitStory?.('skip'); };
    const pushed = opened++ > 0;
    let popped = false;
    if (pushed) history.pushState({ romanStory: true }, '');
    const onPop = () => { popped = true; uiStore.onExitStory?.('skip'); };
    const onMotion = () => { reduce = !!motionQuery?.matches; };

    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    addEventListener('keydown', key);
    addEventListener('popstate', onPop);
    motionQuery?.addEventListener('change', onMotion);
    const start = performance.now();
    raf = requestAnimationFrame((n) => tick(n, start));
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onResize);
      removeEventListener('keydown', key);
      removeEventListener('popstate', onPop);
      motionQuery?.removeEventListener('change', onMotion);
      window.scrollTo(0, 0);
      track.remove();
      probe.remove();
      html.classList.remove('roman-story-on');
      history.scrollRestoration = restore;
      if (themeColor != null) meta?.setAttribute('content', themeColor);
      uiStore.romanStoryAvoid = null;
      uiStore.romanStoryCamT = null;
      if (pushed && !popped && history.state?.romanStory) history.back();
    };
  });

  // The words' box and the skip control, so names on the model keep out of
  // them. Measured when the chapter changes (and on resize), not every frame.
  let skipEl = $state<HTMLButtonElement | null>(null);
  function measureAvoid() {
    const el = sections[chapter];
    if (!el || !uiStore.romanStoryActive) { uiStore.romanStoryAvoid = null; return; }
    const pad = (r: DOMRect, x: number, y: number) => ({ x0: r.left - x, y0: r.top - y, x1: r.right + x, y1: r.bottom + y });
    uiStore.romanStoryAvoid = [pad(el.getBoundingClientRect(), 12, 16), ...(skipEl ? [pad(skipEl.getBoundingClientRect(), 8, 6)] : [])];
  }
  $effect(() => {
    void chapter;
    if (!uiStore.romanStoryActive) return;
    const id = requestAnimationFrame(measureAvoid);
    return () => cancelAnimationFrame(id);
  });

  // Reduced motion: the camera cuts from one chapter's shot to the next,
  // under a brief fade to black, instead of flying.
  let veil = $state(false);
  let shown: ChapterId | null = null;
  $effect(() => {
    const id = chapter;
    if (!uiStore.romanStoryActive) { shown = null; return; }
    if (!reduce) { uiStore.romanStoryCamT = null; shown = id; return; }
    if (shown === null) { shown = id; uiStore.romanStoryCamT = HOLD[id]; return; }
    if (id === shown) return;
    veil = true;
    const cut = setTimeout(() => { shown = id; uiStore.romanStoryCamT = HOLD[id]; veil = false; }, 200);
    return () => clearTimeout(cut);
  });

  // Drag to look around: horizontal and vertical on a mouse, sideways on
  // touch (vertical touch is the page's own scroll).
  let drag: { x: number; y: number; id: number; touch: boolean } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
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
    bind:this={root}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="region"
    aria-label="Nancy Grace Roman Space Telescope, a scrolling story"
  >
    <div class="words">
      <section class="ch hero" bind:this={sections.hero} style="opacity: {alpha('hero')}; translate: 0 {shift('hero')}px">
        <h1>Nancy Grace Roman<br />Space Telescope</h1>
        {#if v?.distKm != null}
          <p>Launched 30 August 2026. Today, day {day}, it is <b>{km(v.distKm)} km</b> from Earth, on its way to its orbit around L2.</p>
        {:else}
          <p>Launched 30 August 2026, and today on day {day} of its way out to its orbit around L2.</p>
        {/if}
        <p class="cue"><i></i>Scroll</p>
      </section>

      <section class="ch" bind:this={sections.out} style="opacity: {alpha('out')}; translate: 0 {shift('out')}px">
        <h2>{day} days out</h2>
        <p>{#if moonDate}It passed the Moon’s distance on {moonDate}.{' '}{/if}Ahead, 1.5 million km from Earth, JWST and Euclid already circle Sun–Earth L2.</p>
      </section>

      <section class="ch" bind:this={sections.arrive} style="opacity: {alpha('arrive')}; translate: 0 {shift('arrive')}px">
        <h2>The observatory</h2>
        <p>A 2.4 m mirror, the size of Hubble’s, feeding a camera that sees about 100 times as much sky at once as Hubble’s infrared camera.</p>
      </section>

      <section class="ch" bind:this={sections.unfold} style="opacity: {alpha('unfold')}; translate: 0 {shift('unfold')}px">
        <h2>Folded for launch</h2>
        <p>It rode a Falcon Heavy folded up, and opened in space in three moves.</p>
        <ol class="steps">
          {#each DEPLOYMENTS as d, i (d.key)}
            <li class:on={i === step} class:done={i < step} aria-current={i === step ? 'step' : undefined}><span>{d.when}</span><em>{d.what}</em></li>
          {/each}
        </ol>
      </section>

      <section class="ch" bind:this={sections.sun} style="opacity: {alpha('sun')}; translate: 0 {shift('sun')}px">
        <h2>One side to the Sun</h2>
        <p>Six solar panels make about 4 kW and double as its sun shield. Behind them the telescope stays in shade, and cold.</p>
      </section>

      <section class="ch" bind:this={sections.light} style="opacity: {alpha('light')}; translate: 0 {shift('light')}px">
        <h2>Follow the light</h2>
        <p class="now"><b>{stop[0]}</b>{stop[1]}</p>
        <div class="ticks" aria-hidden="true">
          {#each STOPS as s, i (s[0])}<i class:done={i <= uiStore.romanStoryStop && t >= 7.95}></i>{/each}
        </div>
      </section>

      <section class="ch" bind:this={sections.image} style="opacity: {alpha('image')}; translate: 0 {shift('image')}px">
        <h2>300 million pixels</h2>
        <p>Eighteen detectors, 4,096 pixels square, cooled to about −178 °C. The picture builds up photon by photon.</p>
        <p class="fine">A simulated field: science begins after commissioning.</p>
      </section>

      <section class="ch" bind:this={sections.home} style="opacity: {alpha('home')}; translate: 0 {shift('home')}px">
        <h2>Sending it home</h2>
        <p>The 1.7 m dish tracks Earth and sends up to 500 Mb/s over Ka-band, about 1.4 TB a day. {v?.station ? `Right now ${v.station} has it in view.` : v ? 'No station has it in view right now.' : ''}</p>
      </section>

      <section class="ch" bind:this={sections.apart} style="opacity: {alpha('apart')}; translate: 0 {shift('apart')}px">
        <h2>Every part</h2>
        <p>The telescope, its two instruments, and the spacecraft that carries them.</p>
      </section>

      <section class="ch" bind:this={sections.end} style="opacity: {alpha('end')}; translate: 0 {shift('end')}px">
        <h2>Day {day}</h2>
        {#if v?.distKm != null}
          <p><b>{km(v.distKm)} km</b> from Earth{#if v.l2Km != null}, {km(v.l2Km)} km from L2{/if}. Keep scrolling for the tracker.</p>
        {:else}
          <p>Keep scrolling for the tracker.</p>
        {/if}
        <p class="fine">Drawn about 60,000 times life size. Positions from JPL Horizons.</p>
      </section>
    </div>

    {#if modelNote !== 'ready'}
      <div class="model-note" role="status">
        {#if modelNote === 'loading'}
          <i class="breathe" aria-hidden="true"></i>Bringing the observatory in
        {:else}
          <span>The observatory’s 3D model didn’t load.</span>
          <button type="button" onclick={() => uiStore.onRetryRomanModel?.()}>Try again</button>
        {/if}
      </div>
    {/if}

    <div class="rail" aria-hidden="true">
      {#each ORDER as id (id)}
        <i class:on={id === chapter} style="flex: {CHAPTERS[id][1] - CHAPTERS[id][0]}"><b style="transform: scaleY({fill(id)})"></b></i>
      {/each}
    </div>
    <button type="button" class="skip" bind:this={skipEl} onclick={() => uiStore.onExitStory?.('skip')}>Skip to the tracker</button>
    <div class="veil" class:on={veil} aria-hidden="true"></div>
  </div>
{/if}

<style>
  .roman-story {
    --ink: #f2f1ec;
    --ink-2: rgba(242, 241, 236, 0.76);
    --ink-3: rgba(242, 241, 236, 0.56);
    --gutter: clamp(20px, 6vw, 96px);
    --safe-t: env(safe-area-inset-top, 0px);
    --safe-r: env(safe-area-inset-right, 0px);
    --safe-b: env(safe-area-inset-bottom, 0px);
    --safe-l: env(safe-area-inset-left, 0px);
    position: fixed; inset: 0; z-index: 50;
    touch-action: pan-y;
    font-family: 'Overpass Mono', ui-monospace, monospace; color: var(--ink);
    cursor: grab;
    -webkit-tap-highlight-color: transparent;
  }
  .roman-story:active { cursor: grabbing; }
  .roman-story ::selection { background: rgba(68, 255, 68, 0.28); color: var(--ink); }

  .words { position: fixed; inset: 0; pointer-events: none; }
  .ch {
    position: absolute; left: calc(var(--gutter) + var(--safe-l)); top: 50%; transform: translateY(-50%);
    width: min(440px, calc(100vw - 40px));
  }
  /* The title holds its two lines. */
  .hero { width: min(560px, calc(100vw - 40px)); }
  .ch {
    text-shadow: 0 1px 18px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.8);
  }
  h1 { margin: 0 0 18px; font-size: clamp(30px, 4vw, 46px); line-height: 1.04; font-weight: 600; letter-spacing: -0.02em; text-wrap: balance; }
  h2 { margin: 0 0 12px; font-size: clamp(24px, 2.8vw, 34px); line-height: 1.08; font-weight: 600; letter-spacing: -0.015em; text-wrap: balance; }
  p { margin: 0 0 10px; font-size: 15px; line-height: 1.6; color: var(--ink-2); text-wrap: pretty; }
  p b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
  .fine { font-size: 12px; line-height: 1.5; color: var(--ink-3); }
  .cue { margin-top: 26px; display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-2); letter-spacing: 0.06em; }
  .cue i { width: 1px; height: 26px; background: linear-gradient(var(--live), transparent); animation: cue 2.2s ease-in-out infinite; }
  @keyframes cue { 0% { transform: scaleY(0); transform-origin: top; } 50% { transform: scaleY(1); transform-origin: top; } 51% { transform-origin: bottom; } 100% { transform: scaleY(0); transform-origin: bottom; } }

  .steps { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
  .steps li { font-size: 13px; line-height: 1.5; color: var(--ink-3); padding-left: 14px; border-left: 1px solid rgba(242, 241, 236, 0.16); transition: color 0.3s, border-color 0.3s; }
  .steps li span { display: block; font-size: 12px; color: inherit; font-variant-numeric: tabular-nums; }
  .steps li em { font-style: normal; }
  .steps li.done { color: var(--ink-2); }
  .steps li.on { color: var(--ink); border-left-color: var(--live); }
  .steps li.on span { color: var(--live); }

  .now { min-height: 4.8em; }
  .now b { display: block; color: var(--live); font-weight: 600; margin-bottom: 2px; }
  .ticks { display: flex; gap: 4px; margin-top: 6px; }
  .ticks i { width: 18px; height: 2px; background: rgba(242, 241, 236, 0.18); transition: background 0.2s; }
  .ticks i.done { background: var(--live); }

  /* One segment per part of the way: how far along, and how much is left. */
  .rail {
    position: fixed; right: calc(20px + var(--safe-r)); top: 50%; height: 38vh; width: 2px; transform: translateY(-50%);
    display: flex; flex-direction: column; gap: 4px; pointer-events: none;
  }
  .rail i { position: relative; background: rgba(242, 241, 236, 0.16); overflow: hidden; }
  .rail i b { position: absolute; inset: 0; background: var(--live); transform-origin: top; opacity: 0.55; }
  .rail i.on b { opacity: 1; }

  .skip {
    position: fixed; top: calc(6px + var(--safe-t)); right: calc(8px + var(--safe-r)); z-index: 2;
    min-height: 44px; padding: 0 12px;
    font: inherit; font-size: 12px; color: var(--ink-2); background: none; border: none; cursor: pointer;
    letter-spacing: 0.02em; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.9);
    transition: color 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .skip:hover, .skip:active { color: var(--ink); }
  .skip:focus-visible { outline: 1px solid var(--live); outline-offset: -6px; }

  .model-note {
    position: fixed; left: 50%; top: 34%; transform: translate(-50%, -50%);
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 12px; color: var(--ink-2); text-align: center; white-space: nowrap;
  }
  .model-note .breathe { width: 5px; height: 5px; border-radius: 50%; background: var(--live); animation: breathe 1.2s ease-in-out infinite alternate; }
  @keyframes breathe { from { opacity: 1; } to { opacity: 0.25; } }
  .model-note button {
    min-height: 44px; padding: 0 18px; font: inherit; font-size: 12px; color: var(--ink);
    background: none; border: 1px solid rgba(242, 241, 236, 0.3); cursor: pointer;
  }
  .model-note button:hover, .model-note button:active { border-color: var(--live); }
  .model-note button:focus-visible { outline: 1px solid var(--live); outline-offset: 2px; }

  .veil { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity 0.2s linear; }
  .veil.on { opacity: 1; }

  /* While the story plays the document scrolls: the canvas and the UI stay
     put over a tall empty track, and the tracker steps aside. */
  :global(html.roman-story-on) {
    height: auto; overflow-x: hidden; overflow-y: auto; touch-action: pan-y;
    overscroll-behavior-y: none; scrollbar-width: none;
  }
  :global(html.roman-story-on::-webkit-scrollbar) { display: none; }
  :global(html.roman-story-on body) { height: auto; overflow: visible; touch-action: pan-y; }
  :global(html.roman-story-on body > canvas), :global(html.roman-story-on #svelte-ui) { position: fixed; top: 0; left: 0; }
  /* Their own layers: scrolling the page moves only the empty track, so the
     scene and the words are never repainted (or shown half-painted) by it. */
  :global(html.roman-story-on #svelte-ui) { width: 100%; height: 100%; will-change: transform; }
  :global(html.roman-story-on body > canvas) { will-change: transform; }
  :global(.roman-story-track) { width: 1px; pointer-events: none; }
  :global(html.roman-story-on #ui-overlay > *:not(.roman-story)) { visibility: hidden !important; }

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

  /* Phones, portrait: the scene takes the top of the screen (the app frames
     it there) and the words sit below it, over a scrim, clear of the home bar. */
  @media (max-width: 760px) and (orientation: portrait) {
    .words::before {
      content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 52svh;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.9), rgba(0, 0, 0, 0.6) 50%, rgba(0, 0, 0, 0));
    }
    .ch {
      top: auto; bottom: calc(28px + var(--safe-b)); transform: none;
      left: calc(20px + var(--safe-l)); width: calc(100vw - 40px - var(--safe-l) - var(--safe-r));
    }
    .hero { bottom: calc(10svh + var(--safe-b)); }
    h1 { font-size: 32px; }
    h2 { font-size: 26px; margin-bottom: 10px; }
    p { font-size: 15px; line-height: 1.55; }
    .rail { right: calc(10px + var(--safe-r)); top: calc(64px + var(--safe-t)); height: 30svh; transform: none; }
    :global(.roman-tag) { font-size: 12px; }
  }

  /* Short screens (phones on their side, small laptops): the words stay in
     a narrower column at left, smaller, over a scrim from that side. */
  @media (max-height: 560px) and (orientation: landscape) {
    .words::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 62vw;
      background: linear-gradient(to right, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0.5) 55%, rgba(0, 0, 0, 0));
    }
    .ch { left: calc(24px + var(--safe-l)); width: min(380px, 46vw); }
    h1 { font-size: 26px; margin-bottom: 10px; }
    h2 { font-size: 21px; margin-bottom: 8px; }
    p { font-size: 13.5px; line-height: 1.5; margin-bottom: 6px; }
    .cue { margin-top: 12px; }
    .steps { margin-top: 8px; gap: 6px; }
    .rail { height: 50vh; }
  }

  /* Where space is short, the launch steps show only their times; the one
     under way keeps its line. The list stays the same height as it advances. */
  @media (max-width: 760px), (max-height: 560px) {
    .steps li { font-size: 13px; }
    .steps li:not(.on) em { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .cue i, .model-note .breathe { animation: none; }
    .steps li, .ticks i, .skip { transition: none; }
  }
</style>
