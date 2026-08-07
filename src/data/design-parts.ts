/**
 * Shared vocabulary for generated spacecraft designs — no zod, no THREE, no DOM.
 *
 * Deliberately separate from design-schema.ts: that file builds zod schemas at
 * module scope, so anything the browser imports from it drags zod into the
 * client bundle. Validation is a server concern; these constants and repair
 * helpers are needed on both sides.
 */

/**
 * Separates the display-only model text from the server-validated payload in a
 * streamed design response. A NUL byte cannot occur in the model's JSON output,
 * so splitting on it is unambiguous.
 */
export const SENTINEL = '\u0000';

export const GEOM_KINDS = [
  'plate', 'box', 'wing', 'panel', 'tiles', 'dish', 'cylinder',
  'thruster', 'wheels', 'tracker', 'laser', 'telescope', 'patch',
  'whip', 'blanket',
] as const;

export const GEOM_MATS = ['shell', 'dark', 'solar', 'gold', 'copper', 'white'] as const;
export const PART_SLOTS = ['core', 'nadir', 'zenith', 'aft', 'wing', 'shell'] as const;
export const PART_DIRS = ['up', 'down', 'fore', 'aft', 'none'] as const;
export const PART_CATS = [
  'STRUCTURE', 'POWER', 'PROPULSION', 'ATTITUDE', 'AVIONICS', 'PAYLOAD',
  'USER LINK', 'BACKHAUL', 'OPTICAL', 'THERMAL', 'BRIGHTNESS',
] as const;

export type GeomKind = (typeof GEOM_KINDS)[number];
export type GeomMat = (typeof GEOM_MATS)[number];
export type PartSlot = (typeof PART_SLOTS)[number];
export type PartDir = (typeof PART_DIRS)[number];
export type PartCat = (typeof PART_CATS)[number];

export interface Geom {
  kind: GeomKind;
  mat?: GeomMat;
  w?: number; d?: number; h?: number; t?: number; r?: number;
  len?: number; wid?: number;
  rows?: number; cols?: number; count?: number; panels?: number; sides?: number;
  thin?: boolean; plume?: boolean;
}

export interface CustomPart {
  id: string;
  name: string;
  cat: PartCat;
  slot: PartSlot;
  dir: PartDir;
  mass: number;
  power: number;
  spec: string;
  note: string;
  geom: Geom;
  area?: number; capacity?: number; thrust?: number; isp?: number; prop?: number;
  pointing?: number; downlink?: number; isl?: number; burst?: boolean;
}

export interface Design {
  name: string;
  operator: string;
  missionClass: string;
  altKm: number;
  incDeg: number;
  blurb: string;
  rationale: string;
  libraryParts: string[];
  customParts: CustomPart[];
}

/** Sensible dimensions per primitive, used to backfill whatever the model omitted. */
const GEOM_DEFAULTS: Record<string, Record<string, unknown>> = {
  plate:     { w: 2.8, d: 1.9, t: 0.18, mat: 'shell' },
  box:       { w: 0.5, h: 0.3, d: 0.4, mat: 'shell' },
  wing:      { len: 6, panels: 4, wid: 1.4, sides: 1 },
  panel:     { w: 1.2, d: 0.9, mat: 'solar' },
  tiles:     { w: 1.6, d: 1.1, rows: 4, cols: 6 },
  dish:      { r: 0.5, count: 1 },
  cylinder:  { r: 0.25, h: 0.6, mat: 'shell' },
  thruster:  { r: 0.09, h: 0.22, count: 1 },
  wheels:    { r: 0.13, h: 0.09, count: 4 },
  tracker:   { r: 0.07, h: 0.28, count: 2 },
  laser:     { r: 0.11, count: 3 },
  telescope: { r: 0.35, len: 1.6 },
  patch:     { w: 0.4, d: 0.4, mat: 'copper' },
  whip:      { len: 0.9 },
  blanket:   { mat: 'gold' },
};

/**
 * Fill in the fields a primitive needs but the model left out.
 *
 * Without this a `wing` missing `panels` divides by undefined and the mesh comes
 * out NaN — three.js then silently drops the whole part. A plausible default
 * beats a hole in the spacecraft.
 */
export function repairGeom(geom: Partial<Geom> | undefined | null): Record<string, unknown> {
  const kind = (geom?.kind && (GEOM_KINDS as readonly string[]).includes(geom.kind) ? geom.kind : 'box') as string;
  const out: Record<string, unknown> = { ...GEOM_DEFAULTS[kind], ...(geom || {}), kind };

  // Positive, finite dimensions only — a zero-width panel is invisible, and a
  // negative one inverts the mesh normals.
  for (const k of ['w', 'd', 'h', 't', 'r', 'len', 'wid']) {
    const v = out[k];
    if (v !== undefined && (typeof v !== 'number' || !isFinite(v) || v <= 0)) {
      out[k] = GEOM_DEFAULTS[kind]?.[k] ?? 0.3;
    }
  }
  // Counts must be whole and at least one, or the render loops never execute.
  for (const k of ['rows', 'cols', 'count', 'panels', 'sides']) {
    const v = out[k];
    if (v !== undefined) {
      const n = Math.round(Number(v));
      out[k] = isFinite(n) && n >= 1 ? Math.min(n, 64) : (GEOM_DEFAULTS[kind]?.[k] ?? 1);
    }
  }
  if (out.mat !== undefined && !(GEOM_MATS as readonly string[]).includes(out.mat as string)) out.mat = 'shell';
  return out;
}

/** Turn a generated custom part into the `Part` shape the renderer consumes. */
export function customToPart(c: CustomPart, year = new Date().getUTCFullYear()): Record<string, unknown> {
  return {
    id: c.id,
    cat: c.cat,
    name: c.name,
    origin: 'Generated design',
    year,
    mass: Number.isFinite(c.mass) ? Math.max(0, c.mass) : 0,
    power: Number.isFinite(c.power) ? c.power : 0,
    spec: c.spec,
    note: c.note,
    dir: c.dir,
    slot: c.slot,
    geom: repairGeom(c.geom),
    ...(c.area !== undefined ? { area: c.area } : {}),
    ...(c.capacity !== undefined ? { capacity: c.capacity } : {}),
    ...(c.thrust !== undefined ? { thrust: c.thrust } : {}),
    ...(c.isp !== undefined ? { isp: c.isp } : {}),
    ...(c.prop !== undefined ? { prop: c.prop } : {}),
    ...(c.pointing !== undefined ? { pointing: c.pointing } : {}),
    ...(c.downlink !== undefined ? { downlink: c.downlink } : {}),
    ...(c.isl !== undefined ? { isl: c.isl } : {}),
    ...(c.burst !== undefined ? { burst: c.burst } : {}),
  };
}
