<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as THREE from 'three';
  import DraggableWindow from './shared/DraggableWindow.svelte';
  import Select from './shared/Select.svelte';
  import Slider from './shared/Slider.svelte';
  import { uiStore } from '../stores/ui.svelte';
  import {
    FLEET, PART_BY_ID, CATS, analyze, type Part,
  } from '../data/spacecraft';
  import { buildPart, assemble } from '../data/spacecraft-geometry';

  function guessCraft(name: string): string {
    const n = name.toUpperCase();
    if (n.includes('STARLINK')) return 'sl-v2mini';
    if (n.includes('ONEWEB')) return 'ow-g1';
    if (n.includes('ICEYE')) return 'iceye-x';
    if (n.includes('FLOCK') || n.includes('DOVE')) return 'planet-dove';
    if (n.includes('SENTINEL-2')) return 'sentinel-2';
    if (n.includes('NAVSTAR') || n.includes('GPS')) return 'gps-iii';
    if (n.includes('BLUEBIRD')) return 'ast-bb2';
    if (n.includes('WORLDVIEW') || n.includes('LEGION')) return 'legion';
    return 'sl-v2mini';
  }

  let manual = $state<string | null>(null);
  let explode = $state(0);
  let selected = $state<string | null>(null);

  const tracked = $derived(uiStore.selectedSatData.length ? uiStore.selectedSatData[0] : null);
  const craftId = $derived(manual ?? (tracked ? guessCraft(tracked.name) : 'sl-v2mini'));
  const craft = $derived(FLEET.find((f) => f.id === craftId)!);
  const parts = $derived(craft.parts.map((id) => PART_BY_ID[id]).filter((p): p is Part => !!p));
  const budget = $derived(analyze(parts));
  const grouped = $derived.by(() => {
    const g: Record<string, Part[]> = {};
    for (const p of parts) (g[p.cat] ||= []).push(p);
    return g;
  });
  const sel = $derived(selected ? PART_BY_ID[selected] : null);

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
    // setSize(w, h, false) updates the drawing buffer but NOT the CSS size, so
    // without this the canvas lays out at buffer size — devicePixelRatio times
    // too large on any retina display.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
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

  $effect(() => {
    if (host && !S) init(host);
  });
  $effect(() => {
    const list = parts;
    if (S) rebuild(list);
  });
  // Reactive read before the S guard — see DesignerWindow. Works today only
  // because init() happens to run first; one markup change would break it.
  $effect(() => {
    const v = explode;
    if (S) S.explodeTarget = v;
  });
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
    if (!S) return;
    cancelAnimationFrame(S.raf);
    S.ro?.disconnect();
    S.cleanup?.();
    S.renderer.dispose();
  });

  const fmt = (n: number, d = 0) =>
    Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
</script>

