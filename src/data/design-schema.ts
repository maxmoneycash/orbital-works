/**
 * Zod validation for AI-generated spacecraft designs. Server-only.
 *
 * The shared vocabulary — enums, geometry repair, the Part conversion — lives in
 * design-parts.ts so the browser can use it without pulling zod into the client
 * bundle. This file is the checking layer the serverless function runs before
 * anything reaches a renderer.
 *
 * The model never writes three.js. It emits a parts list in exactly the shape
 * the hand-authored fleet already uses, so assemble() and buildPart() render it
 * with no special casing, and analyze() / validate() grade it against the same
 * rules as the real vehicles.
 *
 * Two escape hatches, deliberately in this order:
 *  - libraryParts reuses the 84 catalogued components. Preferred: real masses,
 *    real power draws, real specs.
 *  - customParts invents hardware the catalogue lacks, but only out of the 15
 *    geometry primitives the renderer understands. A design can be novel without
 *    being unrenderable.
 */
import { z } from 'zod';
import { GEOM_KINDS, GEOM_MATS, PART_CATS, PART_DIRS, PART_SLOTS } from './design-parts.js';

export * from './design-parts.js';

/**
 * One flat bag of dimensions rather than a 15-way discriminated union. Models
 * handle a wide-but-shallow schema far more reliably than a deep one, and
 * repairGeom backfills whatever is missing per kind.
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
