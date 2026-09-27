<script lang="ts">
  /**
   * Satellite Designer.
   *
   * Describe a mission; a model picks hardware and the existing procedural
   * geometry pipeline renders it. The model never writes three.js — it emits a
   * parts list in the same shape as the hand-authored fleet, which means the
   * result is graded by the same analyze()/validate() the real vehicles are.
   * The checks panel is the app disagreeing with the design where the physics
   * does not close.
   */
  import { onDestroy } from 'svelte';
  import * as THREE from 'three';
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import MobileSheet from './shared/MobileSheet.svelte';
  import Slider from './shared/Slider.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { PART_BY_ID, CATS, analyze, validate, type Part } from '../data/spacecraft';
  import { buildPart, assemble } from '../data/spacecraft-geometry';
  import { makeSpaceEnvironment, configureRenderer, addSpacecraftLighting, makeGlintComposer } from '../scene/spacecraft-render';
  import { customToPart, SENTINEL, type Design } from '../data/design-parts';
  import { encodeDesign, decodeDesign } from '../data/design-share';
  import { loadHistory, saveDesign, removeDesign, type HistoryEntry } from '../data/design-history';
  import { track } from '@vercel/analytics';

  const EXAMPLES = [
    'Spots wildfires in their first ten minutes over the western US',
    'Tracks illegal fishing at night through cloud cover',
    'Relays messages for hikers with no cell coverage',
    'Measures methane leaks over oil and gas fields',
    'A 6U cubesat a university could actually afford to fly',
  ];

  type Tab = 'summary' | 'subsystems' | 'checks' | 'bom';

  let brief = $state('');
  let refine = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let design = $state<Design | null>(null);
  let dropped = $state(0);
  let elapsed = $state(0);
  let streamLog = $state('');
  let explode = $state(0);
  let deploy = $state(1);
  let selected = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let tab = $state<Tab>('summary');
  let dims = $state<[number, number, number] | null>(null);
  let shareLabel = $state('Share');
  let savedDesigns = $state<HistoryEntry[]>([]);
  /**
   * True while the on-screen design came from someone else's share link. A
   * visitor arriving that way is at the single highest-intent moment this app
   * gets — they are looking at a finished spacecraft someone thought worth
   * sending. Converting them into a maker there is worth more than any other
   * prompt in the product, so that state is tracked explicitly.
   */
  let fromShare = $state(false);
  let refineEl = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let shareTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A shared design arrives encoded in the URL, so opening a link reconstructs
   * the same spacecraft with no account and no database — the link is the
   * storage. Runs once at startup, then strips the parameter so a later reload
   * doesn't fight whatever the visitor has since designed.
   */
  async function loadFromUrl() {
    const encoded = new URLSearchParams(location.search).get('d');
    if (!encoded) return;
    const incoming = await decodeDesign(encoded);
    // window.history explicitly: a local named `history` silently shadows the
    // global and turns this into a TypeError that kills every share link.
    window.history.replaceState(null, '', location.pathname);
    if (!incoming) {
      error = 'That share link is malformed or from an older version.';
      uiStore.designerOpen = true;
      return;
    }
    design = incoming;
    dropped = 0;
    savedDesigns = saveDesign(incoming);
    track('design_opened_from_link', { mission: incoming.missionClass });
    fromShare = true;
    brief = incoming.missionClass;
    tab = 'summary';
    uiStore.designerOpen = true;
    uiStore.designerFocus++;
  }

  function openFromHistory(entry: HistoryEntry) {
    design = entry.design;
    dropped = 0;
    fromShare = false;
    error = null;
    selected = null;
    hovered = null;
    explode = 0;
    tab = 'summary';
    brief = `${entry.design.missionClass} — saved design`;
    track('design_reopened', { mission: entry.design.missionClass });
  }

  const relTime = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };

  /**
   * Suggestions rather than a blank box. A visitor who has just arrived has no
   * vocabulary for this domain yet, and "what would you change?" against an
   * empty field converts far worse than three concrete edits they can tap.
   */
  const REMIX_IDEAS = [
    'Make it cheaper to launch',
    'Add laser crosslinks',
    'Improve the resolution',
    'Fly it in a lower orbit',
  ];

  function remix(idea?: string) {
    fromShare = false;
    track('design_remixed', { mission: design?.missionClass, seeded: Boolean(idea) });
    if (idea) {
      refine = idea;
      generate(idea);
      return;
    }
    refineEl?.focus();
  }

  async function share() {
    if (!design) return;
    const url = `${location.origin}/s?d=${encodeURIComponent(await encodeDesign(design))}`;
    // navigator.share is the right affordance on a phone; clipboard is the
    // right one on a desktop. Both can reject (no permission, user dismissal),
    // so neither is allowed to throw into the UI.
    try {
      if (navigator.share && uiStore.isMobile) {
        await navigator.share({ title: `${design.name} — Orbital Works`, url });
        track('design_shared', { mission: design.missionClass, via: 'native' });
        return;
      }
      await navigator.clipboard.writeText(url);
      shareLabel = 'Link copied';
      track('design_shared', { mission: design.missionClass, via: 'clipboard' });
    } catch {
      shareLabel = 'Copy failed';
    }
    if (shareTimer) clearTimeout(shareTimer);
    shareTimer = setTimeout(() => (shareLabel = 'Share'), 2200);
  }

  /**
   * Library parts first, and the heaviest STRUCTURE part ahead of everything.
   * assemble() takes the first STRUCTURE it finds as the bus datum that every
   * other part is positioned against — if a 4 kg custom boom wins that race,
   * the whole vehicle is laid out around the wrong body.
   */
  const parts = $derived.by<Part[]>(() => {
    if (!design) return [];
    const lib = design.libraryParts.map((id) => PART_BY_ID[id]).filter((p): p is Part => !!p);
    const custom = design.customParts.map((c) => customToPart(c) as unknown as Part);
    const all = [...lib, ...custom];
    const structures = all.filter((p) => p.cat === 'STRUCTURE').sort((a, b) => (b.mass || 0) - (a.mass || 0));
    const bus = structures[0];
    return bus ? [bus, ...all.filter((p) => p !== bus)] : all;
  });

  const generatedIds = $derived(new Set((design?.customParts || []).map((c) => c.id)));
  const budget = $derived(parts.length ? analyze(parts) : null);
  const warnings = $derived(budget ? validate(parts, budget) : []);
  const errCount = $derived(warnings.filter((w) => w[0] === 'error').length);
  const grouped = $derived.by(() => {
    const g: Record<string, Part[]> = {};
    for (const p of parts) (g[p.cat] ||= []).push(p);
    return g;
  });
  const sel = $derived(selected ? parts.find((p) => p.id === selected) || null : null);
  const hov = $derived(hovered ? parts.find((p) => p.id === hovered) || null : null);

  /** Mass and power split by subsystem, largest first — where the budget actually goes. */
  const breakdown = $derived.by(() => {
    const rows = Object.entries(grouped).map(([cat, ps]) => ({
      cat,
      mass: ps.reduce((a, p) => a + (p.mass || 0), 0),
      load: ps.reduce((a, p) => a + (p.power < 0 ? -p.power : 0), 0),
      gen: ps.reduce((a, p) => a + (p.power > 0 ? p.power : 0), 0),
      n: ps.length,
    }));
    const maxMass = Math.max(1, ...rows.map((r) => r.mass));
    const maxPow = Math.max(1, ...rows.map((r) => Math.max(r.load, r.gen)));
    return { rows: rows.sort((a, b) => b.mass - a.mass), maxMass, maxPow };
  });

  async function generate(instruction?: string) {
    const base = brief.trim();
    if (!base || busy) return;
    busy = true;
    error = null;
    streamLog = '';
    if (!instruction) {
      design = null;
      dims = null;
    }
    selected = null;
    hovered = null;
    explode = 0;
    elapsed = 0;
    const t0 = Date.now();
    timer = setInterval(() => (elapsed = (Date.now() - t0) / 1000), 100);
    try {
      const res = await fetch('/api/design', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: base,
          ...(instruction && design ? { previous: design, instruction } : {}),
        }),
      });
      if (res.status === 403 || res.status === 429) {
        // The WAF rate limit denies with 403 and returns its own HTML page, so
        // catch it before we surface a block of markup as an error message.
        throw new Error('Rate limited — 10 designs per hour. Each one costs real tokens. Try again shortly.');
      }
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        const clean = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        throw new Error(clean.slice(0, 160) || `Request failed (${res.status})`);
      }

      // Everything before the NUL sentinel is display-only model text; the
      // server-validated payload follows it.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const i = buf.indexOf(SENTINEL);
        streamLog = (i === -1 ? buf : buf.slice(0, i)).slice(-2200);
      }
      const i = buf.indexOf(SENTINEL);
      if (i === -1) throw new Error('The stream ended before the design was verified.');
      const data = JSON.parse(buf.slice(i + SENTINEL.length));
      if (data.error) throw new Error(data.error);
      design = data.design as Design;
      dropped = data.dropped || 0;
      refine = '';
      tab = 'summary';
      fromShare = false;
      savedDesigns = saveDesign(design);
      track('design_generated', {
        mission: design.missionClass,
        revision: Boolean(instruction),
        seconds: Math.round((Date.now() - t0) / 1000),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Generation failed.';
    } finally {
      if (timer) clearInterval(timer);
      timer = null;
      busy = false;
      streamLog = '';
    }
  }

  /* ---------------- three.js viewport ---------------- */
  let host = $state<HTMLDivElement | null>(null);
  let S: any = null;

  function init(el: HTMLDivElement) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 3000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    configureRenderer(renderer);
    // Without an environment the metals in these materials have nothing to
    // reflect and resolve to flat grey — this is what makes the hardware read
    // as metal rather than as painted plastic.
    scene.environment = makeSpaceEnvironment(renderer);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    // setSize(w, h, false) updates the drawing buffer but NOT the CSS size, so
    // without this the canvas lays out at buffer size — devicePixelRatio times
    // too large on any retina display, spilling out of the window.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'grab';

    addSpacecraftLighting(scene);
    const glint = makeGlintComposer(renderer, scene, camera);

    // One-metre reference grid, so the vehicle has a sense of scale.
    const grid = new THREE.GridHelper(20, 20, 0x2b4256, 0x1b2b38);
    (grid.material as any).transparent = true;
    (grid.material as any).opacity = 0.4;
    scene.add(grid);

    const model = new THREE.Group();
    scene.add(model);

    S = {
      scene, camera, renderer, model, el, grid,
      theta: 0.75, phi: 1.12, dist: 10, fit: 10, scaleRef: 1,
      explode: 0, explodeTarget: 0, deploy: 1, deployTarget: 1, dragging: false, moved: false,
      autorot: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ray: new THREE.Raycaster(), ptr: new THREE.Vector2(),
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      glint?.setSize(w, h);
    };
    resize();
    S.ro = new ResizeObserver(resize);
    S.ro.observe(el);

    const pick = (e: PointerEvent): string | null => {
      const r = renderer.domElement.getBoundingClientRect();
      S.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      S.ray.setFromCamera(S.ptr, camera);
      const hit = S.ray.intersectObjects(model.children, true)[0];
      if (!hit) return null;
      let o: any = hit.object;
      while (o && !o.userData?.partId) o = o.parent;
      return o?.userData?.partId ?? null;
    };

    let lx = 0, ly = 0;
    const down = (e: PointerEvent) => {
      S.dragging = true; S.moved = false; S.autorot = false; lx = e.clientX; ly = e.clientY;
      renderer.domElement.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!S.dragging) {
        if (e.target === renderer.domElement) hovered = pick(e);
        return;
      }
      if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) S.moved = true;
      S.theta -= (e.clientX - lx) * 0.006;
      S.phi = Math.max(0.12, Math.min(3.0, S.phi - (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
    };
    const up = (e: PointerEvent) => {
      // A click that never moved is a selection, not a camera drag.
      if (S.dragging && !S.moved && e.target === renderer.domElement) {
        const id = pick(e);
        selected = id && selected !== id ? id : null;
      }
      S.dragging = false;
      renderer.domElement.style.cursor = 'grab';
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      S.dist = Math.max(S.fit * 0.25, Math.min(S.fit * 3.2, S.dist * (1 + e.deltaY * 0.0012)));
    };
    const leave = () => (hovered = null);
    renderer.domElement.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    renderer.domElement.addEventListener('pointerleave', leave);
    S.cleanup = () => {
      renderer.domElement.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.domElement.removeEventListener('pointerleave', leave);
    };

    const clock = new THREE.Clock();
    const tick = () => {
      S.raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      if (S.autorot) S.theta += dt * 0.14;
      S.explode += ((S.explodeTarget || 0) - S.explode) * Math.min(1, dt * 7);
      S.deploy += ((S.deployTarget ?? 1) - S.deploy) * Math.min(1, dt * 3.5);
      if (!Number.isFinite(S.explode)) S.explode = S.explodeTarget || 0;
      if (!Number.isFinite(S.deploy)) S.deploy = S.deployTarget ?? 1;
      for (const p of model.children) {
        const u: any = p.userData;
        if (!u.base) continue;
        const k = S.explode * (0.55 + u.rank * 0.42) * S.scaleRef;
        p.position.set(u.base.x + u.dir.x * k, u.base.y + u.dir.y * k, u.base.z + u.dir.z * k);
        // Deployables retract along their long axis when stowed.
        if (u.deployable) p.scale.x = 0.05 + 0.95 * S.deploy;
      }
      camera.position.set(
        S.dist * Math.sin(S.phi) * Math.sin(S.theta),
        S.dist * Math.cos(S.phi),
        S.dist * Math.sin(S.phi) * Math.cos(S.theta),
      );
      camera.lookAt(0, 0, 0);
      if (glint) glint.composer.render(); else renderer.render(scene, camera);
    };
    tick();
  }

  function rebuild(list: Part[]) {
    if (!S) return;
    while (S.model.children.length) {
      const c = S.model.children.pop();
      c.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose());
      });
    }
    if (!list.length) { dims = null; return; }
    const { placed, bg } = assemble(list);
    for (const pl of placed) {
      const g = buildPart(pl.part, bg);
      g.position.copy(pl.pos);
      g.userData = {
        partId: pl.part.id, base: pl.pos.clone(),
        dir: new THREE.Vector3(pl.dir[0], pl.dir[1], pl.dir[2]), rank: pl.rank,
        deployable: (pl.part.geom as any)?.kind === 'wing',
      };
      S.model.add(g);
    }
    const box = new THREE.Box3().setFromObject(S.model);
    const size = box.getSize(new THREE.Vector3());
    dims = [size.x, size.y, size.z];
    const span = Math.max(size.x, size.y, size.z) || 3;
    S.scaleRef = Math.max(0.9, span * 0.16);
    S.fit = span * 1.6;
    S.dist = S.fit;
    S.grid.scale.setScalar(Math.max(0.25, span / 20));
    S.grid.position.y = -size.y / 2 - 0.4;
  }

  // Run once: a share link should open the designer even if the window is closed.
  let urlChecked = false;
  $effect(() => {
    if (urlChecked) return;
    urlChecked = true;
    savedDesigns = loadHistory();

    /**
     * First visit opens the Designer. Landing on a fifteen-window tracking
     * console gives a newcomer no hint that the thing they can actually make
     * something with is behind a dock icon. This fires once ever — the flag is
     * set immediately, so a returning visitor gets whatever layout they left,
     * and anyone arriving on a share link is handled by loadFromUrl() below.
     */
    try {
      if (!localStorage.getItem('orbital_seen')) {
        localStorage.setItem('orbital_seen', '1');
        if (!new URLSearchParams(location.search).get('d')) {
          // On desktop the Roman pane is the first thing a visitor sees
          // (see uiStore.romanOpen); the Designer stays one dock click away.
          if (uiStore.isMobile) uiStore.openMobileSheet('designer');
          track('first_run_designer_opened', { mobile: uiStore.isMobile });
        }
      }
    } catch {
      // Storage disabled — a visitor who can't be remembered simply gets the
      // app's default layout, which is the pre-existing behaviour.
    }

    loadFromUrl();
  });

  $effect(() => { if (host && !S) init(host); });
  $effect(() => { const list = parts; if (S) rebuild(list); });
  // Read the reactive value BEFORE the S guard. $effect only tracks state it
  // actually reads, and on the first run S is null because the viewport lives
  // inside {#if design} and has not mounted — so a guard-first version never
  // reads `explode`, never registers the dependency, and stays inert forever.
  $effect(() => { const v = explode; if (S) S.explodeTarget = v; });
  $effect(() => { const v = deploy; if (S) S.deployTarget = v; });
  $effect(() => {
    const id = selected ?? hovered;
    if (!S) return;
    for (const g of S.model.children) {
      const on = !id || g.userData.partId === id;
      g.traverse((o: any) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.userData.origOp === undefined) m.userData.origOp = m.opacity;
          m.opacity = on ? m.userData.origOp : m.userData.origOp * 0.18;
          m.transparent = m.opacity < 1;
        }
      });
    }
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (shareTimer) clearTimeout(shareTimer);
    if (!S) return;
    cancelAnimationFrame(S.raf);
    S.ro?.disconnect();
    S.cleanup?.();
    S.renderer.dispose();
  });

  const fmt = (n: number, d = 0) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