{#if uiStore.anatomyOpen}
  <DraggableWindow
    title="Anatomy"
    id="anatomy"
    bind:open={uiStore.anatomyOpen}
    focus={uiStore.anatomyFocus}
    initialX={20}
    initialY={90}
    noPad
  >
    <div class="an">
      <div class="pick">
        <Select
          id="an-craft"
          value={craftId}
          onchange={(e: Event) => {
            manual = (e.currentTarget as HTMLSelectElement).value;
            selected = null;
          }}
        >
          {#each FLEET as f}<option value={f.id}>{f.name}</option>{/each}
        </Select>
      </div>

      <div class="viewport" bind:this={host}></div>

      <div class="ctrl">
        <Slider
          label="Exploded" min={0} max={1} step={0.01}
          value={explode} display={Math.round(explode * 100) + '%'}
          oninput={(e: Event) => (explode = +(e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <p class="blurb">{craft.blurb}</p>
      {#if craft.caution}
        <p class="caution"><b>Not disclosed.</b> {craft.caution}</p>
      {/if}

      <div class="grid">
        <div class="cell"><span class="lbl">Launch mass</span><b>{fmt(budget.mass)} kg</b></div>
        <div class="cell"><span class="lbl">Published</span><b>{fmt(craft.mass)} kg</b></div>
        <div class="cell"><span class="lbl">Array</span><b>{fmt(budget.gen)} W</b></div>
        <div class="cell">
          <span class="lbl">Margin</span>
          <b class:bad={budget.margin < 0}>{budget.margin >= 0 ? '+' : ''}{fmt(budget.margin)} W</b>
        </div>
      </div>

      {#if sel}
        <div class="detail">
          <div class="dh"><span class="cat">{sel.cat}</span><b>{sel.name}</b></div>
          <p>{sel.note}</p>
          <div class="dm">
            <span>{sel.origin}, {sel.year}</span>
            <span>{fmt(sel.mass, sel.mass < 10 ? 1 : 0)} kg</span>
            <span>{sel.spec}</span>
          </div>
        </div>
      {/if}

      <div class="bom">
        {#each CATS.filter((c) => grouped[c]) as cat}
          <div class="bc">{cat}</div>
          {#each grouped[cat] as p}
            <button
              class="br"
              class:on={selected === p.id}
              onclick={() => (selected = selected === p.id ? null : p.id)}
            >
              <span class="bn">{p.name}</span>
              <span class="bo">{p.origin}</span>
              <span class="bm">{fmt(p.mass, p.mass < 10 ? 1 : 0)} kg</span>
            </button>
          {/each}
        {/each}
      </div>
    </div>
  </DraggableWindow>
{/if}

<style>
  .an { min-width: 320px; max-width: 360px; display: flex; flex-direction: column; }
  @media (max-width: 767px) { .an { min-width: unset; max-width: unset; width: 100%; } }
  .pick { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .viewport {
    height: 240px; position: relative; overflow: hidden;
    border-bottom: 1px solid var(--border); background: var(--card-bg);
  }
  .ctrl { padding: 6px 12px; }
  .blurb, .caution {
    margin: 0; padding: 0 12px 8px;
    font-size: 11px; line-height: 1.5; color: var(--text-dim);
  }
  .caution { color: var(--text-ghost); border-left: 2px solid var(--warning); margin: 0 12px 8px; padding: 4px 8px; }
  .caution b { color: var(--warning); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--border); }
  .cell {
    padding: 6px 12px; display: flex; flex-direction: column; gap: 1px;
    border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
  }
  .cell:nth-child(2n) { border-right: none; }
  .cell b { font-size: 14px; color: var(--text); font-weight: 500; }
  .cell b.bad { color: var(--danger); }
  .lbl {
    font-size: 9px; color: var(--text-ghost);
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .detail { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .dh { display: flex; align-items: baseline; gap: 8px; }
  .dh b { color: var(--text); font-size: 13px; }
  .cat { font-size: 9px; letter-spacing: 0.8px; color: var(--live); }
  .detail p { margin: 5px 0 6px; font-size: 11px; line-height: 1.5; color: var(--text-dim); }
  .dm { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 9.5px; color: var(--text-ghost); }
  .bom { max-height: 220px; overflow-y: auto; }
  .bc {
    font-size: 9px; letter-spacing: 1px; color: var(--text-ghost);
    padding: 8px 12px 2px;
  }
  .br {
    display: grid; grid-template-columns: 1fr auto; column-gap: 8px;
    width: 100%; text-align: left; padding: 3px 12px;
    background: none; border: none; border-left: 2px solid transparent;
    color: inherit; font: inherit; cursor: pointer;
  }
  .br:hover { background: var(--card-bg); }
  .br.on { border-left-color: var(--live); background: var(--card-bg); }
  .bn { font-size: 11.5px; color: var(--text-dim); }
  .br.on .bn { color: var(--live); }
  .bo { grid-column: 1; font-size: 9px; color: var(--text-ghost); }
  .bm { grid-row: 1 / 3; align-self: center; font-size: 9.5px; color: var(--text-ghost); }
</style>
