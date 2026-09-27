<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import * as THREE from 'three';
  import { uiStore } from '../../stores/ui.svelte';
  import { RomanStage, type Pose, type PickHit } from '../../roman/stage';
  import { paintBulgeField, DETECTOR_ARCMIN, HUBBLE_IR_ARCMIN } from '../../roman/sky';
  import { CHAPTERS, DEPLOYMENTS, LAUNCH, STOP_NOTES, type Chapter } from '../../roman/chapters';
  import { SUBSYSTEM, GROUPS, partLabel, type Subsystem } from '../../roman/catalog';
  import { PROVENANCE, PROVENANCE_TOTAL, type Tag } from '../../roman/dims';
  import { boundsOf } from '../../roman/model';

  /* ---------------------------------------------------------------- state -- */

  let host = $state<HTMLDivElement | null>(null);
  let skyHost = $state<HTMLDivElement | null>(null);
  let stage: RomanStage | null = null;

  let status = $state<'loading' | 'ready' | 'failed'>('loading');
  let ci = $state(0);
  const ch = $derived<Chapter>(CHAPTERS[ci]);

  // The opening: a star field with the detectors drawn over it.
  let skyOn = $state(true);
  let outlines = $state<{ x: number; y: number }[][]>([]);
  let hubble = $state<{ x: number; y: number; w: number; h: number; below: boolean } | null>(null);
  let focalPose: Pose | null = null;
  /** How far the sky outside the detectors is dimmed; deepens as the view pulls back. */
  let skyDim = $state(0.38);

  // Light path chapter: which stop the photon front has reached.
  let stopIndex = $state(-1);
  let stops = $state<{ id: string; label: string }[]>([]);
  // Deploy chapter: which step of the flown sequence is showing.
  let deployStep = $state(0);
  let deployPlaying = $state(false);

  // Exploration.
  let selSub = $state<string | null>(null);
  let selPart = $state<string | null>(null);
  let hover = $state<{ text: string; x: number; y: number } | null>(null);
  let explode = $state(0);
  let cutaway = $state(false);
  let stowed = $state(false);
  let showLight = $state(false);
  let indexOpen = $state(false);

  const sel = $derived<Subsystem | null>(selSub ? SUBSYSTEM[selSub] ?? null : null);
  const missionDay = Math.max(1, Math.floor((Date.now() - LAUNCH) / 86_400_000) + 1);
  const grounded = PROVENANCE.PUB + PROVENANCE.DER;
  const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Screen-space tags that follow 3D points, updated per frame without Svelte. */
  type Tag3 = { text: string; at: THREE.Vector3; el?: HTMLDivElement; lit?: boolean };
  let tags = $state<Tag3[]>([]);

  let goToken = 0;
  let lightRaf = 0;
  let deployTimer = 0;

  /* ------------------------------------------------------------- lifecycle -- */

  function mount(el: HTMLDivElement) {
    if (location.hash.includes('tracker')) history.replaceState(null, '', location.pathname + location.search);
    const s = new RomanStage(el);
    stage = s;
    s.autorotate = false;
    s.onPick = (hit) => pick(hit);
    s.onHover = (hit) => onHover(hit);
    // Repainting the field is ~100 ms; wait for the resize to settle.
    let resizeTimer = 0;
    s.onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { if (status === 'ready' && (ch.id === 'sky' || skyOn)) prepareSky(); }, 180);
    };
    s.onFrame = frame;
    s.ready.then(async () => {
      if (stage !== s) return;
      stops = s.light?.stops.map((st) => ({ id: st.id, label: st.label })) ?? [];
      status = 'ready';
      await tick();
      prepareSky();
      go(ci, true);
    }).catch(() => { if (stage === s) status = 'failed'; });
    return { destroy() { cancelAnimationFrame(lightRaf); clearTimeout(deployTimer); s.dispose(); if (stage === s) stage = null; } };
  }

  onDestroy(() => { cancelAnimationFrame(lightRaf); clearTimeout(deployTimer); });

  /* ------------------------------------------------------------------ sky -- */

  /**
   * Paint the star field at this viewport's size, at the angular scale the
   * focal-plane shot gives the detectors, and project that same image onto the
   * 3D detectors from that shot — so the outlines here and the chips there are
   * the same pixels when the view pulls back.
   */
  function prepareSky() {
    const s = stage;
    if (!s?.model || !host || !skyHost) return;
    focalPose = s.shot('focal');
    const lines = s.detectorOutlines(focalPose);
    if (!lines.length) return;
    const d0 = lines[0];
    const detPx = Math.hypot(d0[1].x - d0[0].x, d0[1].y - d0[0].y);
    const W = host.clientWidth, H = host.clientHeight;
    // Paint at the screen's density (capped): a soft field upscaled 2x on a
    // phone reads as blobs, not stars.
    const dpr = Math.min(devicePixelRatio || 1, W < 768 ? 2.5 : 1.5);
    const field = paintBulgeField(Math.round(W * dpr), Math.round(H * dpr), DETECTOR_ARCMIN / detPx / dpr);
    Object.assign(field.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    skyHost.querySelector('canvas')?.remove();
    skyHost.prepend(field);
    const tex = new THREE.CanvasTexture(field);
    tex.colorSpace = THREE.SRGBColorSpace;
    s.setSkyProjection(tex, focalPose);
    outlines = lines;
    let maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of lines) for (const p of q) { maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const hw = detPx * HUBBLE_IR_ARCMIN[0] / DETECTOR_ARCMIN, hh = detPx * HUBBLE_IR_ARCMIN[1] / DETECTOR_ARCMIN;
    // Just under the mosaic's right end, where the eye lands after reading it.
    hubble = { x: maxX - hw - detPx * 0.15, y: maxY + detPx * 0.32, w: hw, h: hh, below: W < H };
  }

  /* ------------------------------------------------------------- chapters -- */

  function reset(s: RomanStage) {
    s.explodeGoal = 0;
    s.cutGoal = 0;
    s.lightGoal = { progress: s.light?.length ?? 0, opacity: 0, cgi: false };
    s.skyGainGoal = 0;
    s.focus = null;
    s.hidden = new Set();
    s.hiddenParts = [];
    s.solo = null;
    s.sunGoal = 0;
    s.beamGoal = 0;
    s.deployGoal = { liss: 1, sass: 1, hga: 1, dac: 1 };
    s.autorotate = false;
    cancelAnimationFrame(lightRaf);
    clearTimeout(deployTimer);
    deployPlaying = false;
    stopIndex = -1;
    tags = [];
  }

  const around = (target: THREE.Vector3, dist: number, theta: number, phi: number): Pose => ({ target, dist, theta, phi });

  async function go(i: number, first = false) {
    const s = stage;
    if (!s?.model) { ci = i; return; }
    const token = ++goToken;
    const prev = CHAPTERS[ci].id;
    ci = i;
    const id = CHAPTERS[i].id;
    reset(s);
    const alive = () => token === goToken;
    const m = s.model!;
    const fp = boundsOf(m.detectors).getCenter(new THREE.Vector3());

    switch (id) {
      case 'sky': {
        skyOn = true;
        skyDim = 0.38;
        s.solo = ['WFI.H4RG'];
        s.skyGainGoal = 1.4;
        if (focalPose) await s.fly([focalPose], 0);
        break;
      }
      case 'focal': {
        s.skyGainGoal = 1.4;
        s.focus = new Set(['WIDE_FIELD_INSTRUMENT']);
        s.hiddenParts = ['WFI.Body'];
        const oblique = around(fp.clone().setY(fp.y + 0.2), 1.75, 0.55, 0.92);
        if (prev === 'sky' && !first) {
          // The signature hand-over: only the light that lands on the
          // detectors stays lit, then the outlines turn out to be the chips.
          s.solo = ['WFI.H4RG'];
          skyDim = 0.9;
          await wait(reducedMotion ? 0 : 900);
          if (!alive()) return;
          skyOn = false;
          await wait(reducedMotion ? 0 : 1000);
          if (!alive()) return;
          s.solo = null;
          await s.fly([oblique], 3.4);
        } else {
          skyOn = false;
          await s.fly([oblique], first ? 0 : 2.4);
        }
        if (alive()) tags = m.byPart.get('WFI.ElementWheel')
          ? [{ text: 'Element wheel', at: boundsOf([m.byPart.get('WFI.ElementWheel')!]).getCenter(new THREE.Vector3()) },
             { text: '18 H4RG-10 detectors', at: fp.clone() }]
          : [];
        break;
      }
      case 'light': {
        skyOn = false;
        s.cutGoal = 1;
        s.hiddenParts = ['WFI.Body'];
        s.skyGainGoal = 0.35;
        const L = s.light!;
        if (prev === 'focal' && !first) {
          // Back out along the beam: detectors, wheel, aft optics, through the
          // primary, past the secondary, out of the aperture.
          s.lightGoal = { progress: L.length, opacity: 1, cgi: false };
          const pts = L.stopPoints;
          await s.fly([
            around(pts[8].clone(), 0.9, 0.35, 0.55),
            around(pts[6].clone(), 1.5, 0.7, 1.05),
            around(pts[3].clone().setY(pts[3].y + 0.3), 3.0, 0.8, 0.95),
            around(pts[2].clone().setY(pts[2].y - 1.2), 6.0, 0.7, 1.15),
            s.shot('optics'),
          ], reducedMotion ? 0 : 7.5);
        } else {
          await s.fly([s.shot('optics')], first ? 0 : 2.4);
        }
        if (!alive()) return;
        tags = L.stops.map((st, k) => ({ text: st.label, at: L.stopPoints[k].clone() }));
        playLight(token);
        break;
      }
      case 'coronagraph': {
        skyOn = false;
        s.cutGoal = 1;
        s.hiddenParts = ['WFI.Body'];
        s.lightGoal = { progress: s.light!.length, opacity: 1, cgi: true };
        // Ghost everything but the coronagraph's path, and open the collimator
        // module's housing so its three mirrors and the tip/tilt flat show.
        s.focus = new Set(['TEL.TertiaryCollimatorAssembly', 'CORONAGRAPH_INSTRUMENT']);
        s.hiddenParts = ['WFI.Body', 'TOMA.Structure'];
        const cgiMeshes = [...(m.bySubsystem.get('TEL.TertiaryCollimatorAssembly') ?? []), ...(m.bySubsystem.get('CORONAGRAPH_INSTRUMENT') ?? [])];
        const shot = s.shotOf(cgiMeshes, around(new THREE.Vector3(), 1, -1.15, 1.2));
        shot.dist *= 1.35;
        await s.fly([shot], first ? 0 : 2.6);
        if (alive()) tags = s.light!.cgiStops.map((st, k) => ({ text: st.label, at: s.light!.cgiStopPoints[k].clone() }));
        break;
      }
      case 'deploy': {
        skyOn = false;
        // Fold up during the flight, so it arrives in its launch configuration.
        setDeploy(0);
        await s.fly([s.shot('deploy')], first ? 0 : 2.4);
        if (!alive()) return;
        await wait(reducedMotion ? 0 : 1800);
        if (alive()) playDeploy(token);
        break;
      }
      case 'thermal': {
        skyOn = false;
        s.sunGoal = 1;
        s.focus = new Set(['SOLAR_ARRAY_SUN_SHIELD', 'OSS.LowerInstrumentSunShade', 'TEL.OuterBarrelAssembly', 'TEL.DeployableApertureCover']);
        await s.fly([s.shot('thermal')], first ? 0 : 2.6);
        break;
      }
      case 'power': {
        skyOn = false;
        s.sunGoal = 0.45;
        s.beamGoal = 1;
        s.focus = new Set(['COMMUNICATIONS', 'SOLAR_ARRAY_SUN_SHIELD']);
        await s.fly([s.shot('comms')], first ? 0 : 2.6);
        break;
      }
      case 'explore': {
        skyOn = false;
        s.autorotate = !reducedMotion;
        applyExplore();
        await s.fly([s.shot('explore')], first ? 0 : 2.2);
        break;
      }
    }
  }

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function next() { if (ci < CHAPTERS.length - 1) go(ci + 1); }
  function prev() { if (ci > 0) go(ci - 1); }

  /** Reveal the beam from the aperture to the focal plane, stop by stop. */
  function playLight(token: number) {
    const s = stage;
    if (!s?.light) return;
    const L = s.light;
    const dur = reducedMotion ? 0.01 : 10.5;
    const t0 = performance.now();
    s.lightGoal = { progress: 0, opacity: 1, cgi: false };
    const step = () => {
      if (token !== goToken) return;
      const t = Math.min(1, (performance.now() - t0) / 1000 / dur);
      const p = t * L.length;
      s.lightGoal.progress = p;
      let k = -1;
      for (let i = 0; i < L.stops.length; i++) if (p >= L.stops[i].s - 0.001) k = i;
      if (k !== stopIndex) {
        stopIndex = k;
        // Only the photon's current stop is labelled in 3D; the aft-optics
        // stops sit centimetres apart and would pile up. The list has them all.
        tags = tags.map((g, i) => ({ ...g, lit: i === k }));
      }
      if (t < 1) lightRaf = requestAnimationFrame(step);
    };
    lightRaf = requestAnimationFrame(step);
  }

  function replayLight() { if (stage) playLight(goToken); }

  /** Step 0 is the launch configuration; each later step opens one mechanism. */
  function setDeploy(k: number) {
    const s = stage;
    if (!s) return;
    deployStep = k;
    s.deployGoal = { liss: k >= 1 ? 1 : 0, sass: k >= 1 ? 1 : 0, hga: k >= 2 ? 1 : 0, dac: k >= 3 ? 1 : 0 };
    const m = s.model;
    if (!m) return;
    const at = (sub: string, part?: string) => {
      const list = part ? [m.byPart.get(part)!].filter(Boolean) : m.bySubsystem.get(sub) ?? [];
      return list.length ? boundsOf(list).getCenter(new THREE.Vector3()) : new THREE.Vector3();
    };
    const t: Tag3[] = [];
    if (k >= 1) t.push({ text: 'Lower sun shade', at: at('OSS.LowerInstrumentSunShade') }, { text: 'Solar array', at: at('', 'SASS.Outer.PX.2') });
    if (k >= 2) t.push({ text: 'High-gain antenna', at: at('', 'HGA.Dish') });
    if (k >= 3) t.push({ text: 'Aperture cover', at: at('TEL.DeployableApertureCover').setY(11.4) });
    tags = t;
  }

  function playDeploy(token: number) {
    deployPlaying = true;
    const stepOnce = (k: number) => {
      if (token !== goToken) return;
      setDeploy(k);
      if (k < DEPLOYMENTS.length - 1) deployTimer = window.setTimeout(() => stepOnce(k + 1), reducedMotion ? 400 : 2300);
      else deployPlaying = false;
    };
    stepOnce(1);
  }

  function replayDeploy() {
    const token = ++goToken;
    setDeploy(0);
    deployTimer = window.setTimeout(() => playDeploy(token), reducedMotion ? 200 : 1300);
  }

  /* -------------------------------------------------------------- explore -- */

  function applyExplore() {
    const s = stage;
    if (!s) return;
    s.explodeGoal = explode;
    s.cutGoal = cutaway ? 1 : 0;
    const d = stowed ? 0 : 1;
    s.deployGoal = { liss: d, sass: d, hga: d, dac: d };
    s.lightGoal = { progress: s.light?.length ?? 0, opacity: showLight ? 1 : 0, cgi: showLight };
    s.hiddenParts = cutaway || showLight ? ['WFI.Body'] : [];
  }

  $effect(() => {
    // Read every control before the guard so Svelte tracks them.
    void [explode, cutaway, stowed, showLight];
    if (ch.id === 'explore') applyExplore();
  });

  function pick(hit: PickHit | null) {
    const s = stage;
    if (!s) return;
    if (!hit || (hit.part === selPart)) {
      selPart = null; selSub = null;
    } else {
      selPart = hit.part; selSub = hit.subsystem;
    }
    s.selectedPart = selPart;
    s.selectedSubsystem = selSub;
  }

  function selectSubsystem(id: string) {
    const s = stage;
    if (!s?.model) return;
    selSub = selSub === id && !selPart ? null : id;
    selPart = null;
    s.selectedPart = null;
    s.selectedSubsystem = selSub;
    // Anything inside the barrel is out of sight from outside it: section the
    // shells so framing the part actually shows it.
    if (selSub && ch.id === 'explore' && INSIDE.has(selSub)) cutaway = true;
    if (selSub) {
      const meshes = s.model.bySubsystem.get(selSub) ?? [];
      if (meshes.length) s.fly([s.shotOf(meshes)], 1.6);
    }
    if (window.innerWidth < 768) indexOpen = false;
  }

  function frameSelection() {
    const s = stage;
    if (!s?.model) return;
    const meshes = selPart ? [s.model.byPart.get(selPart)!].filter(Boolean) : s.model.bySubsystem.get(selSub ?? '') ?? [];
    if (meshes.length) s.fly([s.shotOf(meshes)], 1.4);
  }

  function isolate() {
    const s = stage;
    if (!s || !selSub) return;
    s.focus = s.focus?.has(selSub) && s.focus.size === 1 ? null : new Set([selSub]);
  }

  function clearSelection() {
    selPart = null; selSub = null;
    if (stage) { stage.selectedPart = null; stage.selectedSubsystem = null; }
  }

  function onHover(hit: PickHit | null) {
    if (!hit || ch.id === 'sky') { hover = null; return; }
    const p = stage!.project(hit.point);
    hover = { text: partLabel(hit.part), x: p.x, y: p.y };
  }

  /* ------------------------------------------------------------- per frame -- */

  const scratch = { x: 0, y: 0, z: 0 };
  function frame() {
    const s = stage;
    if (!s) return;
    for (const t of tags) {
      if (!t.el) continue;
      s.project(t.at, scratch);
      const off = scratch.z > 1 || scratch.x < -40 || scratch.y < -40 || scratch.x > (host?.clientWidth ?? 0) + 40;
      t.el.style.transform = `translate3d(${scratch.x}px, ${scratch.y}px, 0)`;
      t.el.style.opacity = off ? '0' : '';
    }
  }

  /* ------------------------------------------------------------- keyboard -- */

  function onKey(e: KeyboardEvent) {
    if (!uiStore.romanOpen) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Escape') { if (selSub) clearSelection(); else if (indexOpen) indexOpen = false; }
  }

  function enterTracker() {
    uiStore.romanOpen = false;
    history.replaceState(null, '', location.pathname + location.search + '#tracker');
  }

  const TAG_NAME: Record<Tag, string> = {
    PUB: 'Published by NASA, L3Harris or peer review',
    DER: 'Derived from published figures',
    EST: 'Estimated; not yet grounded in a source',
  };
  const TAGS: Tag[] = ['PUB', 'DER', 'EST'];
  /** Subsystems hidden inside the barrel or the instrument bay. */
  const INSIDE = new Set([
    'TEL.PrimaryMirrorAssembly', 'TEL.SecondaryMirrorAssembly', 'TEL.AftOpticsModule',
    'TEL.TertiaryCollimatorAssembly', 'TEL.ForwardStructureAssembly', 'TEL.Interfaces',
    'WIDE_FIELD_INSTRUMENT', 'CORONAGRAPH_INSTRUMENT', 'INSTRUMENT_CARRIER', 'TEL.TelescopeControlElectronics',
  ]);
</script>

<svelte:window onkeydown={onKey} />

<section class="rx" aria-label="Nancy Grace Roman Space Telescope explorer">
  <div class="stage" use:mount bind:this={host}></div>

  <!-- The opening sky and its detector outlines, drawn over the same pose the 3D camera holds. -->
  <div class="sky" class:off={!skyOn} bind:this={skyHost} aria-hidden={!skyOn}>
    <svg class="foot" width="100%" height="100%">
      <defs>
        <mask id="rx-fp">
          <rect width="100%" height="100%" fill="white" />
          {#each outlines as q}<polygon points={q.map((p) => `${p.x},${p.y}`).join(' ')} fill="black" />{/each}
        </mask>
      </defs>
      <rect class="dim" width="100%" height="100%" mask="url(#rx-fp)" style:opacity={skyDim} />
      {#each outlines as q, i}
        <polygon points={q.map((p) => `${p.x},${p.y}`).join(' ')} style:animation-delay="{120 + i * 40}ms" />
      {/each}
      {#if hubble}
        <rect class="hst" x={hubble.x} y={hubble.y} width={hubble.w} height={hubble.h} />
      {/if}
    </svg>
    {#if hubble}
      <div class="hst-label" class:below={hubble.below}
        style:left="{hubble.below ? hubble.x + hubble.w : hubble.x - 10}px"
        style:top="{hubble.below ? hubble.y + hubble.h + 8 : hubble.y + hubble.h / 2}px">Hubble’s infrared camera, same scale</div>
    {/if}
    <p class="synthetic long">Synthetic star field toward the Galactic bulge — not a Roman image.</p>
  </div>

  <!-- 3D-anchored labels -->
  <div class="tags" aria-hidden="true">
    {#each tags as t (t.text)}
      <div class="tag" class:lit={t.lit !== false} class:quiet={t.lit === false} bind:this={t.el}><i></i><span>{t.text}</span></div>
    {/each}
    {#if hover}
      <div class="hover" style:transform="translate3d({hover.x}px, {hover.y}px, 0)"><span>{hover.text}</span></div>
    {/if}
  </div>

  <header class="mast">
    <h1>Nancy Grace Roman<br />Space Telescope</h1>
    <p class="status">
      <span class="dot" aria-hidden="true"></span>
      <span class="long">Launched 30 August 2026 · day {missionDay} · commissioning on the way to L2</span>
      <span class="short">Day {missionDay} since launch · en route to L2</span>
    </p>
  </header>

  <div class="top-right">
    <div class="prov" title="Dimensions in the model, by source">
      <div class="bar" aria-hidden="true">
        {#each TAGS as t}<span class="seg {t}" style:flex={PROVENANCE[t]}></span>{/each}
      </div>
      <span>{grounded} of {PROVENANCE_TOTAL} dimensions published or derived</span>
    </div>
    <button class="exit" onclick={enterTracker}><span class="long">Enter the{' '}</span>tracker <span aria-hidden="true">→</span></button>
  </div>

  {#if status !== 'ready'}
    <div class="loading" role="status">
      {#if status === 'failed'}
        The observatory model failed to load. <button onclick={() => location.reload()}>Try again</button>
      {:else}
        <span class="pulse" aria-hidden="true"></span> Loading the observatory
      {/if}
    </div>
  {/if}

  <!-- Chapter copy -->
  {#key ci}
    <article class="copy" class:explore={ch.id === 'explore'}>
      <h2>{ch.title}</h2>
      {#each ch.body as para}<p>{para}</p>{/each}

      {#if ch.id === 'light'}
        <ol class="stops">
          {#each stops as st, k}
            <li class:done={k < stopIndex} class:now={k === stopIndex}>
              <b>{st.label}</b>
              {#if k === stopIndex}<span>{STOP_NOTES[st.id]}</span>{/if}
            </li>
          {/each}
        </ol>
        <button class="ghost" onclick={replayLight}>Replay the light</button>
      {:else if ch.id === 'deploy'}
        <ol class="events">
          {#each DEPLOYMENTS as d, k}
            <li class:done={k < deployStep} class:now={k === deployStep}>
              <button onclick={() => { clearTimeout(deployTimer); deployPlaying = false; setDeploy(k); }}>
                <time>{d.when}</time><span>{d.what}</span>
              </button>
            </li>
          {/each}
        </ol>
        <button class="ghost" onclick={replayDeploy} disabled={deployPlaying}>{deployPlaying ? 'Unfolding…' : 'Replay from launch'}</button>
      {/if}

      {#if ch.stats}
        <dl class="stats">
          {#each ch.stats as st}<div><dt>{st.label}</dt><dd>{st.value}{#if st.sup}<sup>{st.sup}</sup>{/if}</dd></div>{/each}
        </dl>
      {/if}

      {#if ch.id === 'explore'}
        <div class="tools">
          <label class="slider">
            <span>Exploded</span>
            <input type="range" min="0" max="1" step="0.01" bind:value={explode} />
          </label>
          <label class="check"><input type="checkbox" bind:checked={cutaway} /> <span>Cutaway</span></label>
          <label class="check"><input type="checkbox" bind:checked={showLight} /> <span>Light path</span></label>
          <label class="check"><input type="checkbox" bind:checked={stowed} /> <span>Launch configuration</span></label>
          <button class="ghost" onclick={() => (indexOpen = !indexOpen)} aria-expanded={indexOpen}>All parts</button>
        </div>
      {/if}

      {#if ch.next}
        <button class="next" onclick={next}>{ch.next} <span aria-hidden="true">→</span></button>
      {/if}
      {#if ch.id === 'sky'}<p class="source short">The star field is synthetic, not a Roman image.</p>{/if}
      {#if ch.source}<p class="source">Source: <a href="https://{ch.source}" target="_blank" rel="noreferrer">{ch.source}</a></p>{/if}
    </article>
  {/key}

  <!-- Parts index -->
  {#if indexOpen}
    <nav class="index" aria-label="Parts">
      <div class="index-head">
        <b>Parts</b>
        <button class="x" onclick={() => (indexOpen = false)} aria-label="Close parts">×</button>
      </div>
      {#each GROUPS as [group, ids]}
        <h3>{group}</h3>
        {#each ids as id}
          <button class="row" class:on={selSub === id} onclick={() => selectSubsystem(id)}>{SUBSYSTEM[id].label}</button>
        {/each}
      {/each}
    </nav>
  {/if}

  <!-- Inspector -->
  {#if sel}
    <aside class="inspector" aria-label="{sel.label} details">
      <div class="ins-head">
        <div>
          <p class="group">{sel.group}</p>
          <h3>{selPart ? partLabel(selPart) : sel.label}</h3>
          {#if selPart}<p class="of">Part of the {sel.label.toLowerCase()}</p>{/if}
        </div>
        <button class="x" onclick={clearSelection} aria-label="Close details">×</button>
      </div>
      <p class="blurb">{sel.blurb}</p>
      {#if sel.facts.length}
        <table>
          <tbody>
            {#each sel.facts as f}
              <tr title={f.note}>
                <th scope="row">{f.label}</th>
                <td>{f.value}</td>
                <td class="t {f.tag}" title={TAG_NAME[f.tag]}>{f.tag}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if sel.conflict}<p class="conflict"><b>Unresolved.</b> {sel.conflict}</p>{/if}
      <div class="ins-actions">
        <button class="ghost" onclick={frameSelection}>Frame</button>
        <button class="ghost" onclick={isolate}>Isolate</button>
      </div>
    </aside>
  {/if}

  <!-- Chapter rail -->
  <nav class="rail" aria-label="Chapters">
    <button class="arrow" onclick={prev} disabled={ci === 0} aria-label="Previous chapter">←</button>
    <ol>
      {#each CHAPTERS as c, k}
        <li><button class:on={k === ci} aria-current={k === ci ? 'step' : undefined} onclick={() => go(k)}>{c.nav}</button></li>
      {/each}
    </ol>
    <button class="arrow" onclick={next} disabled={ci === CHAPTERS.length - 1} aria-label="Next chapter">→</button>
  </nav>
</section>

<style>
  @font-face {
    font-family: 'Roman Mono';
    src: url('/fonts/overpass-mono-var-latin.woff2') format('woff2');
    font-weight: 300 700;
    font-display: swap;
  }

  .rx {
    --ink: #f2f1ec;
    --ink-2: rgba(242, 241, 236, 0.72);
    --ink-3: rgba(242, 241, 236, 0.46);
    --rule: rgba(242, 241, 236, 0.14);
    --est: #ffae4a;
    --panel: rgba(4, 5, 7, 0.72);
    position: fixed;
    inset: 0;
    z-index: 12000;
    background: #000;
    color: var(--ink);
    font-family: 'Roman Mono', 'Overpass Mono', ui-monospace, monospace;
    font-size: 14px;
    line-height: 1.5;
    user-select: text;
    overflow: hidden;
    pointer-events: auto;
  }
  .rx ::selection { background: var(--live); color: #000; }
  .short { display: none; }
  .rx button { font: inherit; color: inherit; }
  .rx :focus-visible { outline: 1px solid var(--live); outline-offset: 3px; }

  .stage { position: absolute; inset: 0; }

  /* --- sky ----------------------------------------------------------------- */
  .sky {
    position: absolute; inset: 0; pointer-events: none;
    transition: opacity 1.1s cubic-bezier(0.22, 1, 0.36, 1);
    will-change: opacity;
  }
  .sky.off { opacity: 0; }
  .sky::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0.45) 30%, rgba(0, 0, 0, 0) 52%),
      linear-gradient(0deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 22%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0) 18%);
  }
  .foot .dim { fill: #000; transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
  .foot { position: absolute; inset: 0; overflow: visible; }
  .foot > polygon {
    fill: none;
    stroke: var(--live);
    stroke-width: 1.25;
    filter: drop-shadow(0 0 4px rgba(68, 255, 68, 0.55));
    vector-effect: non-scaling-stroke;
    animation: trace 1.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .foot .hst { fill: none; stroke: var(--ink); stroke-width: 1; stroke-dasharray: 3 2; }
  @keyframes trace { from { opacity: 0; stroke-opacity: 0; } to { opacity: 1; } }
  .hst-label.below { transform: translateX(-100%); }
  .hst-label {
    position: absolute; transform: translate(-100%, -50%); white-space: nowrap;
    font-size: 11px; color: var(--ink-2); letter-spacing: 0.02em;
  }
  .synthetic {
    position: absolute; right: 24px; bottom: 76px; margin: 0;
    font-size: 11px; color: var(--ink-3);
  }

  /* --- labels -------------------------------------------------------------- */
  .tags { position: absolute; inset: 0; pointer-events: none; }
  .tag {
    position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 8px;
    font-size: 11px; white-space: nowrap; color: var(--ink-3);
    transition: opacity 0.4s, color 0.4s;
    will-change: transform;
  }
  .tag i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; margin-left: -2.5px; flex: none; }
  .tag span { padding: 2px 6px; background: rgba(0, 0, 0, 0.55); border: 1px solid var(--rule); }
  .tag.lit { color: var(--ink); }
  .tag.quiet { opacity: 0 !important; }
  .hover {
    position: absolute; left: 0; top: 0; pointer-events: none;
    font-size: 11px; white-space: nowrap;
  }
  .hover span {
    position: absolute; left: 14px; top: -26px; padding: 3px 7px;
    background: rgba(0, 0, 0, 0.8); border: 1px solid var(--live); color: var(--ink);
  }

  /* --- masthead ------------------------------------------------------------ */
  .mast { position: absolute; left: 32px; top: 26px; pointer-events: none; max-width: 60vw; }
  .mast h1 {
    margin: 0; font-weight: 600; font-size: clamp(18px, 1.9vw, 26px);
    line-height: 1.12; letter-spacing: -0.02em;
  }
  .status { margin: 10px 0 0; font-size: 12px; color: var(--ink-2); display: flex; align-items: center; gap: 8px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--live); box-shadow: 0 0 10px var(--live); animation: breathe 2.6s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: 0.35; } }

  .top-right { position: absolute; right: 28px; top: 26px; display: flex; align-items: center; gap: 22px; }
  .prov { display: grid; gap: 6px; font-size: 11px; color: var(--ink-3); width: 190px; }
  .bar { display: flex; gap: 2px; height: 3px; }
  .seg.PUB { background: var(--live); }
  .seg.DER { background: var(--ink-2); }
  .seg.EST { background: var(--est); opacity: 0.8; }
  .exit {
    background: none; border: 1px solid var(--rule); padding: 9px 14px; cursor: pointer;
    font-size: 12px; letter-spacing: 0.01em; transition: border-color 0.2s, color 0.2s;
  }
  .exit:hover { border-color: var(--ink); }

  .loading {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--ink-2);
  }
  .loading button { background: none; border: 1px solid var(--rule); padding: 4px 10px; cursor: pointer; }
  .pulse { width: 8px; height: 8px; background: var(--live); animation: breathe 1.2s ease-in-out infinite; }

  /* --- chapter copy -------------------------------------------------------- */
  .copy {
    position: absolute; left: 32px; bottom: 92px; width: min(440px, calc(100vw - 64px));
    max-height: calc(100vh - 220px); overflow: auto; scrollbar-width: thin;
    animation: arrive 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes arrive { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } }
  .copy h2 {
    margin: 0 0 14px; font-weight: 600; font-size: clamp(28px, 3.3vw, 46px);
    line-height: 1.02; letter-spacing: -0.035em; text-wrap: balance;
  }
  .copy p { margin: 0 0 12px; color: var(--ink-2); font-size: 14.5px; max-width: 46ch; text-wrap: pretty; }
  .stats { display: flex; gap: 28px; margin: 20px 0 6px; flex-wrap: wrap; }
  .stats div { display: grid; gap: 2px; }
  .stats dd { margin: 0; order: -1; font-size: 24px; font-weight: 500; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stats dt { font-size: 11px; color: var(--ink-3); }
  .stats sup { font-size: 0.55em; margin-left: 1px; vertical-align: 0.85em; line-height: 0; }

  .next {
    margin-top: 18px; display: inline-flex; gap: 10px; align-items: center; cursor: pointer;
    background: var(--live); color: #000; border: none; padding: 11px 18px;
    font-weight: 600; font-size: 13px; letter-spacing: 0.01em;
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s;
  }
  .next:hover { transform: translateX(3px); box-shadow: 0 6px 24px -8px var(--live); }
  .ghost {
    background: none; border: 1px solid var(--rule); padding: 7px 12px; cursor: pointer;
    font-size: 12px; margin-top: 10px; transition: border-color 0.2s;
  }
  .ghost:hover:not(:disabled) { border-color: var(--ink); }
  .ghost:disabled { color: var(--ink-3); cursor: default; }
  .source { font-size: 11px !important; color: var(--ink-3) !important; margin-top: 14px !important; }
  .source a { color: var(--ink-2); text-underline-offset: 3px; text-decoration-color: var(--rule); }
  .source a:hover { color: var(--ink); }

  .stops, .events { list-style: none; margin: 16px 0 4px; padding: 0; display: grid; gap: 1px; }
  .stops li {
    position: relative; padding: 3px 0 3px 16px; font-size: 12.5px; color: var(--ink-3);
    transition: color 0.3s;
  }
  .stops li::before {
    content: ''; position: absolute; left: 0; top: 10px; width: 6px; height: 1px; background: currentColor;
  }
  .stops li.done { color: var(--ink-2); }
  .stops li.now { color: var(--live); }
  .stops li b { font-weight: 500; }
  .stops li span { display: block; color: var(--ink); font-size: 12.5px; margin-top: 2px; }

  .events li button {
    display: grid; gap: 2px; width: 100%; text-align: left; background: none; border: none;
    border-left: 1px solid var(--rule); padding: 6px 0 6px 14px; cursor: pointer; color: var(--ink-3);
    transition: color 0.3s, border-color 0.3s;
  }
  .events li.done button { color: var(--ink-2); }
  .events li.now button { color: var(--ink); border-left-color: var(--live); }
  .events time { font-size: 11px; color: var(--live); opacity: 0.85; }
  .events li:not(.now):not(.done) time { color: var(--ink-3); }
  .events span { font-size: 12.5px; }

  .copy.explore { bottom: 92px; }
  .tools { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-top: 14px; font-size: 12px; }
  .tools .ghost { margin: 0; }
  .slider { display: flex; align-items: center; gap: 10px; }
  .slider input { accent-color: var(--live); width: 130px; }
  .check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .check input { accent-color: var(--live); margin: 0; }

  /* --- parts index --------------------------------------------------------- */
  .index {
    position: absolute; left: 32px; top: 110px; bottom: 92px; width: 240px; overflow: auto;
    background: var(--panel); border: 1px solid var(--rule); padding: 12px 0;
    backdrop-filter: blur(10px); scrollbar-width: thin; scrollbar-color: var(--rule) transparent;
    animation: arrive 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .index-head { display: flex; justify-content: space-between; align-items: center; padding: 0 14px 6px; }
  .index h3 { margin: 12px 14px 4px; font-size: 11px; font-weight: 500; color: var(--ink-3); }
  .row {
    display: block; width: 100%; text-align: left; background: none; border: none; cursor: pointer;
    padding: 4px 14px; font-size: 12.5px; color: var(--ink-2); border-left: 1px solid transparent;
  }
  .row:hover { color: var(--ink); }
  .row.on { color: var(--live); border-left-color: var(--live); }

  /* --- inspector ----------------------------------------------------------- */
  .inspector {
    position: absolute; right: 28px; top: 96px; width: 330px; max-height: calc(100vh - 200px); overflow: auto;
    background: var(--panel); border: 1px solid var(--rule); padding: 16px 18px 14px;
    backdrop-filter: blur(12px); scrollbar-width: thin; scrollbar-color: var(--rule) transparent;
    animation: arrive 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .ins-head { display: flex; justify-content: space-between; gap: 12px; }
  .group { margin: 0; font-size: 11px; color: var(--live); }
  .inspector h3 { margin: 4px 0 0; font-size: 19px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }
  .of { margin: 4px 0 0; font-size: 11.5px; color: var(--ink-3); }
  .blurb { margin: 12px 0 10px; font-size: 12.5px; color: var(--ink-2); }
  .inspector table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .inspector th { text-align: left; font-weight: 400; color: var(--ink-3); padding: 4px 0; }
  .inspector td { text-align: right; padding: 4px 0 4px 8px; font-variant-numeric: tabular-nums; }
  .inspector tr + tr th, .inspector tr + tr td { border-top: 1px solid rgba(242, 241, 236, 0.06); }
  .t { font-size: 10px; letter-spacing: 0.06em; width: 34px; cursor: help; }
  .t.PUB { color: var(--live); }
  .t.DER { color: var(--ink-2); }
  .t.EST { color: var(--est); }
  .conflict { font-size: 12px; color: var(--ink-2); margin: 12px 0 0; padding: 8px 10px; background: rgba(255, 174, 74, 0.07); }
  .conflict b { color: var(--est); font-weight: 600; }
  .ins-actions { display: flex; gap: 8px; }
  .x { background: none; border: none; cursor: pointer; font-size: 18px; line-height: 1; color: var(--ink-3); padding: 0 2px; align-self: flex-start; }
  .x:hover { color: var(--ink); }

  /* --- rail ---------------------------------------------------------------- */
  .rail {
    position: absolute; left: 0; right: 0; bottom: 0; height: 64px;
    display: flex; align-items: center; gap: 4px; padding: 0 20px;
    border-top: 1px solid var(--rule);
    background: linear-gradient(to top, rgba(0, 0, 0, 0.86), rgba(0, 0, 0, 0.5));
  }
  .rail ol { list-style: none; margin: 0; padding: 0; display: flex; flex: 1; justify-content: center; gap: 2px; overflow-x: auto; scrollbar-width: none; }
  .rail li button {
    position: relative; background: none; border: none; cursor: pointer; white-space: nowrap;
    padding: 12px 14px; font-size: 12.5px; color: var(--ink-3); transition: color 0.25s;
  }
  .rail li button::after {
    content: ''; position: absolute; left: 14px; right: 14px; bottom: 6px; height: 1px;
    background: var(--live); transform: scaleX(0); transform-origin: left;
    transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .rail li button:hover { color: var(--ink); }
  .rail li button.on { color: var(--ink); }
  .rail li button.on::after { transform: scaleX(1); }
  .arrow {
    background: none; border: 1px solid var(--rule); width: 36px; height: 36px; cursor: pointer;
    font-size: 14px; flex: none; transition: border-color 0.2s;
  }
  .arrow:hover:not(:disabled) { border-color: var(--ink); }
  .arrow:disabled { opacity: 0.3; cursor: default; }

  @media (prefers-reduced-motion: reduce) {
    .copy, .index, .inspector, .foot > polygon { animation: none; }
    .sky, .rail li button::after, .next { transition: none; }
    .dot, .pulse { animation: none; }
  }

  /* --- phones -------------------------------------------------------------- */
  @media (max-width: 767px) {
    .mast { left: 16px; top: 14px; max-width: calc(100vw - 150px); }
    .mast h1 { font-size: 16px; }
    .status { font-size: 10.5px; margin-top: 6px; }
    .long { display: none; }
    .short { display: revert; }
    .copy .next { position: sticky; bottom: 0; }
    .copy .source { margin-bottom: 4px !important; }
    .top-right { right: 14px; top: 14px; gap: 10px; }
    .prov { display: none; }
    .exit { padding: 7px 10px; font-size: 11px; }
    .copy {
      left: 16px; right: 16px; width: auto; bottom: 66px; max-height: 44vh;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.9) 60%, rgba(0, 0, 0, 0));
      padding-top: 28px;
    }
    .copy h2 { font-size: 26px; margin-bottom: 8px; }
    .copy p { font-size: 13.5px; }
    .stats { gap: 18px; margin-top: 12px; }
    .stats dd { font-size: 19px; }
    .synthetic { left: 16px; right: auto; top: 86px; bottom: auto; font-size: 10px; }
    .rail { height: 56px; padding: 0 8px; }
    .rail ol { justify-content: flex-start; }
    .rail li button { padding: 10px; font-size: 12px; }
    .arrow { width: 32px; height: 32px; }
    .inspector { left: 12px; right: 12px; top: auto; bottom: 64px; width: auto; max-height: 52vh; }
    .index { left: 12px; right: 12px; width: auto; top: 76px; bottom: 64px; }
  }
</style>
