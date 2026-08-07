/**
 * Starlink orbital shell registry.
 *
 * The licensed architecture — what the FCC granted and what SpaceX designed to.
 * Paired with the live catalogue in the Constellation window, this shows the
 * interesting gap: a shell's licence says 1,584 satellites, the sky says
 * something else. Shells are rarely filled to their grant, and some were
 * lowered years after being authorised.
 *
 * Figures from the 2026 spec registry in github.com/Sleepingknight0/BWX-STARLINK
 * (MIT), which sources them to FCC grants and to Jonathan McDowell's catalogue
 * at planet4589.org. Population counts move daily; the snapshot date is carried
 * with them rather than presented as current truth.
 *
 * Framework-free — no THREE, no DOM.
 */

export interface Shell {
  id: string;
  gen: 'Gen1' | 'Gen2';
  incDeg: number;
  altKm: number;
  planes: number | null;
  perPlane: number | null;
  licensed: number | null;
  note: string;
}

/** Gen1, as granted by the FCC. Altitudes and inclinations are design values. */
export const SHELLS: Shell[] = [
  {
    id: 'g1-s1', gen: 'Gen1', incDeg: 53.0, altKm: 550, planes: 72, perPlane: 22, licensed: 1584,
    note: 'The workhorse shell. Covers to about ±53° latitude, which is roughly 80% of the land people live on. Independent analysis in 2026 found it flying nearer 1,500 than its licensed 1,584.',
  },
  {
    id: 'g1-s2', gen: 'Gen1', incDeg: 70.0, altKm: 570, planes: 36, perPlane: 20, licensed: 720,
    note: 'Mid-high inclination, reaching latitudes the 53° shell cannot.',
  },
  {
    id: 'g1-s3', gen: 'Gen1', incDeg: 97.6, altKm: 560, planes: 6, perPlane: 58, licensed: 348,
    note: 'Sun-synchronous. Few planes, many satellites per plane.',
  },
  {
    id: 'g1-s4', gen: 'Gen1', incDeg: 53.2, altKm: 540, planes: 72, perPlane: 22, licensed: 1584,
    note: 'A second 53° shell 10 km below the first — close enough that catalogue altitude alone will not always separate the two.',
  },
  {
    id: 'g1-s5', gen: 'Gen1', incDeg: 97.6, altKm: 560, planes: 4, perPlane: 43, licensed: 172,
    note: 'The smallest polar shell.',
  },
  // Gen2 — First Partial Grant (FCC 22-91) authorised 7,500 in Ku/Ka. Altitudes
  // were lowered repeatedly; the January 2026 grant moved 525/530/535 down.
  {
    id: 'g2-475', gen: 'Gen2', incDeg: 53.0, altKm: 475, planes: null, perPlane: null, licensed: null,
    note: 'Lowered from 535 km in January 2026. Lower is better for debris: a dead satellite at 480 km re-enters within a year or two instead of decades.',
  },
  {
    id: 'g2-480', gen: 'Gen2', incDeg: 53.0, altKm: 480, planes: null, perPlane: null, licensed: null,
    note: 'Lowered from 525 km in January 2026.',
  },
  {
    id: 'g2-485', gen: 'Gen2', incDeg: 53.0, altKm: 485, planes: null, perPlane: null, licensed: null,
    note: 'Lowered from 530 km in January 2026.',
  },
  {
    id: 'g2-vleo', gen: 'Gen2', incDeg: 53.0, altKm: 350, planes: null, perPlane: null, licensed: null,
    note: 'Very low shells at 340-365 km, added from 2024. Drag is heavy enough here that station-keeping is continuous and a failed satellite deorbits quickly.',
  },
];

/**
 * Population snapshot. These move by one or two a day, so the date travels with
 * them — a count without a date is a lie by the following week.
 */
export const POPULATION = {
  asOf: '2026-07-11',
  source: 'Jonathan McDowell, planet4589.org',
  launched: 12472,
  inOrbit: 10775,
  working: 10759,
  inOperationalShell: 9062,
  failedOrDecaying: 16,
};

export const CONSTELLATION_FACTS = [
  ['Design life', '~5 years'],
  ['Gen1 min elevation', '25°'],
  ['Gen2 first grant', '7,500 satellites (Ku/Ka)'],
  ['Burn-up on reentry', '~95% of material'],
  ['Collision avoidance', 'Autonomous, from US DoD tracking'],
] as const;

/**
 * Match a catalogued object to a licensed shell.
 *
 * Altitude tolerance is deliberately loose: a satellite's osculating altitude
 * wanders by kilometres over an orbit, drifts as it station-keeps, and sits well
 * below its target while still raising orbit after launch. Inclination is the
 * far more reliable discriminator, so it gets the tight window.
 */
export function classifyShell(incDeg: number, altKm: number): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const s of SHELLS) {
    if (Math.abs(incDeg - s.incDeg) > 1.5) continue;
    const dAlt = Math.abs(altKm - s.altKm);
    if (dAlt > 30) continue;
    const score = dAlt + Math.abs(incDeg - s.incDeg) * 10;
    if (score < bestScore) { bestScore = score; best = s.id; }
  }
  return best;
}
