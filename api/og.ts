/**
 * Open Graph card for a shared design.
 *
 * The 3D model can't be rendered here — that needs a GPU context — so the card
 * shows what actually travels well at thumbnail size in a Slack or Twitter
 * feed: the vehicle's name, its orbit, and the four numbers that say whether
 * the design closes. It reuses the app's own analyze() so the figures on the
 * card are the same ones the app shows, not a separate approximation.
 *
 * Elements are plain objects rather than JSX — this is a .ts file in a Vite
 * project with no JSX transform, and Satori accepts the element shape directly.
 */
import { ImageResponse } from '@vercel/og';
import { decodeDesign } from '../src/data/design-share.js';
import { customToPart } from '../src/data/design-parts.js';
import { PART_BY_ID, analyze, type Part } from '../src/data/spacecraft.js';

const W = 1200, H = 630;
const BG = '#0a0d10', FG = '#e8eef2', DIM = '#7d8f9c', LINE = '#22303a', LIVE = '#4ec07a', BAD = '#c0453b';

type El = { type: string; props: Record<string, unknown> };
const el = (type: string, props: Record<string, unknown>): El => ({ type, props });
const row = (children: unknown[], style: Record<string, unknown> = {}) =>
  el('div', { style: { display: 'flex', ...style }, children });

function stat(label: string, value: string, color = FG) {
  return el('div', {
    style: {
      display: 'flex', flexDirection: 'column', flex: 1,
      borderRight: `1px solid ${LINE}`, padding: '22px 26px', gap: 8,
    },
    children: [
      el('div', { style: { fontSize: 17, color: DIM, letterSpacing: 2 }, children: label.toUpperCase() }),
      el('div', { style: { fontSize: 42, color }, children: value }),
    ],
  });
}

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '—');

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const encoded = url.searchParams.get('d');

    let name = 'Orbital Works';
    let operator = 'Design a satellite from a sentence';
    let sub = 'orbital-works.vercel.app';
    let stats: El[] = [];

    const design = encoded ? await decodeDesign(encoded) : null;
    if (design) {
      const lib = design.libraryParts.map((id) => PART_BY_ID[id]).filter(Boolean) as Part[];
      const custom = design.customParts.map((c) => customToPart(c) as unknown as Part);
      const b = analyze([...lib, ...custom]);
      name = design.name;
      operator = design.operator;
      sub = `${design.missionClass} · ${fmt(design.altKm)} km · ${design.incDeg.toFixed(1)}° inclination`;
      stats = [
        stat('Launch mass', `${fmt(b.mass)} kg`),
        stat('Generation', `${fmt(b.gen)} W`),
        stat('Power margin', `${b.margin >= 0 ? '+' : ''}${fmt(b.margin)} W`, b.margin < 0 ? BAD : LIVE),
        stat('Delta-v', `${fmt(b.dv)} m/s`),
      ];
    }

    // The app's own typeface, fetched from the deployment serving this request,
    // so the card matches the product rather than approximating it.
    let fonts: { name: string; data: ArrayBuffer; weight: 400; style: 'normal' }[] | undefined;
    try {
      const res = await fetch(new URL('/textures/ui/overpass-mono.ttf', url.origin));
      if (res.ok) fonts = [{ name: 'Overpass Mono', data: await res.arrayBuffer(), weight: 400, style: 'normal' }];
    } catch {
      // Fall through to Satori's default — a card without the brand font still
      // beats a broken image in someone's feed.
    }

    return new ImageResponse(
      el('div', {
        style: {
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: BG, color: FG, fontFamily: 'Overpass Mono',
          // Faint grid, echoing the canvas the app draws its windows on.
          backgroundImage:
            `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        },
        children: [
          row([el('div', { style: { fontSize: 20, color: DIM, letterSpacing: 3 }, children: 'ORBITAL WORKS' })],
            { padding: '38px 46px 0', flexGrow: 0 }),
          el('div', {
            style: { display: 'flex', flexDirection: 'column', flex: 1, padding: '10px 46px', justifyContent: 'center', gap: 14 },
            children: [
              el('div', { style: { fontSize: 78, lineHeight: 1.05 }, children: name }),
              el('div', { style: { fontSize: 28, color: DIM }, children: operator }),
              el('div', { style: { fontSize: 22, color: DIM, letterSpacing: 1 }, children: sub }),
            ],
          }),
          stats.length
            ? row(stats, { borderTop: `1px solid ${LINE}`, flexGrow: 0 })
            : row([el('div', {
                style: { padding: '26px 46px', fontSize: 24, color: DIM },
                children: 'Describe a mission. Get a spacecraft that closes its own budgets.',
              })], { borderTop: `1px solid ${LINE}`, flexGrow: 0 }),
        ],
        // Satori consumes this element shape directly; @vercel/og types it as
        // a React element, which this project has no types for.
      }) as unknown as ConstructorParameters<typeof ImageResponse>[0],
      { width: W, height: H, ...(fonts ? { fonts } : {}) },
    );
  },
};
