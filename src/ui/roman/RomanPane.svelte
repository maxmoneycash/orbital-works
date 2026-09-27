<script lang="ts">
  import * as THREE from 'three';
  import DraggableWindow from '../shared/DraggableWindow.svelte';
  import MobileSheet from '../shared/MobileSheet.svelte';
  import { uiStore } from '../../stores/ui.svelte';
  import { timeStore } from '../../stores/time.svelte';
  import { epochToUnix, unixToEpoch } from '../../astro/epoch';
  import { RomanStage, type Pose, type PickHit } from '../../roman/stage';
  import { Exposure } from '../../roman/imaging';
  import { MissionSim, PHASES, PHASE_LABEL, type Phase } from '../../roman/sim';
  import { loadDeepSpace, span } from '../../roman/ephem';
  import { STOP_NOTES } from '../../roman/chapters';
  import { SUBSYSTEM, GROUPS, partLabel, type Subsystem } from '../../roman/catalog';
  import { PROVENANCE, PROVENANCE_TOTAL, type Tag } from '../../roman/dims';
  import { boundsOf } from '../../roman/model';

  type Mode = 'live' | 'optics' | 'parts';
  let mode = $state<Mode>('live');
  let host = $state<HTMLDivElement | null>(null);
  let insetEl = $state<HTMLCanvasElement | null>(null);
  let stage: RomanStage | null = null;
  let sim: MissionSim | null = null;
  let status = $state<'loading' | 'ready' | 'failed'>('loading');

  /** What the HUD shows, refreshed ten times a second rather than every frame. */
  let hud = $state({
    phase: 'slew' as Phase, progress: 0, target: '', survey: '', snr: 0, frames: 0, exposures: 0,
    distKm: 0, lightSec: 0, speed: 0, l2Km: 0 as number | null, sunEarthDeg: 0,
    contact: null as { name: string; agency: string; elev: number } | null,
    sent: 0, extrapolated: false, predictEnds: 0,
  });
  let earthTag = $state<{ x: number; y: number } | null>(null);
  let tag = $state<{ text: string; x: number; y: number } | null>(null);

  // Optics.
  let stops = $state<{ id: string; label: string; back: number; k: number }[]>([]);
  let stopIndex = $state(-1);
  let showCgi = $state(false);
  let traceRaf = 0;
  // Parts.
  let explode = $state(0);
  let cutaway = $state(false);
  let stowed = $state(false);
  let selSub = $state<string | null>(null);
  let selPart = $state<string | null>(null);
  const sel = $derived<Subsystem | null>(selSub ? SUBSYSTEM[selSub] ?? null : null);

  const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const grounded = PROVENANCE.PUB + PROVENANCE.DER;
  const TAG_NAME: Record<Tag, string> = {
    PUB: 'Published by NASA, L3Harris or peer review',
    DER: 'Derived from published figures',
    EST: 'Estimated; not yet grounded in a source',
  };

  const around = (target: THREE.Vector3, dist: number, theta: number, phi: number): Pose => ({ target, dist, theta, phi });

  /* ------------------------------------------------------------ lifecycle -- */

  function mount(el: HTMLDivElement) {
    const s = new RomanStage(el);
    stage = s;
    s.autorotate = !reducedMotion;
    s.onPick = (hit) => pick(hit);
    let last = performance.now();
    let hudClock = 0;
    s.onFrame = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!sim) return;
      const t = epochToUnix(timeStore.epoch) * 1000; // seconds → ms
      if (mode === 'live') {
        const before = sim.phase;
        sim.update(dt, t);
        if (sim.phase !== before) direct(sim.phase);
        if (sim.phase === 'expose' && !lookedIn && sim.phaseProgress > 0.42) lookIn();
      } else {
        // The geometry is real whatever the view; keep it current.
        sim.live = sim.geometry(t);
      }
      const e = s.earthOnScreen();
      earthTag = e.z < 1 && e.x > 0 && e.y > 0 && e.x < el.clientWidth && e.y < el.clientHeight ? { x: e.x, y: e.y } : null;
      if (tagAt) {
        const p = s.project(tagAt);
        if (tag) { tag.x = p.x; tag.y = p.y; }
      }
      if ((hudClock += dt) > 0.1) { hudClock = 0; refreshHud(); }
    };
    s.onResize = () => { if (sim) sim.setExposure(makeExposure(s)); };
    Promise.all([s.ready, loadDeepSpace()]).then(([, ds]) => {
      if (stage !== s) return;
      stops = (s.light?.stops.map((st, k) => ({ id: st.id, label: st.label, back: st.back, k })) ?? []).reverse();
      sim = new MissionSim(s, makeExposure(s), ds);
      status = 'ready';
      direct('slew', true);
    }).catch(() => { if (stage === s) status = 'failed'; });
    return {
      destroy() {
        cancelAnimationFrame(traceRaf);
        sim?.dispose();
        sim = null;
        s.dispose();
        if (stage === s) stage = null;
      },
    };
  }

  /** The exposure's canvas matches the stage's own screen, at up to 420 px wide. */
  function makeExposure(s: RomanStage) {
    const W = s.host.clientWidth || 520, H = s.host.clientHeight || 340;
    const k = Math.min(1, 420 / W);
    return new Exposure(s.detectorOutlines(s.mosaicPose()), Math.round(W * k), Math.round(H * k), { scale: k });
  }

  /* ------------------------------------------------------------ direction -- */

  let lookedIn = false;
  const fp = () => boundsOf(stage!.model!.detectors).getCenter(new THREE.Vector3());

  /** Camera and cutaway for each phase of the live cycle. */
  function direct(phase: Phase, first = false) {
    const s = stage;
    if (!s?.model || mode !== 'live') return;
    tagAt = null; tag = null;
    s.explodeGoal = 0;
    s.deployGoal = { liss: 1, sass: 1, hga: 1, dac: 1 };
    s.focus = null;
    s.solo = null;
    s.sunGoal = 0;
    if (phase === 'slew') {
      lookedIn = false;
      s.cutGoal = 0;
      s.hiddenParts = [];
      s.autorotate = !reducedMotion;
      const wide = s.shot('overview');
      wide.dist *= 0.92;
      s.fly([wide], first ? 0 : 3.2);
    } else if (phase === 'expose') {
      // Into the barrel: the light arriving through the optics.
      s.autorotate = false;
      s.cutGoal = 1;
      s.hiddenParts = ['WFI.Body'];
      s.fly([s.shot('optics')], 2.6);
      showTag('Starlight in', s.light!.stopPoints[1]);
    }
  }

  /** Halfway through the exposure: down onto the detectors, where the image is forming. */
  function lookIn() {
    const s = stage;
    if (!s?.model) return;
    lookedIn = true;
    const c = fp();
    s.fly([around(c.clone().setY(c.y + 0.25), 1.55, 0.6, 0.85)], 3.0);
    showTag('18 detectors, integrating', c);
  }

  let tagAt: THREE.Vector3 | null = null;
  function showTag(text: string, at: THREE.Vector3) {
    tagAt = at.clone();
    tag = { text, x: -999, y: -999 };
  }

  function refreshHud() {
    const m = sim;
    if (!m?.live) return;
    const L = m.live;
    hud.phase = m.phase;
    hud.progress = m.phaseProgress;
    hud.target = m.target.name;
    hud.survey = m.target.survey;
    hud.snr = m.exposure.frames ? m.exposure.snr : 0;
    hud.frames = m.exposure.frames;
    hud.exposures = m.exposures;
    hud.distKm = L.distKm;
    hud.lightSec = L.lightSec;
    hud.speed = L.speedKmS;
    hud.l2Km = L.l2Km;
    hud.sunEarthDeg = (L.sunEarth * 180) / Math.PI;
    hud.contact = L.contact ? { name: L.contact.st.name, agency: L.contact.st.agency, elev: (L.contact.elev * 180) / Math.PI } : null;
    hud.sent = m.sentGB;
    hud.extrapolated = L.extrapolated;
    hud.predictEnds = L.predictEnds;
    // The inset: the mosaic, cropped out of the projection canvas.
    const g = insetEl?.getContext('2d');
    if (g && insetEl) {
      const b = m.exposure.bounds;
      g.imageSmoothingEnabled = true;
      g.fillStyle = '#000';
      g.fillRect(0, 0, insetEl.width, insetEl.height);
      const k = Math.min(insetEl.width / b.w, insetEl.height / b.h);
      const w = b.w * k, h = b.h * k;
      g.drawImage(m.exposure.canvas, b.x, b.y, b.w, b.h, (insetEl.width - w) / 2, (insetEl.height - h) / 2, w, h);
    }
  }

  /* --------------------------------------------------------------- modes -- */

  function setMode(m: Mode) {
    if (m === mode) return;
    mode = m;
    const s = stage;
    if (!s?.model) return;
    cancelAnimationFrame(traceRaf);
    tagAt = null; tag = null;
    s.autorotate = false;
    if (m === 'live') {
      clearSelection();
      sim?.resume();
      direct('slew');
    } else if (m === 'optics') {
      s.explodeGoal = 0;
      s.cutGoal = 1;
      s.hiddenParts = ['WFI.Body'];
      s.skyGainGoal = 0.3;
      s.focus = null;
      s.fly([s.shot('optics')], 2.2);
      trace();
    } else {
      applyParts();
      s.skyGainGoal = 0;
      s.lightGoal = { progress: s.light?.length ?? 0, opacity: 0, cgi: false };
      s.fly([s.shot('explore')], 2.2);
      s.autorotate = !reducedMotion;
    }
  }

  /** Trace the beam from the detectors back out to the aperture, a stop at a time. */
  function trace() {
    const s = stage;
    if (!s?.light || !stops.length) return;
    cancelAnimationFrame(traceRaf);
    const L = s.light, n = stops.length - 1;
    const t0 = performance.now(), dur = reducedMotion ? 0.01 : 9;
    s.lightGoal = { progress: 0, opacity: 1, cgi: showCgi };
    const step = () => {
      if (mode !== 'optics') return;
      const x = Math.min(1, (performance.now() - t0) / 1000 / dur) * n;
      const i = Math.min(n - 1, Math.floor(x)), u = x - i;
      s.lightGoal.progress = x >= n ? L.length : stops[i].back + (stops[i + 1].back - stops[i].back) * u;
      const k = Math.floor(x + 1e-6);
      if (k !== stopIndex) {
        stopIndex = k;
        showTag(stops[k].label, L.stopPoints[stops[k].k]);
      }
      if (x < n) traceRaf = requestAnimationFrame(step);
    };
    traceRaf = requestAnimationFrame(step);
  }

  $effect(() => {
    void showCgi;
    if (mode === 'optics' && stage) {
      stage.lightGoal.cgi = showCgi;
      stage.focus = showCgi ? new Set(['TEL.TertiaryCollimatorAssembly', 'CORONAGRAPH_INSTRUMENT']) : null;
      stage.hiddenParts = showCgi ? ['WFI.Body', 'TOMA.Structure'] : ['WFI.Body'];
    }
  });

  function applyParts() {
    const s = stage;
    if (!s) return;
    s.explodeGoal = explode;
    s.cutGoal = cutaway ? 1 : 0;
    s.hiddenParts = cutaway ? ['WFI.Body'] : [];
    const d = stowed ? 0 : 1;
    s.deployGoal = { liss: d, sass: d, hga: d, dac: d };
  }

  $effect(() => {
    void [explode, cutaway, stowed];
    if (mode === 'parts') applyParts();
  });

  function pick(hit: PickHit | null) {
    const s = stage;
    if (!s || mode !== 'parts') return;
    if (!hit || hit.part === selPart) clearSelection();
    else { selPart = hit.part; selSub = hit.subsystem; }
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
    if (selSub) {
      const meshes = s.model.bySubsystem.get(selSub) ?? [];
      if (meshes.length) s.fly([s.shotOf(meshes)], 1.6);
    }
  }

  function clearSelection() {
    selPart = null; selSub = null;
    if (stage) { stage.selectedPart = null; stage.selectedSubsystem = null; }
  }

  /* -------------------------------------------------------------- replay -- */

  /**
   * The flight so far, replayed on the globe: out to Roman framed for where
   * it is now, the clock back to just after launch, then a slow warp forward
   * to the present while the track draws itself out toward L2.
   */
  let replaying = $state(false);
  async function replay() {
    const ds = await loadDeepSpace();
    const now = epochToUnix(timeStore.epoch) * 1000;
    const start = span(ds, 'roman')[0];
    if (now <= start + 3_600_000 || replaying) return;
    replaying = true;
    uiStore.onShowRoman?.({ at: now });
    timeStore.epoch = unixToEpoch(start / 1000);
    setTimeout(() => {
      timeStore.warpToEpoch(unixToEpoch(now / 1000), reducedMotion ? 1 : 22);
      setTimeout(() => (replaying = false), reducedMotion ? 1500 : 22_500);
    }, reducedMotion ? 0 : 2200);
  }

  /* ------------------------------------------------------------- display -- */

  const km = (n: number) => Math.round(n).toLocaleString('en-US');
  const mkm = (n: number) => (n / 1e6).toFixed(n < 1e6 ? 3 : 2) + ' million km';
