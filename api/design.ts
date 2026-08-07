/**
 * Spacecraft design endpoint.
 *
 * Takes a plain-language mission description and returns a parts list in the
 * same shape as the hand-authored fleet, so the client renders it through the
 * existing procedural geometry pipeline and grades it with the existing
 * mass/power analysis. The model chooses hardware; it never emits geometry code.
 *
 * Auth is Vercel AI Gateway via OIDC — no API key in the environment.
 *
 * On not using Output.object(): the AI SDK's structured-output mode drives
 * constrained decoding, which measured 295s against this schema versus 13.7s
 * asking for plain JSON — a 21x difference, and well past the function ceiling.
 * We ask for JSON and validate the parse with the same zod schema instead, so
 * nothing reaches the client unvalidated.
 */
import { generateText } from 'ai';
import { DesignSchema, GEOM_KINDS, GEOM_MATS, PART_CATS, PART_DIRS, PART_SLOTS } from '../src/data/design-schema.js';
import { PARTS } from '../src/data/spacecraft.js';

const MODEL = 'anthropic/claude-sonnet-4.6';
const MAX_PROMPT_CHARS = 600;

const CATALOGUE = PARTS.map(
  (p) => `${p.id}|${p.cat}|${p.name}|${p.mass}kg|${p.power > 0 ? '+' : ''}${p.power}W|${p.slot}|${p.spec}`
).join('\n');

/** Which dimensions each primitive actually consumes, so custom parts render. */
const GEOM_FIELDS = [
  'plate: w,d,t,mat', 'box: w,h,d,mat', 'wing: len,panels,wid,sides',
  'panel: w,d,mat', 'tiles: w,d,rows,cols', 'dish: r,count',
  'cylinder: r,h,mat', 'thruster: r,h,count', 'wheels: r,h,count',
  'tracker: r,h,count', 'laser: r,count', 'telescope: r,len',
  'patch: w,d,mat', 'whip: len', 'blanket: mat',
].join(' · ');

const SYSTEM = `You are a spacecraft systems engineer designing a satellite from a mission brief.

COMPONENT CATALOGUE — id|category|name|mass|power|slot|spec
${CATALOGUE}

ENUMS
cat: ${PART_CATS.join(', ')}
slot: ${PART_SLOTS.join(', ')}
dir: ${PART_DIRS.join(', ')}
geom.kind: ${GEOM_KINDS.join(', ')}
geom.mat: ${GEOM_MATS.join(', ')}

GEOMETRY FIELDS BY KIND (metres; supply these or the part renders wrong)
${GEOM_FIELDS}

DESIGN RULES
- Reuse catalogue ids in libraryParts wherever they fit; they carry real masses and specs. Inventing a near-duplicate makes the design worse.
- customParts is only for hardware the mission needs and the catalogue lacks — a SAR boom, a hyperspectral imager, a drag sail. Two or three at most.
- Exactly one STRUCTURE part, slot "core". Everything mounts to it.
- Power generation must exceed total load. Sum the negative power values and check.
- Include ATTITUDE control. Include PROPULSION if the orbit needs maintaining or deorbiting.
- Payload must match the mission: imaging needs OPTICAL, comms needs USER LINK and usually BACKHAUL.
- Masses, powers and dimensions must be mutually plausible. No 12 m antenna on a 4 kg spacecraft.
- No manufacturer trademarks in the vehicle name.
- rationale: name the specific trade and what it cost — thermal, downlink budget, launch volume, propellant. Concrete, not promotional.

Return ONLY minified JSON. No prose, no markdown fence.
{"name":"","operator":"","missionClass":"","altKm":0,"incDeg":0,"blurb":"","rationale":"","libraryParts":["catalogue-id"],"customParts":[{"id":"","name":"","cat":"","slot":"","dir":"","mass":0,"power":0,"spec":"","note":"","geom":{"kind":"","mat":""},"area":0,"downlink":0}]}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Models occasionally wrap JSON in a fence or add a sentence; salvage the object. */
function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a === -1 || b <= a) throw new Error('No JSON object in response.');
    return JSON.parse(cleaned.slice(a, b + 1));
  }
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    let prompt = '';
    try {
      const body = (await request.json()) as { prompt?: unknown };
      prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    } catch {
      return json({ error: 'Body must be JSON.' }, 400);
    }

    if (!prompt) return json({ error: 'Describe what the satellite is for.' }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: `Keep the brief under ${MAX_PROMPT_CHARS} characters.` }, 400);
    }

    try {
      const { text } = await generateText({
        model: MODEL,
        system: SYSTEM,
        prompt: `Design a satellite for this mission:\n\n${prompt}`,
        maxOutputTokens: 4000,
      });

      const parsed = DesignSchema.safeParse(extractJson(text));
      if (!parsed.success) {
        return json(
          { error: 'The design came back malformed. Try rewording the brief.', issues: parsed.error.issues.slice(0, 5) },
          502
        );
      }

      // Drop hallucinated catalogue ids rather than letting the client render holes.
      const known = new Set(PARTS.map((p) => p.id));
      const libraryParts = parsed.data.libraryParts.filter((id) => known.has(id));
      const dropped = parsed.data.libraryParts.length - libraryParts.length;

      return json({ design: { ...parsed.data, libraryParts }, dropped });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed.';
      return json({ error: message.slice(0, 300) }, 502);
    }
  },
};
