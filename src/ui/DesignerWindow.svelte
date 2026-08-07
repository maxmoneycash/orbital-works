<script lang="ts">
  /**
   * Satellite Designer.
   *
   * Describe a mission; a model picks hardware and the existing procedural
   * geometry pipeline renders it. The model never writes three.js — it emits a
   * parts list in the same shape as the hand-authored fleet, which means the
   * result is graded by the same analyze()/validate() the real vehicles are.
   * The critique panel below is not cosmetic: it is the app disagreeing with
   * the design where the physics does not close.
   */
  import { onDestroy } from 'svelte';
  import * as THREE from 'three';
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import Slider from './shared/Slider.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import { PART_BY_ID, CATS, analyze, validate, type Part } from '../data/spacecraft';
  import { buildPart, assemble } from '../data/spacecraft-geometry';
  import { customToPart, type Design } from '../data/design-schema';

  const EXAMPLES = [
    'Spots wildfires in their first ten minutes over the western US',
    'Tracks illegal fishing at night through cloud cover',
    'Relays messages for hikers with no cell coverage',
    'Measures methane leaks over oil and gas fields',
    'A 6U cubesat a university could actually afford to fly',
  ];

  let brief = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let design = $state<Design | null>(null);
  let dropped = $state(0);
  let elapsed = $state(0);
  let explode = $state(0);
  let selected = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

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
  const grouped = $derived.by(() => {
    const g: Record<string, Part[]> = {};
    for (const p of parts) (g[p.cat] ||= []).push(p);
    return g;
  });
  const sel = $derived(selected ? parts.find((p) => p.id === selected) || null : null);

  async function generate() {
    const text = brief.trim();
    if (!text || busy) return;
    busy = true;
    error = null;
    design = null;
    selected = null;
    explode = 0;
    elapsed = 0;
    const t0 = Date.now();
    timer = setInterval(() => (elapsed = (Date.now() - t0) / 1000), 100);
    try {
      const res = await fetch('/api/design', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
      design = data.design as Design;
      dropped = data.dropped || 0;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Generation failed.';
    } finally {
      if (timer) clearInterval(timer);
      timer = null;
      busy = false;
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
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.cursor = 'grab';

    scene.add(new THREE.AmbientLight(0x4a6a86, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.1);
    sun.position.set(6, 8, 5);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x4e9fc0, 0.7);
    rim.position.set(-7, -3, -6);
    scene.add(rim);

    const model = new THREE.Group();
    scene.add(model);

    S = {
      scene, camera, renderer, model, el,
      theta: 0.75, phi: 1.12, dist: 10, fit: 10, scaleRef: 1,
      explode: 0, explodeTarget: 0, dragging: false,
      autorot: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    S.ro = new ResizeObserver(resize);
    S.ro.observe(el);

    let lx = 0, ly = 0;
    const down = (e: PointerEvent) => {
      S.dragging = true; S.autorot = false; lx = e.clientX; ly = e.clientY;
      renderer.domElement.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!S.dragging) return;
      S.theta -= (e.clientX - lx) * 0.006;
      S.phi = Math.max(0.12, Math.min(3.0, S.phi - (e.clientY - ly) * 0.006));
      lx = e.clientX; ly = e.clientY;
    };
    const up = () => { S.dragging = false; renderer.domElement.style.cursor = 'grab'; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      S.dist = Math.max(S.fit * 0.35, Math.min(S.fit * 3.2, S.dist * (1 + e.deltaY * 0.0012)));
    };
    renderer.domElement.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    S.cleanup = () => {
      renderer.domElement.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('wheel', wheel);
    };

    const clock = new THREE.Clock();
    const tick = () => {
      S.raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      if (S.autorot) S.theta += dt * 0.14;
      const et = S.explodeTarget || 0;
      S.explode += (et - S.explode) * Math.min(1, dt * 7);
      if (!Number.isFinite(S.explode)) S.explode = et;
      for (const p of model.children) {
        const u: any = p.userData;
        if (!u.base) continue;
        const k = S.explode * (0.55 + u.rank * 0.42) * S.scaleRef;
        p.position.set(u.base.x + u.dir.x * k, u.base.y + u.dir.y * k, u.base.z + u.dir.z * k);
      }
      camera.position.set(
        S.dist * Math.sin(S.phi) * Math.sin(S.theta),
        S.dist * Math.cos(S.phi),
        S.dist * Math.sin(S.phi) * Math.cos(S.theta),
      );
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
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
    if (!list.length) return;
    const { placed, bg } = assemble(list);
    for (const pl of placed) {
      const g = buildPart(pl.part, bg);
      g.position.copy(pl.pos);
      g.userData = {
        partId: pl.part.id, base: pl.pos.clone(),
        dir: new THREE.Vector3(pl.dir[0], pl.dir[1], pl.dir[2]), rank: pl.rank,
      };
      S.model.add(g);
    }
    const size = new THREE.Box3().setFromObject(S.model).getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) || 3;
    S.scaleRef = Math.max(0.9, span * 0.16);
    S.fit = span * 1.5;
    S.dist = S.fit;
  }

  $effect(() => { if (host && !S) init(host); });
  $effect(() => { const list = parts; if (S) rebuild(list); });
  $effect(() => { if (S) S.explodeTarget = explode; });
  $effect(() => {
    const id = selected;
    if (!S) return;
    for (const g of S.model.children) {
      const on = !id || g.userData.partId === id;
      g.traverse((o: any) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.userData.origOp === undefined) m.userData.origOp = m.opacity;
          m.opacity = on ? m.userData.origOp : m.userData.origOp * 0.22;
          m.transparent = m.opacity < 1;
        }
      });
    }
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (!S) return;
    cancelAnimationFrame(S.raf);
    S.ro?.disconnect();
    S.cleanup?.();
    S.renderer.dispose();
  });

  const fmt = (n: number, d = 0) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
