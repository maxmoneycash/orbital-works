/**
 * Schema for AI-generated spacecraft designs.
 *
 * The model never writes three.js. It emits a parts list in exactly the shape
 * the hand-authored fleet already uses, so `assemble()` and `buildPart()` render
 * it with no special casing, and `analyze()` / `validate()` grade it against the
 * same rules as the real vehicles.
 *
 * Two escape hatches, deliberately in this order:
 *  - `libraryParts` reuses the 84 catalogued components. Preferred: real masses,
 *    real power draws, real specs.
 *  - `customParts` invents hardware the catalogue lacks, but only out of the 15
 *    geometry primitives the renderer understands. A design can be novel without
 *    being unrenderable.
 *
 * Framework-free — no THREE, no DOM. The serverless function imports this too.
 */
import { z } from 'zod';

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

/**
 * One flat bag of dimensions rather than a 15-way discriminated union. Models
 * handle a wide-but-shallow schema far more reliably than a deep one, and
 * `repairGeom` below backfills whatever is missing per kind.
 */
export const GeomSchema = z.object({
  kind: z.enum(GEOM_KINDS).describe('Which renderer primitive draws this part.'),
  mat: z.enum(GEOM_MATS).optional().describe('Surface finish.'),
  w: z.number().optional().describe('Width in metres (plate, box, panel, tiles, patch).'),
  d: z.number().optional().describe('Depth in metres (plate, box, panel, tiles, patch).'),
  h: z.number().optional().describe('Height in metres (box, cylinder, thruster, wheels, tracker).'),
  t: z.number().optional().describe('Thickness in metres (plate).'),
  r: z.number().optional().describe('Radius in metres (dish, cylinder, thruster, wheels, tracker, laser, telescope).'),
  len: z.number().optional().describe('Length in metres (wing boom, telescope tube, whip antenna).'),
  wid: z.number().optional().describe('Panel width in metres (wing).'),
  rows: z.number().int().optional().describe('Tile rows (tiles).'),
  cols: z.number().int().optional().describe('Tile columns (tiles).'),
  count: z.number().int().optional().describe('How many units (dish, thruster, wheels, tracker, laser).'),
  panels: z.number().int().optional().describe('Panels per wing (wing).'),
  sides: z.number().int().optional().describe('1 for a single wing, 2 for a symmetric pair (wing).'),
  thin: z.boolean().optional().describe('Low-profile tiles (tiles).'),
  plume: z.boolean().optional().describe('Draw an exhaust plume (thruster).'),
});

export const CustomPartSchema = z.object({
  id: z.string().describe('Unique kebab-case id, e.g. "sar-boom-x".'),
  name: z.string().describe('Short hardware name as an engineer would write it.'),
  cat: z.enum(PART_CATS),
  slot: z.enum(PART_SLOTS).describe('Where it mounts. Exactly one STRUCTURE part must use "core".'),
  dir: z.enum(PART_DIRS).describe('Which way it travels in the exploded view.'),
  mass: z.number().describe('Kilograms.'),
  power: z.number().describe('Watts. Positive generates, negative consumes.'),
  spec: z.string().describe('One-line headline spec, e.g. "3.2 m X-band reflector".'),
  note: z.string().describe('One or two sentences on why this hardware and what it costs you.'),
  geom: GeomSchema,
  area: z.number().optional().describe('Cross-section in m², drives drag and brightness.'),
  capacity: z.number().optional().describe('Structural carrying capacity in kg (STRUCTURE only).'),
  thrust: z.number().optional().describe('Newtons (PROPULSION only).'),
  isp: z.number().optional().describe('Specific impulse in seconds (PROPULSION only).'),
  prop: z.number().optional().describe('Propellant mass in kg (PROPULSION only).'),
  pointing: z.number().optional().describe('Pointing accuracy in arcseconds (ATTITUDE only).'),
  downlink: z.number().optional().describe('Downlink capacity in Mbps.'),
  isl: z.number().optional().describe('Inter-satellite link capacity in Mbps.'),
  burst: z.boolean().optional().describe('True if the load is bursty rather than continuous.'),
});

export const DesignSchema = z.object({
  name: z.string().describe('Vehicle name. Inventive but plausible, no manufacturer trademarks.'),
  operator: z.string().describe('Fictional operator or agency flying it.'),
  missionClass: z.string().describe('Two or three words, e.g. "Maritime SAR" or "Optical tasking".'),
  altKm: z.number().describe('Design orbit altitude in km.'),
  incDeg: z.number().describe('Design inclination in degrees. 97-99 for sun-synchronous.'),
  blurb: z.string().describe('Two or three sentences on what this vehicle is for and the central design tension.'),
  rationale: z.string().describe('Why this configuration — the trades made and what was given up. Concrete, not marketing.'),
  libraryParts: z.array(z.string()).describe('Ids reused from the component catalogue. Prefer these; they carry real masses and specs.'),
  customParts: z.array(CustomPartSchema).describe('Hardware the catalogue lacks. Leave empty if the catalogue covers the mission.'),
});

export type Design = z.infer<typeof DesignSchema>;
export type CustomPart = z.infer<typeof CustomPartSchema>;
export type Geom = z.infer<typeof GeomSchema>;

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
 * Without this a `wing` missing `panels` divides by undefined and the mesh
 * comes out NaN — three.js then silently drops the whole part. Better to render
 * a plausible default than a hole in the spacecraft.
 */
export function repairGeom(geom: Partial<Geom> | undefined | null): Record<string, unknown> {
  const kind = (geom?.kind && GEOM_KINDS.includes(geom.kind) ? geom.kind : 'box') as string;
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
  if (out.mat !== undefined && !GEOM_MATS.includes(out.mat as any)) out.mat = 'shell';
  return out;
}

/** Turn a validated custom part into the `Part` shape the renderer consumes. */
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