</script>

{#snippet prov(t: Tag)}<abbr class="t {t}" title={TAG_NAME[t]}>{t}</abbr>{/snippet}

<!-- One content block, two shells: a sheet on phones, a draggable pane on desktop. -->
{#if uiStore.isMobile}
  <MobileSheet id="roman" title="Roman Space Telescope">{@render content()}</MobileSheet>
{:else if uiStore.romanOpen}
  <DraggableWindow title="Roman Space Telescope" id="roman" bind:open={uiStore.romanOpen} focus={uiStore.romanFocus} initialX={9999} initialY={336} noPad>
    {@render content()}
  </DraggableWindow>
{/if}

{#snippet content()}
    <div class="rp">
      <div class="view">
        <div class="stage" use:mount bind:this={host}></div>

        {#if status !== 'ready'}
          <div class="loading">{status === 'failed' ? 'The observatory model failed to load.' : 'Loading the observatory…'}</div>
        {/if}

        {#if earthTag}
          <div class="earth" style:translate="{earthTag.x}px {earthTag.y}px"><i></i><span>Earth · {mkm(hud.distKm)}</span></div>
        {/if}
        {#if tag && tag.x > -900}
          <div class="tag" style:translate="{tag.x}px {tag.y}px"><i></i><span>{tag.text}</span></div>
        {/if}

        <div class="top">
          <p class="state"><span class="dot" aria-hidden="true"></span>
            {hud.extrapolated ? 'Near L2' : hud.l2Km !== null && hud.l2Km < 400_000 ? 'Arriving at L2' : 'En route to L2'} · commissioning</p>
          <div class="modes" role="tablist" aria-label="View">
            {#each [['live', 'Live'], ['optics', 'Optics'], ['parts', 'Parts']] as [m, label]}
              <button role="tab" aria-selected={mode === m} class:on={mode === m} onclick={() => setMode(m as Mode)}>{label}</button>
            {/each}
          </div>
        </div>

        {#if mode === 'live'}
          <div class="bottom">
            <div class="cycle">
              <ol class="phases">
                {#each PHASES as p}
                  <li class:on={hud.phase === p} class:done={PHASES.indexOf(p) < PHASES.indexOf(hud.phase)}>
                    {PHASE_LABEL[p]}
                    {#if hud.phase === p}<i style:transform="scaleX({hud.progress})"></i>{/if}
                  </li>
                {/each}
              </ol>
              <p class="target"><b>{hud.target}</b><span>{hud.survey}</span></p>
            </div>
            <figure class="inset">
              <canvas bind:this={insetEl} width="220" height="112"></canvas>
              <figcaption>
                {#if hud.phase === 'expose'}S/N {hud.snr.toFixed(1)} · {hud.frames} frames
                {:else if hud.phase === 'readout'}Reading out
                {:else}Exposure {hud.exposures + 1}{/if}
              </figcaption>
            </figure>
          </div>
        {/if}
      </div>

      <!-- Real, now: from the ephemeris and Earth's rotation at the app's clock. -->
      <dl class="tele">
        <div><dt>From Earth</dt><dd>{km(hud.distKm)} km</dd></div>
        <div><dt>Signal delay</dt><dd>{hud.lightSec.toFixed(2)} s</dd></div>
        <div><dt>Speed</dt><dd>{hud.speed.toFixed(3)} km/s</dd></div>
        <div><dt>From L2</dt><dd>{hud.l2Km === null ? '—' : km(hud.l2Km) + ' km'}</dd></div>
      </dl>

      <div class="link" class:up={!!hud.contact}>
        <span class="led" aria-hidden="true"></span>
        {#if hud.contact}
          <p><b>Ka-band 26 GHz → {hud.contact.name}</b><span>{hud.contact.agency} · Roman {hud.contact.elev.toFixed(0)}° above the horizon · up to 500 Mb/s</span></p>
        {:else}
          <p><b>No ground station in view</b><span>White Sands, New Norcia and Misasa are all below Roman’s horizon; the recorder holds the data</span></p>
        {/if}
        <p class="rec">
          {#if hud.contact}At that rate, {hud.sent.toFixed(2)} GB would have come down since you opened this.
          {:else}Between contacts, data waits on the 4 TB science data recorder.{/if}
        </p>
      </div>

      {#if mode === 'optics'}
        <div class="panel">
          <ol class="stops">
            {#each stops as st, k}
              <li class:done={k < stopIndex} class:now={k === stopIndex}>{st.label}</li>
            {/each}
          </ol>
          <p class="note">{#if stops[stopIndex]}<b>{stops[stopIndex].label}.</b> {STOP_NOTES[stops[stopIndex].id]}{/if}</p>
          <div class="row">
            <button class="ghost" onclick={trace}>Trace the light again</button>
            <label class="check"><input type="checkbox" bind:checked={showCgi} /> Coronagraph path</label>
          </div>
        </div>
      {:else if mode === 'parts'}
        <div class="panel">
          <div class="row">
            <label class="slider">Exploded <input type="range" min="0" max="1" step="0.01" bind:value={explode} /></label>
            <label class="check"><input type="checkbox" bind:checked={cutaway} /> Cutaway</label>
            <label class="check"><input type="checkbox" bind:checked={stowed} /> Launch configuration</label>
          </div>
          {#if sel}
            <div class="ins">
              <div class="ins-head">
                <h3>{selPart ? partLabel(selPart) : sel.label}</h3>
                <button class="x" onclick={clearSelection} aria-label="Close details">
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                </button>
              </div>
              <p class="blurb">{sel.blurb}</p>
              {#if sel.facts.length}
                <table><tbody>
                  {#each sel.facts as f}
                    <tr title={f.note}><th scope="row">{f.label}</th><td>{f.value}</td><td class="tc">{@render prov(f.tag)}</td></tr>
                  {/each}
                </tbody></table>
              {/if}
            </div>
          {:else}
            <nav class="index" aria-label="Parts">
              {#each GROUPS as [group, ids]}
                <h3>{group}</h3>
                {#each ids as id}<button class="part" onclick={() => selectSubsystem(id)}>{SUBSYSTEM[id].label}</button>{/each}
              {/each}
            </nav>
          {/if}
          <p class="fine">{grounded} of {PROVENANCE_TOTAL} dimensions in the model are published or derived; the rest are estimated.</p>
        </div>
      {/if}

      <footer>
        <p>Position and stations: JPL Horizons, live{hud.extrapolated ? ` (held at the predict’s end, ${new Date(hud.predictEnds).toUTCString().slice(5, 16)})` : ''}. Observing cycle simulated on synthetic fields; science begins early 2027.</p>
        <div class="acts">
        <button class="ghost" onclick={replay} disabled={replaying}>{replaying ? 'Replaying…' : 'Replay the flight'}</button>
        <button class="cta" onclick={() => uiStore.onShowRoman?.()}>
          See it in orbit
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" /></svg>
        </button>
        </div>
      </footer>
    </div>
{/snippet}

<style>
  .rp {
    --ink: #f2f1ec;
    --ink-2: rgba(242, 241, 236, 0.72);
    --ink-3: rgba(242, 241, 236, 0.46);
    --rule: rgba(242, 241, 236, 0.14);
    --est: #ffae4a;
    width: min(520px, calc(100vw - 24px));
    background: #000;
    color: var(--ink);
    font-family: 'Overpass Mono', ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.45;
  }
  .rp button { font: inherit; color: inherit; }
  .rp :focus-visible { outline: 1px solid var(--live); outline-offset: 2px; }

  .view { position: relative; height: 262px; overflow: hidden; border-bottom: 1px solid var(--rule); }
  .stage { position: absolute; inset: 0; }
  .loading { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-3); font-size: 11px; }

  .earth, .tag {
    position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap; font-size: 10.5px;
    display: flex; align-items: center; gap: 8px;
  }
  .earth i, .tag i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; margin: 0 0 0 -2.5px; flex: none; }
  .earth span, .tag span { padding: 1px 6px; background: rgba(0, 0, 0, 0.62); border: 1px solid var(--rule); }
  .earth { color: #9cc4ff; }
  .tag { color: var(--ink); }

  .top {
    position: absolute; left: 0; right: 0; top: 0; padding: 9px 10px;
    display: flex; justify-content: space-between; align-items: center; gap: 10px;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));
  }
  .state { margin: 0; display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--ink-2); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--live); box-shadow: 0 0 8px var(--live); animation: breathe 2.6s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: 0.35; } }
  .modes { display: flex; border: 1px solid var(--rule); }
  .modes button { background: rgba(0, 0, 0, 0.5); border: none; padding: 4px 10px; font-size: 11px; color: var(--ink-3); cursor: pointer; }
  .modes button + button { border-left: 1px solid var(--rule); }
  .modes button.on { color: #000; background: var(--live); }

  .bottom {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 10px;
    display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0));
  }
  .phases { list-style: none; margin: 0 0 6px; padding: 0; display: flex; gap: 2px; }
  .phases li { position: relative; padding: 3px 7px 4px; font-size: 10.5px; color: var(--ink-3); border-bottom: 1px solid var(--rule); }
  .phases li.done { color: var(--ink-2); }
  .phases li.on { color: var(--ink); }
  .phases li i { position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--live); transform-origin: left; }
  .target { margin: 0; display: grid; gap: 1px; }
  .target b { font-weight: 600; font-size: 13px; }
  .target span { font-size: 10.5px; color: var(--ink-2); }
  .inset { margin: 0; display: grid; gap: 3px; justify-items: end; }
  .inset canvas { width: 200px; height: 102px; display: block; border: 1px solid var(--rule); background: #000; image-rendering: auto; }
  .inset figcaption { font-size: 10px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .tele { margin: 0; display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--rule); }
  .tele div { padding: 6px 10px; display: grid; gap: 0; }
  .tele div + div { border-left: 1px solid var(--rule); }
  .tele dt { font-size: 10px; color: var(--ink-3); }
  .tele dd { margin: 0; font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .link { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; padding: 7px 10px; border-bottom: 1px solid var(--rule); align-items: start; }
  .led { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; border: 1px solid var(--ink-3); }
  .link.up .led { background: var(--live); border-color: var(--live); box-shadow: 0 0 8px var(--live); animation: breathe 1.2s ease-in-out infinite; }
  .link p { margin: 0; display: grid; gap: 1px; }
  .link b { font-weight: 500; }
  .link p span { font-size: 10.5px; color: var(--ink-2); }
  .rec { grid-column: 2; margin: 0; font-size: 10.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .panel { padding: 10px; border-bottom: 1px solid var(--rule); max-height: 240px; overflow: auto; scrollbar-width: thin; }
  .row { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
  .stops { list-style: none; margin: 0 0 8px; padding: 0; display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: column; grid-template-rows: repeat(5, auto); column-gap: 14px; }
  .stops li { font-size: 11.5px; color: var(--ink-3); padding: 1px 0 1px 12px; position: relative; }
  .stops li::before { content: ''; position: absolute; left: 0; top: 9px; width: 6px; height: 1px; background: currentColor; }
  .stops li.done { color: var(--ink-2); }
  .stops li.now { color: var(--live); }
  .note { margin: 0 0 8px; min-height: 3em; font-size: 11.5px; color: var(--ink); }
  .note b { color: var(--live); font-weight: 500; }
  .ghost { background: none; border: 1px solid var(--rule); padding: 5px 10px; font-size: 11px; cursor: pointer; }
  .ghost:hover { border-color: var(--ink); }
  .check, .slider { display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
  .check input, .slider input { accent-color: var(--live); margin: 0; }
  .slider input { width: 110px; }
  .index { margin-top: 8px; columns: 2; column-gap: 14px; }
  .index h3 { margin: 8px 0 2px; font-size: 10.5px; font-weight: 500; color: var(--ink-3); break-after: avoid; }
  .part { display: block; width: 100%; text-align: left; background: none; border: none; padding: 2px 0 2px 8px; font-size: 11.5px; color: var(--ink-2); cursor: pointer; border-left: 1px solid transparent; break-inside: avoid; }
  .part:hover { color: var(--ink); border-left-color: var(--live); }
  .ins { margin-top: 10px; }
  .ins-head { display: flex; justify-content: space-between; align-items: start; }
  .ins h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  .x { background: none; border: none; padding: 3px; cursor: pointer; color: var(--ink-3); }
  .x:hover { color: var(--ink); }
  .blurb { margin: 6px 0 8px; font-size: 11.5px; color: var(--ink-2); }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; font-weight: 400; color: var(--ink-3); padding: 3px 0; }
  td { text-align: right; padding: 3px 0 3px 8px; font-variant-numeric: tabular-nums; }
  td.tc { width: 30px; }
  tr + tr th, tr + tr td { border-top: 1px solid rgba(242, 241, 236, 0.06); }
  .t { font-size: 9.5px; letter-spacing: 0.06em; font-weight: 500; text-decoration: none; cursor: help; }
  .t.PUB { color: var(--live); }
  .t.DER { color: var(--ink-2); }
  .t.EST { color: var(--est); }
  .fine { margin: 10px 0 0; font-size: 10px; color: var(--ink-3); }

  footer { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; justify-content: space-between; padding: 7px 10px; }
  footer p { margin: 0; font-size: 10px; color: var(--ink-3); flex: 1 1 100%; }
  footer .acts { margin-left: auto; }
  .cta {
    flex: none; display: inline-flex; gap: 10px; align-items: center; white-space: nowrap; cursor: pointer;
    background: var(--live); color: #000 !important; border: none; padding: 8px 12px; font-weight: 600; font-size: 11.5px;
  }
  .cta:hover { box-shadow: 0 6px 20px -8px var(--live); }
  .acts { flex: none; display: flex; gap: 6px; }
  .ghost:disabled { color: var(--ink-3); cursor: default; }

  @media (prefers-reduced-motion: reduce) {
    .dot, .link.up .led { animation: none; }
  }
  @media (max-width: 600px) {
    .view { height: 260px; }
    .tele { grid-template-columns: repeat(2, 1fr); }
    .tele div:nth-child(3) { border-left: none; }
    .tele div:nth-child(n + 3) { border-top: 1px solid var(--rule); }
    .inset canvas { width: 160px; height: 82px; }
    footer { flex-direction: column; align-items: stretch; }
  }
</style>