</script>

{#if uiStore.designerOpen}
  <DraggableWindow
    title="Designer"
    id="designer"
    bind:open={uiStore.designerOpen}
    focus={uiStore.designerFocus}
    initialX={360}
    initialY={90}
    noPad
  >
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
          <button class="go" onclick={generate} disabled={busy || !brief.trim()}>
            {busy ? `Designing… ${elapsed.toFixed(1)}s` : 'Design it'}
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

      {#if error}
        <p class="err">{error}</p>
      {/if}

      {#if busy}
        <p class="working">
          Picking hardware from 84 catalogued components, then closing the mass and power budgets.
          Typically 20–40 seconds.
        </p>
      {/if}

      {#if design}
        <div class="head">
          <b>{design.name}</b>
          <span class="op">{design.operator}</span>
        </div>
        <div class="sub">
          <span>{design.missionClass}</span>
          <span>{fmt(design.altKm)} km</span>
          <span>{fmt(design.incDeg, 1)}° incl</span>
        </div>

        <div class="viewport" bind:this={host}></div>

        <div class="ctrl">
          <Slider
            label="Exploded" min={0} max={1} step={0.01}
            value={explode} display={Math.round(explode * 100) + '%'}
            oninput={(e: Event) => (explode = +(e.currentTarget as HTMLInputElement).value)}
          />
        </div>

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
          </div>
        {/if}

        {#if warnings.length}
          <div class="warns">
            {#each warnings as [sev, title, detail]}
              <div class="warn {sev}"><b>{title}</b><span>{detail}</span></div>
            {/each}
          </div>
        {/if}

        <div class="rationale">
          <span class="rl">Design rationale</span>
          <p>{design.rationale}</p>
        </div>

        {#if dropped > 0}
          <p class="note">{dropped} referenced component{dropped === 1 ? '' : 's'} did not exist and {dropped === 1 ? 'was' : 'were'} dropped.</p>
        {/if}

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
    </div>
  </DraggableWindow>
{/if}

<style>
  .dz { width: 340px; max-height: 70vh; overflow-y: auto; }
  .brief { padding: 8px; border-bottom: 1px solid var(--border); }
  textarea {
    width: 100%; resize: vertical; background: var(--card-bg); color: var(--text);
    border: 1px solid var(--border); font: inherit; font-size: 11px; padding: 6px;
    line-height: 1.45;
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
  .err { padding: 8px; color: var(--danger); font-size: 10.5px; }
  .working { padding: 8px; color: var(--text-dim); font-size: 10.5px; line-height: 1.5; }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 8px 8px 2px; }
  .head b { font-size: 13px; }
  .op { font-size: 10px; color: var(--text-dim); }
  .sub { display: flex; gap: 10px; padding: 0 8px 8px; font-size: 9.5px; color: var(--text-ghost); text-transform: uppercase; letter-spacing: .08em; }
  .viewport { height: 230px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .ctrl { padding: 6px 8px; }
  .blurb { padding: 4px 8px 8px; font-size: 10.5px; line-height: 1.5; color: var(--text-dim); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--border); }
  .cell { padding: 6px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .cell .lbl { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .cell b { font-size: 13px; }
  .cell b.bad { color: var(--danger); }
  .warns { padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; }
  .warn { font-size: 10px; line-height: 1.45; border-left: 2px solid var(--border); padding-left: 6px; }
  .warn b { display: block; }
  .warn span { color: var(--text-dim); }
  .warn.error { border-left-color: var(--danger); }
  .warn.error b { color: var(--danger); }
  .warn.warn { border-left-color: var(--warning); }
  .warn.warn b { color: var(--warning); }
  .rationale { padding: 6px 8px 8px; }
  .rl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-ghost); }
  .rationale p { font-size: 10.5px; line-height: 1.5; color: var(--text-dim); margin-top: 3px; }
  .note { padding: 0 8px 8px; font-size: 9.5px; color: var(--warning); }
  .detail { padding: 7px 8px; border-top: 1px solid var(--border); background: var(--card-bg); }
  .dh { display: flex; align-items: baseline; gap: 6px; }
  .cat { font-size: 8.5px; color: var(--text-ghost); letter-spacing: .1em; }
  .gen { font-size: 8.5px; color: var(--accent); text-transform: uppercase; letter-spacing: .08em; }
  .detail p { font-size: 10.5px; line-height: 1.5; color: var(--text-dim); margin: 4px 0; }
  .dm { display: flex; gap: 10px; font-size: 9.5px; color: var(--text-ghost); flex-wrap: wrap; }
  .bom { border-top: 1px solid var(--border); }
  .cat-row { padding: 5px 8px 2px; }
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
</style>