</script>

{#snippet designerContent()}
    <div class="dz">
      <div class="brief">
        <textarea
          bind:value={brief}
          placeholder="What should this satellite do?"
          rows="2"
          maxlength="600"
          disabled={busy}
          onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
        ></textarea>
        <div class="row">
          <button class="go" onclick={() => generate()} disabled={busy || !brief.trim()}>
            {busy ? `Designing ${elapsed.toFixed(1)}s` : design ? 'Redesign' : 'Design it'}
          </button>
          <span class="hint">{brief.length}/600 · ⌘↵</span>
        </div>
        {#if !design && !busy}
          <div class="chips">
            {#each EXAMPLES as ex}
              <button class="chip" onclick={() => { brief = ex; generate(); }}>{ex}</button>
            {/each}
          </div>
        {/if}
      </div>

      {#if savedDesigns.length}
        <div class="recent">
          <span class="rlbl">Your designs</span>
          <div class="rlist">
            {#each savedDesigns as h (h.id)}
              <div class="ritem" class:on={design?.name === h.design.name}>
                <button class="ropen" onclick={() => openFromHistory(h)} title={h.design.blurb}>
                  <span class="rname">{h.design.name}</span>
                  <span class="rwhen">{relTime(h.savedAt)}</span>
                </button>
                <button class="rdel" title="Remove" onclick={() => (savedDesigns = removeDesign(h.id))}>×</button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if error}<p class="err">{error}</p>{/if}

      {#if busy}
        <div class="stream">
          <div class="sh">
            <span class="pulse"></span>
            <span>Selecting hardware and closing the budgets…</span>
          </div>
          <pre>{streamLog || 'Waiting for the first token…'}</pre>
        </div>
      {/if}

      {#if design}
        {#if fromShare}
          <div class="shared">
            <div class="shead">Someone shared this spacecraft with you</div>
            <p class="sbody">Change anything and it becomes yours — the physics is re-checked either way.</p>
            <div class="sideas">
              {#each REMIX_IDEAS as idea}
                <button class="sidea" onclick={() => remix(idea)} disabled={busy}>{idea}</button>
              {/each}
              <button class="sidea own" onclick={() => remix()} disabled={busy}>Something else…</button>
            </div>
          </div>
        {/if}

        <div class="head">
          <b>{design.name}</b>
          <span class="op">{design.operator}</span>
        </div>
        <div class="sub">
          <span>{design.missionClass}</span>
          <span>{fmt(design.altKm)} km</span>
          <span>{fmt(design.incDeg, 1)}° incl</span>
          {#if dims}<span>{fmt(dims[0], 1)} × {fmt(dims[1], 1)} × {fmt(dims[2], 1)} m</span>{/if}
        </div>

        <div class="viewport" bind:this={host}>
          {#if hov || sel}
            <div class="tip">
              <b>{(hov || sel)?.name}</b>
              <span>{(hov || sel)?.spec}</span>
            </div>
          {/if}
          <div class="vhint">drag to orbit · scroll to zoom · click a part</div>
        </div>

        <div class="ctrl">
          <Slider
            label="Exploded" min={0} max={1} step={0.01}
            value={explode} display={Math.round(explode * 100) + '%'}
            oninput={(e: Event) => (explode = +(e.currentTarget as HTMLInputElement).value)}
          />
          <Slider
            label="Deployment" min={0} max={1} step={0.01}
            value={deploy} display={deploy > 0.98 ? 'deployed' : deploy < 0.02 ? 'stowed' : Math.round(deploy * 100) + '%'}
            oninput={(e: Event) => (deploy = +(e.currentTarget as HTMLInputElement).value)}
          />
        </div>

        <div class="tabs">
          {#each [['summary', 'Summary'], ['subsystems', 'Subsystems'], ['checks', `Checks${errCount ? ' ' + errCount : ''}`], ['bom', `Parts ${parts.length}`]] as [id, label]}
            <button class="tab" class:on={tab === id} class:alert={id === 'checks' && errCount > 0} onclick={() => (tab = id as Tab)}>{label}</button>
          {/each}
        </div>

        {#if tab === 'summary'}
          <p class="blurb">{design.blurb}</p>
          {#if budget}
            <div class="grid">
              <div class="cell"><span class="lbl">Launch mass</span><b>{fmt(budget.mass)} kg</b></div>
              <div class="cell"><span class="lbl">Generation</span><b>{fmt(budget.gen)} W</b></div>
              <div class="cell">
                <span class="lbl">Power margin</span>
                <b class:bad={budget.margin < 0}>{budget.margin >= 0 ? '+' : ''}{fmt(budget.margin)} W</b>
              </div>
              <div class="cell"><span class="lbl">Delta-v</span><b>{fmt(budget.dv)} m/s</b></div>
              <div class="cell"><span class="lbl">Downlink</span><b>{budget.down ? fmt(budget.down) + ' Mbps' : '—'}</b></div>
              <div class="cell"><span class="lbl">Per Falcon 9</span><b>{budget.perF9 || '—'}</b></div>
            </div>
          {/if}
          <div class="rationale">
            <span class="rl">Design rationale</span>
            <p>{design.rationale}</p>
          </div>
          {#if dropped > 0}
            <p class="note">{dropped} referenced component{dropped === 1 ? '' : 's'} did not exist and {dropped === 1 ? 'was' : 'were'} dropped.</p>
          {/if}
        {:else if tab === 'subsystems'}
          <div class="bars">
            {#each breakdown.rows as r}
              <div class="brow">
                <span class="bc">{r.cat}</span>
                <div class="btrack"><div class="bfill mass" style="width:{(r.mass / breakdown.maxMass) * 100}%"></div></div>
                <span class="bv">{fmt(r.mass, r.mass < 10 ? 1 : 0)} kg</span>
              </div>
              <div class="brow">
                <span class="bc dim">{r.gen > 0 ? 'generates' : 'draws'}</span>
                <div class="btrack">
                  <div class="bfill" class:gen={r.gen > 0} style="width:{(Math.max(r.gen, r.load) / breakdown.maxPow) * 100}%"></div>
                </div>
                <span class="bv">{fmt(Math.max(r.gen, r.load))} W</span>
              </div>
            {/each}
          </div>
        {:else if tab === 'checks'}
          {#if warnings.length}
            <div class="warns">
              {#each warnings as [sev, title, detail]}
                <div class="warn {sev}"><b>{title}</b><span>{detail}</span></div>
              {/each}
            </div>
          {:else}
            <p class="clean">Every check passes. Power closes, the bus carries the mass, and the subsystems it needs are present.</p>
          {/if}
        {:else}
          {#if sel}
            <div class="detail">
              <div class="dh">
                <span class="cat">{sel.cat}</span><b>{sel.name}</b>
                {#if generatedIds.has(sel.id)}<span class="gen">generated</span>{/if}
              </div>
              <p>{sel.note}</p>
              <div class="dm">
                <span>{fmt(sel.mass, sel.mass < 10 ? 1 : 0)} kg</span>
                <span>{sel.power > 0 ? '+' : ''}{fmt(sel.power)} W</span>
                <span>{sel.spec}</span>
              </div>
            </div>
          {/if}
          <div class="bom">
            {#each CATS.filter((c) => grouped[c]) as cat}
              <div class="cat-row"><span class="cn">{cat}</span></div>
              {#each grouped[cat] as p}
                <button
                  class="part"
                  class:on={selected === p.id}
                  onmouseenter={() => (hovered = p.id)}
                  onmouseleave={() => (hovered = null)}
                  onclick={() => (selected = selected === p.id ? null : p.id)}
                >
                  <span class="pn">{p.name}</span>
                  {#if generatedIds.has(p.id)}<span class="dot" title="Generated for this design"></span>{/if}
                  <span class="pm">{fmt(p.mass, p.mass < 10 ? 1 : 0)} kg</span>
                </button>
              {/each}
            {/each}
          </div>
        {/if}

        <div class="refine">
          <input
            bind:this={refineEl}
            bind:value={refine}
            placeholder="Revise it — “halve the mass”, “add laser crosslinks”"
            maxlength="200"
            disabled={busy}
            onkeydown={(e) => { if (e.key === 'Enter' && refine.trim()) generate(refine.trim()); }}
          />
          <button class="rgo" disabled={busy || !refine.trim()} onclick={() => generate(refine.trim())}>Revise</button>
          <button class="rgo share" onclick={share} title="Copy a link that rebuilds this design">{shareLabel}</button>
        </div>
      {/if}
    </div>
{/snippet}

<!--
  One content block, two shells. On a phone the Designer is a swipe-dismissable
  sheet reached from the nav; on a desktop it is a draggable window on the
  canvas. Same pattern the rest of the app already uses, so the Designer
  behaves like every other panel rather than being a special case.
-->
{#if uiStore.isMobile}
  <MobileSheet id="designer" title="Designer">
    {@render designerContent()}
  </MobileSheet>
{:else if uiStore.designerOpen}
  <DraggableWindow
    title="Designer"
    id="designer"
    bind:open={uiStore.designerOpen}
    focus={uiStore.designerFocus}
    initialX={360}
    initialY={90}
    noPad
  >
    {@render designerContent()}
  </DraggableWindow>
{/if}

<style>
  .dz { width: 420px; max-width: 100%; max-height: 76vh; overflow-y: auto; }
  @media (max-width: 768px) {
    /* The sheet owns the scroll container and the width; a fixed width and a
       second scroller inside it would fight the swipe-to-dismiss gesture. */
    .dz { width: 100%; max-height: none; overflow-y: visible; }
    .viewport { height: 46vh; }
    textarea { font-size: 16px; }  /* iOS zooms the page below 16px */
    .refine input { font-size: 16px; }
  }
  .brief { padding: 8px; border-bottom: 1px solid var(--border); }
  textarea {
    width: 100%; resize: vertical; background: var(--card-bg); color: var(--text);
    border: 1px solid var(--border); font: inherit; font-size: 11px; padding: 6px; line-height: 1.45;
  }
  textarea:focus { outline: none; border-color: var(--accent); }
  .row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; gap: 8px; }
  .go {
    background: var(--accent); color: var(--bg); border: none; padding: 5px 12px;
    font: inherit; font-size: 10px; text-transform: uppercase; letter-spacing: .1em;
    cursor: pointer; font-weight: bold;
  }
  .go:disabled { opacity: .45; cursor: default; }
  .hint { font-size: 9px; color: var(--text-ghost); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
  .chip {
    background: none; border: 1px solid var(--border); color: var(--text-dim);
    font: inherit; font-size: 9.5px; padding: 3px 6px; cursor: pointer; text-align: left;
  }
  .chip:hover { border-color: var(--accent); color: var(--text); }
  .err { padding: 8px; color: var(--danger); font-size: 10.5px; line-height: 1.5; }

  /* Saved designs. Present only when there are some, so a first-time visitor
     sees the prompt box and nothing else. */
  .recent { padding: 7px 8px; border-bottom: 1px solid var(--border); }
  .rlbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .rlist { display: flex; flex-direction: column; gap: 1px; margin-top: 4px; }
  .ritem { display: flex; align-items: stretch; border-radius: 7px; overflow: hidden; }
  .ritem:hover, .ritem.on { background: var(--card-bg); }
  .ropen {
    flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 7px;
    background: none; border: none; color: var(--text); font: inherit;
    font-size: 10.5px; padding: 4px 7px; cursor: pointer; text-align: left;
  }
  .ritem.on .rname { color: var(--accent); }
  .rname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rwhen { font-size: 9px; color: var(--text-ghost); flex: 0 0 auto; }
  .rdel {
    background: none; border: none; color: var(--text-ghost); font: inherit;
    font-size: 13px; line-height: 1; padding: 0 8px; cursor: pointer;
  }
  .rdel:hover { color: var(--danger); }

  .stream { padding: 8px; border-bottom: 1px solid var(--border); }
  .sh { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text-dim); margin-bottom: 5px; }
  .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
  .stream pre {
    margin: 0; max-height: 120px; overflow: hidden; font-size: 9px; line-height: 1.4;
    color: var(--text-ghost); white-space: pre-wrap; word-break: break-all;
    background: var(--card-bg); padding: 6px; border: 1px solid var(--border);
  }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; opacity: .7; } }

  /* Only ever shown to someone who arrived on another person's link. It is the
     one place in the app where a hard call to action is warranted. */
  .shared {
    padding: 9px 8px 10px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .shead { font-size: 10.5px; color: var(--accent); letter-spacing: .02em; }
  .sbody { font-size: 10px; line-height: 1.5; color: var(--text-dim); margin: 3px 0 7px; }
  .sideas { display: flex; flex-wrap: wrap; gap: 4px; }
  .sidea {
    background: var(--card-bg); border: 1px solid var(--border); border-radius: 7px;
    color: var(--text); font: inherit; font-size: 9.5px; padding: 4px 7px; cursor: pointer;
  }
  .sidea:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .sidea:disabled { opacity: .45; cursor: default; }
  .sidea.own { color: var(--text-ghost); }

  .head { display: flex; align-items: baseline; gap: 8px; padding: 8px 8px 2px; }
  .head b { font-size: 14px; }
  .op { font-size: 10px; color: var(--text-dim); }
  .sub { display: flex; gap: 10px; flex-wrap: wrap; padding: 0 8px 8px; font-size: 9.5px; color: var(--text-ghost); text-transform: uppercase; letter-spacing: .08em; }

  .viewport {
    height: 300px; position: relative; overflow: hidden;
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
    background: var(--card-bg);
  }
  .tip {
    position: absolute; top: 6px; left: 6px; z-index: 2; pointer-events: none;
    background: color-mix(in srgb, var(--bg) 82%, transparent); border: 1px solid var(--border);
    padding: 4px 7px; max-width: 78%;
  }
  .tip b { display: block; font-size: 10.5px; }
  .tip span { font-size: 9px; color: var(--text-dim); }
  .vhint { position: absolute; bottom: 5px; right: 7px; z-index: 2; pointer-events: none; font-size: 8.5px; color: var(--text-ghost); }
  .ctrl { padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }

  .tabs { display: flex; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .tab {
    flex: 1; background: none; border: none; border-right: 1px solid var(--border);
    color: var(--text-ghost); font: inherit; font-size: 9px; text-transform: uppercase;
    letter-spacing: .09em; padding: 6px 2px; cursor: pointer;
  }
  .tab:last-child { border-right: none; }
  .tab:hover { color: var(--text); }
  .tab.on { color: var(--accent); background: var(--card-bg); }
  .tab.alert { color: var(--danger); }

  .blurb { padding: 8px; font-size: 10.5px; line-height: 1.55; color: var(--text-dim); }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; border-top: 1px solid var(--border); }
  .cell { padding: 6px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .cell .lbl { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .cell b { font-size: 12.5px; }
  .cell b.bad { color: var(--danger); }

  .bars { padding: 8px; display: flex; flex-direction: column; gap: 3px; }
  .brow { display: grid; grid-template-columns: 88px 1fr 62px; align-items: center; gap: 7px; font-size: 9.5px; }
  .bc { text-transform: uppercase; letter-spacing: .06em; font-size: 8.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bc.dim { color: var(--text-ghost); text-transform: none; letter-spacing: 0; padding-left: 6px; }
  .btrack { height: 7px; background: var(--card-bg); border: 1px solid var(--border); }
  .bfill { height: 100%; background: var(--text-dim); }
  .bfill.mass { background: var(--accent); }
  .bfill.gen { background: var(--live, #4ec07a); }
  .bv { text-align: right; color: var(--text-ghost); }

  .warns { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .warn { font-size: 10px; line-height: 1.45; border-left: 2px solid var(--border); padding-left: 7px; }
  .warn b { display: block; }
  .warn span { color: var(--text-dim); }
  .warn.error { border-left-color: var(--danger); }
  .warn.error b { color: var(--danger); }
  .warn.warn { border-left-color: var(--warning); }
  .warn.warn b { color: var(--warning); }
  .clean { padding: 10px 8px; font-size: 10.5px; line-height: 1.5; color: var(--text-dim); }

  .rationale { padding: 6px 8px 8px; border-top: 1px solid var(--border); }
  .rl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .rationale p { font-size: 10.5px; line-height: 1.55; color: var(--text-dim); margin-top: 3px; }
  .note { padding: 0 8px 8px; font-size: 9.5px; color: var(--warning); }

  .detail { padding: 7px 8px; background: var(--card-bg); border-bottom: 1px solid var(--border); }
  .dh { display: flex; align-items: baseline; gap: 6px; }
  .cat { font-size: 8.5px; color: var(--text-ghost); letter-spacing: .1em; }
  .gen { font-size: 8.5px; color: var(--accent); text-transform: uppercase; letter-spacing: .08em; }
  .detail p { font-size: 10.5px; line-height: 1.5; color: var(--text-dim); margin: 4px 0; }
  .dm { display: flex; gap: 10px; font-size: 9.5px; color: var(--text-ghost); flex-wrap: wrap; }

  .bom { padding-bottom: 4px; }
  .cat-row { padding: 6px 8px 2px; }
  .cn { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .part {
    display: flex; align-items: center; gap: 6px; width: 100%; background: none;
    border: none; color: var(--text); font: inherit; font-size: 10.5px;
    padding: 3px 8px; cursor: pointer; text-align: left;
  }
  .part:hover, .part.on { background: var(--card-bg); }
  .pn { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm { color: var(--text-ghost); font-size: 9.5px; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }

  .refine { display: flex; gap: 5px; padding: 7px 8px; border-top: 1px solid var(--border); }
  .refine input {
    flex: 1; min-width: 0; background: var(--card-bg); color: var(--text);
    border: 1px solid var(--border); font: inherit; font-size: 10px; padding: 4px 6px;
  }
  .refine input:focus { outline: none; border-color: var(--accent); }
  .rgo {
    background: none; border: 1px solid var(--border); color: var(--text-dim);
    font: inherit; font-size: 9px; text-transform: uppercase; letter-spacing: .09em;
    padding: 4px 9px; cursor: pointer;
  }
  .rgo:hover:not(:disabled) { border-color: var(--accent); color: var(--text); }
  .rgo:disabled { opacity: .4; cursor: default; }
  .rgo.share { border-color: var(--live); color: var(--live); white-space: nowrap; }
  .rgo.share:hover { background: var(--card-bg); }
</style>
