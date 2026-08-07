/**
 * Spacecraft hardware model — parts library, fleet definitions, mass/power
 * budgets and RF link budget. Framework-free; no THREE or DOM dependencies.
 *
 * Ported into satvisor from Orbital Works. Sources:
 *  - Band gains, EIRP densities, MODCOD thresholds: SpaceX FCC filings, via
 *    github.com/noiseinspacechannel/NIS-Starlink-Video (MIT).
 *  - Waveform, beam counts, cell geometry, brightness magnitudes: spec registry
 *    in github.com/Sleepingknight0/BWX-STARLINK (MIT), which sources them to
 *    UT Austin's live-signal teardown (IEEE TAES 2023) and independent work.
 */

export interface Part {
  id: string;
  cat: string;
  name: string;
  origin: string;
  year: number;
  mass: number;
  power: number;
  spec: string;
  note: string;
  dir: string;
  slot: string;
  geom: any;
  capacity?: number;
  area?: number;
  thrust?: number;
  isp?: number;
  prop?: number;
  pointing?: number;
  downlink?: number;
  isl?: number;
  needsPointing?: number;
  burst?: boolean;
  rf?: { band: string; w: number; h: number; aperture?: boolean; esas?: number; beams?: number };
}

export interface Spacecraft {
  id: string;
  op: string;
  family: string;
  name: string;
  year: number;
  built: number | null;
  status: string;
  mass: number;
  alt: number;
  inc: number;
  blurb: string;
  caution?: string;
  parts: string[];
}

/* ---------------------------------------------------------------- PARTS ---
   power: watts. positive = generated, negative = consumed.
   dir: which way the part travels in the exploded view.
-------------------------------------------------------------------------- */

export const PARTS: Part[] = [
  /* ---- STRUCTURE ---- */
  {
    id: "bus-flatpack",
    cat: "STRUCTURE",
    name: "Flat-pack bus plate",
    origin: "Starlink v0.9 / v1.0",
    year: 2019,
    mass: 55,
    power: -6,
    spec: "≈2.8 × 1.9 m panel",
    capacity: 320,
    note: "A satellite shaped like a table leaf. Stacking flat plates with no dispenser is what let one Falcon 9 carry 60 spacecraft; the stack is clamped for ascent, then released to drift apart.",
    dir: "none",
    slot: "core",
    geom: { kind: "plate", w: 2.8, d: 1.9, t: 0.18, mat: "shell" },
  },
  {
    id: "bus-v2mini",
    cat: "STRUCTURE",
    name: "Wide flat bus, V2 Mini",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 175,
    power: -14,
    spec: "≈4.1 × 2.7 m panel",
    capacity: 900,
    note: "Sized to the largest plate that still fits a Falcon 9 fairing. The 2025 'Optimized' rebuild cut ~22% of the mass, which bought 29 satellites per launch instead of 23.",
    dir: "none",
    slot: "core",
    geom: { kind: "plate", w: 4.1, d: 2.7, t: 0.22, mat: "shell" },
  },
  {
    id: "bus-v2opt",
    cat: "STRUCTURE",
    name: "Optimized flat bus",
    origin: "Starlink V2 Mini Optimized",
    year: 2025,
    mass: 110,
    power: -12,
    spec: "Same envelope, 22% lighter",
    capacity: 800,
    note: "A year of taking grams out of brackets. No new capability at all — just a lighter version of the same satellite, which is worth six more spacecraft on every launch.",
    dir: "none",
    slot: "core",
    geom: { kind: "plate", w: 4.1, d: 2.7, t: 0.19, mat: "shell" },
  },
  {
    id: "bus-bluebird",
    cat: "STRUCTURE",
    name: "Unfolding array platform",
    origin: "AST SpaceMobile BlueBird 2",
    year: 2025,
    mass: 3300,
    power: -140,
    spec: "Folded for launch, unfolds in orbit",
    capacity: 7000,
    note: "Mostly hinges, latches and stiffening. The hard engineering is not the electronics — it is unfolding something the size of a tennis court once, in vacuum, with no chance to try again.",
    dir: "none",
    slot: "core",
    geom: { kind: "plate", w: 4.4, d: 3.6, t: 0.5, mat: "shell" },
  },
  {
    id: "bus-v3",
    cat: "STRUCTURE",
    name: "Starship-class bus, V3",
    origin: "Starlink V3",
    year: 2026,
    mass: 430,
    power: -30,
    spec: "Mechanical envelope not disclosed",
    capacity: 2400,
    note: "V3 is not a bigger V2 Mini — it is a spacecraft that gave up on fitting inside a Falcon 9 fairing. SpaceX has never published a V3 drawing, so this shape is inferred from stated capability, not measured.",
    dir: "none",
    slot: "core",
    geom: { kind: "plate", w: 6.4, d: 3.4, t: 0.3, mat: "shell" },
  },
  {
    id: "bus-smallsat",
    cat: "STRUCTURE",
    name: "Arrow-class smallsat bus",
    origin: "OneWeb Gen 1",
    year: 2019,
    mass: 44,
    power: -7,
    spec: "≈1.0 × 1.0 × 1.3 m box",
    capacity: 240,
    note: "Airbus built these on a moving production line in Florida at roughly two per day — the first time anyone mass-produced a satellite bus like an airframe.",
    dir: "none",
    slot: "core",
    geom: { kind: "box", w: 1.0, h: 1.3, d: 1.0, mat: "shell" },
  },
  {
    id: "bus-cubesat",
    cat: "STRUCTURE",
    name: "3U CubeSat frame",
    origin: "Planet SuperDove",
    year: 2019,
    mass: 1.3,
    power: -1,
    spec: "0.34 × 0.10 × 0.10 m",
    capacity: 9,
    note: "A loaf of bread with a telescope in it. The 10 cm cube standard exists so universities could share rideshare slots; Planet turned it into a daily image of the whole planet.",
    dir: "none",
    slot: "core",
    geom: { kind: "box", w: 0.34, h: 0.1, d: 0.1, mat: "shell" },
  },
  {
    id: "bus-sarmicro",
    cat: "STRUCTURE",
    name: "SAR microsat bus",
    origin: "ICEYE X-series",
    year: 2018,
    mass: 20,
    power: -4,
    spec: "≈0.7 × 0.6 × 0.4 m",
    capacity: 130,
    note: "Radar imaging used to require a bus the size of a van. ICEYE got it to suitcase scale by accepting a smaller antenna and making up the difference with signal processing.",
    dir: "none",
    slot: "core",
    geom: { kind: "box", w: 0.7, h: 0.4, d: 0.6, mat: "shell" },
  },
  {
    id: "bus-eo",
    cat: "STRUCTURE",
    name: "Earth-observation platform",
    origin: "Sentinel-2",
    year: 2015,
    mass: 430,
    power: -40,
    spec: "3.4 × 1.8 × 2.4 m",
    capacity: 1200,
    note: "Built around the instrument rather than the other way round: the whole structure exists to hold a telescope rigid to within a few microns across a 100 °C thermal swing.",
    dir: "none",
    slot: "core",
    geom: { kind: "box", w: 2.4, h: 1.8, d: 2.0, mat: "shell" },
  },
  {
    id: "bus-nav",
    cat: "STRUCTURE",
    name: "MEO navigation bus",
    origin: "GPS III",
    year: 2018,
    mass: 1600,
    power: -70,
    spec: "≈2.5 m cube, 15-year life",
    capacity: 5200,
    note: "Designed for 15 years in the middle-Earth radiation belts, which is why it weighs an order of magnitude more than a LEO broadband satellite doing similar electrical work.",
    dir: "none",
    slot: "core",
    geom: { kind: "box", w: 2.5, h: 2.0, d: 2.2, mat: "shell" },
  },
  {
    id: "bus-microgeo",
    cat: "STRUCTURE",
    name: "MicroGEO bus",
    origin: "Astranis",
    year: 2023,
    mass: 105,
    power: -12,
    spec: "≈1.2 m class, GEO",
    capacity: 450,
    note: "A geostationary satellite small enough to rideshare. One of these serves a single country instead of a continent, which changes who can afford to own one.",
    dir: "none",
    slot: "core",
    geom: { kind: "box", w: 1.2, h: 1.2, d: 1.2, mat: "shell" },
  },

  /* ---- POWER ---- */
  {
    id: "wing-single",
    cat: "POWER",
    name: "Single solar wing",
    origin: "Starlink v1.0 / v1.5",
    year: 2019,
    mass: 45,
    power: 3000,
    area: 20,
    spec: "One roll-out wing",
    note: "Unrolls from the plate like a window blind after release. A single wing is simple but asymmetric — it puts the drag centre off-axis, which the attitude system has to fight every orbit.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 8.1, wid: 2.0, panels: 6, sides: 1 },
  },
  {
    id: "wing-dual",
    cat: "POWER",
    name: "Dual aero-neutral wings",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 120,
    power: 8000,
    area: 55,
    spec: "Two wings, drag-balanced",
    note: "Two wings instead of one, arranged so residual atmosphere pushes evenly on both. At 500 km there is still enough air to matter, and 'aero-neutral' means the satellite flies without constantly correcting.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 6.6, wid: 2.4, panels: 5, sides: 2 },
  },
  {
    id: "wing-v3",
    cat: "POWER",
    name: "Stitched-blanket wings",
    origin: "Starlink V3",
    year: 2026,
    mass: 340,
    power: 20000,
    area: 150,
    spec: "4 × 19 m segments per wing",
    note: "SpaceX now produces solar blanket as a continuous roll, cuts it into 19 m lengths and stitches four together per array — closer to textile manufacturing than to spacecraft assembly. Roughly double a V2 wing's output.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 19, wid: 3.0, panels: 10, sides: 2 },
  },
  {
    id: "wing-rigid",
    cat: "POWER",
    name: "Rigid deployable panels",
    origin: "OneWeb Gen 1",
    year: 2019,
    mass: 18,
    power: 1500,
    area: 6,
    spec: "Two hinged panels",
    note: "The conventional answer: aluminium honeycomb panels on a hinge. Heavier per watt than roll-out blankets, but the deployment is a single motion with almost nothing to jam.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 2.4, wid: 1.0, panels: 2, sides: 2 },
  },
  {
    id: "wing-bodycells",
    cat: "POWER",
    name: "Body-mounted cells",
    origin: "Planet SuperDove",
    year: 2019,
    mass: 0.4,
    power: 120,
    area: 0.3,
    spec: "Fixed cells, no deployment",
    note: "No hinges, no motors, nothing to fail. You get only the power that fits on the outside of the satellite, which is why cubesats duty-cycle almost everything.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "panel", w: 0.34, d: 0.1, mat: "solar" },
  },
  {
    id: "wing-eo",
    cat: "POWER",
    name: "Sun-tracking deployable wing",
    origin: "Sentinel-2 / WorldView",
    year: 2015,
    mass: 65,
    power: 2000,
    area: 9,
    spec: "Gimballed, tracks the sun",
    note: "An imaging satellite points its camera at the ground, so the array cannot also face the sun — it gets its own drive and tracks independently. One more mechanism, but the alternative is losing power every time you slew to a target.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 4.2, wid: 1.4, panels: 3, sides: 1 },
  },
  {
    id: "wing-geo",
    cat: "POWER",
    name: "MEO/GEO sun-tracking wings",
    origin: "GPS III",
    year: 2018,
    mass: 95,
    power: 4500,
    area: 24,
    spec: "Radiation-tolerant cells",
    note: "Cells for the radiation belts are built to survive fifteen years of proton damage, so they start oversized and are expected to degrade. Everything about a MEO satellite is planned around slow decline rather than replacement.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 5.4, wid: 1.9, panels: 4, sides: 2 },
  },
  {
    id: "wing-micro",
    cat: "POWER",
    name: "Microsat deployable panels",
    origin: "ICEYE X-series",
    year: 2018,
    mass: 6,
    power: 800,
    area: 2.4,
    spec: "Two folded panels",
    note: "Barely enough to run a radar continuously, which is the point — the satellite images in short bursts and spends the rest of the orbit recharging.",
    dir: "fore",
    slot: "wing",
    geom: { kind: "wing", len: 1.5, wid: 0.7, panels: 2, sides: 2 },
  },
  {
    id: "batt-liion",
    cat: "POWER",
    name: "Li-ion battery block",
    origin: "Common to most LEO buses",
    year: 2010,
    mass: 22,
    power: -2,
    spec: "Eclipse energy store",
    note: "In low orbit the sun sets every 45 minutes, about 5,500 times a year. The battery is usually the first thing to wear out, and it sets the real end of the satellite's life.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.5, h: 0.16, d: 0.4, mat: "dark" },
  },
  {
    id: "batt-mid",
    cat: "POWER",
    name: "Microsat battery pack",
    origin: "ICEYE / smallsat class",
    year: 2015,
    mass: 6,
    power: -1,
    spec: "Buffers imaging bursts",
    note: "Sized not for eclipse but for the radar: the payload wants more power for ninety seconds than the array makes in ten minutes, so the battery covers the difference and then recharges.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.24, h: 0.12, d: 0.2, mat: "dark" },
  },
  {
    id: "batt-small",
    cat: "POWER",
    name: "CubeSat battery",
    origin: "Planet SuperDove",
    year: 2019,
    mass: 0.8,
    power: -0.5,
    spec: "Commercial cells",
    note: "Close relatives of the cells in a power tool. Cubesats fly commercial parts and accept a shorter life, because replacing the satellite is cheaper than qualifying the battery.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.08, h: 0.03, d: 0.07, mat: "dark" },
  },
  {
    id: "batt-hicap",
    cat: "POWER",
    name: "High-capacity eclipse battery",
    origin: "Starlink V2 Mini / V3",
    year: 2023,
    mass: 70,
    power: -5,
    spec: "Capacity not published",
    note: "Sized so the payload keeps serving customers through eclipse instead of going quiet on the night side. Exact chemistry and capacity are among the things SpaceX does not disclose.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.9, h: 0.2, d: 0.6, mat: "dark" },
  },

  /* ---- PROPULSION ---- */
  {
    id: "prop-kr-hall",
    cat: "PROPULSION",
    name: "Krypton Hall thruster",
    origin: "Starlink v1.0 / v1.5",
    year: 2019,
    mass: 14,
    power: -1100,
    thrust: 70,
    isp: 1600,
    prop: 20,
    burst: true,
    spec: "Krypton, electrostatic",
    note: "Ionises gas and throws it out with an electric field. Thrust is about the weight of a paperclip, sustained for months — useless for launch, ideal for raising orbit and dodging debris. Krypton was chosen over xenon on price and supply.",
    dir: "aft",
    slot: "aft",
    geom: { kind: "thruster", r: 0.13, h: 0.22, count: 1 },
  },
  {
    id: "prop-ar-hall",
    cat: "PROPULSION",
    name: "Argon Hall thruster",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 26,
    power: -4200,
    thrust: 170,
    isp: 2500,
    prop: 60,
    burst: true,
    spec: "170 mN · 2,500 s Isp",
    note: "Argon is ~1% of the air around you, so supply scales to thousands of spacecraft a year. It is not a drop-in swap: lighter atoms needed a purpose-built thruster running at different voltage and flow. SpaceX reports 2.4× the thrust and 1.5× the efficiency of the krypton unit.",
    dir: "aft",
    slot: "aft",
    geom: { kind: "thruster", r: 0.17, h: 0.28, count: 1 },
  },
  {
    id: "prop-ar-v3",
    cat: "PROPULSION",
    name: "Argon cluster, V3 class",
    origin: "Starlink V3",
    year: 2026,
    mass: 75,
    power: -9000,
    thrust: 500,
    isp: 2500,
    prop: 200,
    burst: true,
    spec: "Propellant and thrust not disclosed",
    note: "V3 flies a planned 330–370 km shell, low enough that drag is a daily problem, so it needs far more total impulse than anything before it. SpaceX has published no figures — treat this entry as a scenario, not a spec.",
    dir: "aft",
    slot: "aft",
    geom: { kind: "thruster", r: 0.19, h: 0.3, count: 2 },
  },
  {
    id: "prop-xe-hall",
    cat: "PROPULSION",
    name: "Xenon Hall thruster",
    origin: "OneWeb Gen 1",
    year: 2019,
    mass: 9,
    power: -800,
    thrust: 20,
    isp: 1400,
    prop: 8,
    burst: true,
    spec: "Xenon, electrostatic",
    note: "Heavy atoms make an efficient thruster, but xenon is a rare trace gas with a constrained market. Fine for hundreds of satellites; awkward for tens of thousands.",
    dir: "aft",
    slot: "aft",
    geom: { kind: "thruster", r: 0.1, h: 0.16, count: 1 },
  },
  {
    id: "prop-mono",
    cat: "PROPULSION",
    name: "Hydrazine monopropellant",
    origin: "Sentinel-2 / GPS III",
    year: 2000,
    mass: 30,
    power: -60,
    thrust: 1000,
    isp: 220,
    prop: 120,
    burst: true,
    spec: "≈1 N thrusters",
    note: "Hydrazine over a catalyst bed — instant thrust, no waiting, no power budget. It is also violently toxic, which is why fuelling is done in suits and why electric propulsion took over wherever patience is acceptable.",
    dir: "aft",
    slot: "aft",
    geom: { kind: "thruster", r: 0.07, h: 0.14, count: 4, plume: false },
  },
  {
    id: "prop-coldgas",
    cat: "PROPULSION",
    name: "Butane cold-gas system",
    origin: "ICEYE X-series",
    year: 2018,
    mass: 3,
    power: -15,
    thrust: 40,
    isp: 70,
    prop: 2,
    burst: true,
    spec: "Stored liquid, vents as gas",
    note: "The simplest possible thruster: open a valve and let gas out. Terrible efficiency, but it stores as a liquid at room pressure and cannot explode, which is what a rideshare provider wants to hear.",
    dir: "aft",
    slot: "aft",
    geom: { kind: "thruster", r: 0.05, h: 0.1, count: 2, plume: false },
  },
  {
    id: "tank-cots",
    cat: "PROPULSION",
    name: "Composite propellant tank",
    origin: "Common",
    year: 2010,
    mass: 12,
    power: 0,
    spec: "Carbon-overwrapped pressure vessel",
    note: "Carbon fibre wound over a thin metal liner. Most of a satellite's launch mass on a long mission is the stuff it plans to throw away.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "cylinder", r: 0.19, h: 0.5, mat: "white" },
  },

  /* ---- ATTITUDE ---- */
  {
    id: "tank-apogee",
    cat: "PROPULSION",
    name: "Orbit-raising propellant load",
    origin: "GPS III / GEO transfers",
    year: 1990,
    mass: 70,
    power: 0,
    prop: 1500,
    isp: 315,
    thrust: 450,
    spec: "≈1,500 kg bipropellant",
    note: "A satellite going to medium or geostationary orbit is dropped in a transfer ellipse and has to circularise itself. Most of what stands on the pad is fuel for a burn that happens days after launch.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "cylinder", r: 0.42, h: 1.0, mat: "white" },
  },
  {
    id: "adcs-wheels",
    cat: "ATTITUDE",
    name: "Reaction wheels, hot spare",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 16,
    power: -90,
    spec: "4 wheels, 3 axes",
    pointing: 2,
    note: "Spin a flywheel one way and the satellite turns the other. Four wheels for three axes means any one can fail and the satellite keeps pointing — including all the way down through a targeted reentry.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "wheels", r: 0.12, h: 0.07, count: 4 },
  },
  {
    id: "adcs-micro",
    cat: "ATTITUDE",
    name: "Micro reaction wheel set",
    origin: "ICEYE / smallsat class",
    year: 2016,
    mass: 2.5,
    power: -20,
    spec: "3 axes, ~10 mNm·s each",
    pointing: 2,
    note: "The same physics as a large wheel, shrunk until it fits in a fist. Slew rate is what limits how many targets a small imaging satellite can catch on one pass.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "wheels", r: 0.05, h: 0.035, count: 3 },
  },
  {
    id: "adcs-startracker",
    cat: "ATTITUDE",
    name: "Star-field navigation cameras",
    origin: "Starlink (\u201cStar Trekker\u201d)",
    year: 2019,
    mass: 4,
    power: -18,
    spec: "Arcsecond-class attitude",
    pointing: 3,
    note: "Photographs the sky and matches it against a star catalogue to work out which way it is facing, to a few arcseconds. Nothing else on a satellite knows its orientation this well.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "tracker", r: 0.07, h: 0.24, count: 2 },
  },
  {
    id: "adcs-gnss-micro",
    cat: "ATTITUDE",
    name: "CubeSat GNSS receiver",
    origin: "CubeSat standard",
    year: 2014,
    mass: 0.2,
    power: -1.2,
    spec: "Position to a few metres",
    note: "A commercial GPS chip with the altitude and velocity limits unlocked. Export rules cap ordinary receivers at 18 km and 515 m/s precisely so they cannot guide a missile — orbital receivers need that ceiling removed.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "patch", w: 0.05, d: 0.05, mat: "copper" },
  },
  {
    id: "adcs-magnetorquer",
    cat: "ATTITUDE",
    name: "Magnetorquer rods",
    origin: "Common to LEO smallsats",
    year: 2005,
    mass: 0.3,
    power: -1.5,
    spec: "Push against Earth's field",
    pointing: 0,
    note: "Electromagnets that shove against the planet's magnetic field. No moving parts and no propellant, but they only work in low orbit and only slowly — mainly used to bleed momentum back out of the reaction wheels.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.3, h: 0.04, d: 0.04, mat: "copper" },
  },
  {
    id: "adcs-gnss",
    cat: "ATTITUDE",
    name: "GNSS receiver",
    origin: "Common",
    year: 2005,
    mass: 1.5,
    power: -10,
    spec: "Onboard position and velocity",
    note: "The satellite reads GPS just like a phone does. Knowing its own state vector to metres is what makes autonomous collision-avoidance planning possible at all.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "patch", w: 0.14, d: 0.14, mat: "copper" },
  },
  {
    id: "adcs-finepoint",
    cat: "ATTITUDE",
    name: "Fine-pointing gimbal set",
    origin: "Optical terminal hosts",
    year: 2021,
    mass: 7,
    power: -35,
    spec: "Sub-milliradian steering",
    pointing: 4,
    note: "Aiming a laser at a satellite thousands of kilometres away, while both are moving at 7.5 km/s, needs steering finer than the whole spacecraft can manage. So the terminal gets its own gimbals.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.22, h: 0.1, d: 0.22, mat: "white" },
  },

  /* ---- USER LINK ---- */
  {
    id: "ku-array-1",
    rf: { band: "Ku", w: 0.52, h: 0.52, esas: 4, beams: 16 },
    cat: "USER LINK",
    name: "Ku-band phased array",
    origin: "Starlink v1.0",
    year: 2019,
    mass: 30,
    power: -700,
    downlink: 17,
    spec: "10.7–12.7 GHz down · 14.0–14.5 up",
    note: "A flat panel of many small antennas. Change the timing between them and the beam points somewhere else — no motor, no dish, and it can serve several patches of ground at once while flying overhead at 7.5 km/s.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "tiles", w: 2.4, d: 1.5, rows: 3, cols: 5 },
  },
  {
    id: "ku-array-5",
    rf: { band: "Ku", w: 0.55, h: 0.55, esas: 4, beams: 48 },
    cat: "USER LINK",
    name: "Five Ku phased arrays",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 95,
    power: -3200,
    downlink: 96,
    spec: "96 Gbps downlink per satellite",
    note: "Four times the user capacity of a V1.5, from more array area and better digital beamforming. The published 96 Gbps is what the satellite can pour out in total, shared across every beam and every customer under it.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "tiles", w: 3.8, d: 2.3, rows: 4, cols: 6 },
  },
  {
    id: "ku-array-v3",
    rf: { band: "Ku", w: 0.6, h: 0.6, esas: 8, beams: 96 },
    cat: "USER LINK",
    name: "Next-gen Ku arrays, V3",
    origin: "Starlink V3",
    year: 2026,
    mass: 300,
    power: -9000,
    downlink: 1024,
    spec: "1 Tbps down · >160 Gbps up",
    note: "About ten times a V2 Mini's downlink and over twenty times its uplink, from new modems, beamforming and switching hardware. Your existing dish still talks to it on the same Ku frequencies — nothing changes on the ground.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "tiles", w: 6.0, d: 3.0, rows: 5, cols: 8 },
  },
  {
    id: "dtc-array",
    rf: { band: "DTC", w: 2.7, h: 2.3, beams: 48 },
    cat: "USER LINK",
    name: "Direct-to-Cell array",
    origin: "Starlink V1 Mobile",
    year: 2024,
    mass: 90,
    power: -2600,
    downlink: 7,
    spec: "Partner mobile spectrum",
    note: "A cell tower that happens to be in orbit — the satellite runs eNodeB functions and talks to an ordinary unmodified phone. Capacity is tiny next to broadband, which is why it carries texts and light data rather than video.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "tiles", w: 2.7, d: 2.3, rows: 4, cols: 4 },
  },
  {
    id: "bluebird-array",
    rf: { band: "DTC", w: 14, h: 14 },
    cat: "USER LINK",
    name: "Unfolding micron array",
    origin: "AST SpaceMobile BlueBird 2",
    year: 2025,
    mass: 2200,
    power: -3600,
    downlink: 40,
    area: 223,
    spec: "≈223 m² deployed aperture",
    note: "The largest commercial array ever unfolded in low orbit. AST's bet is the opposite of Starlink's: instead of many small satellites, build one enormous antenna so an ordinary phone can close the link.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "tiles", w: 14, d: 14, rows: 6, cols: 6, thin: true },
  },
  {
    id: "ku-fixed",
    rf: { band: "Ku", w: 0.9, h: 0.9 },
    cat: "USER LINK",
    name: "Fixed Ku beam set",
    origin: "OneWeb Gen 1",
    year: 2019,
    mass: 22,
    power: -700,
    downlink: 8,
    spec: "16 fixed beams",
    note: "Beams that stay put relative to the satellite and sweep the ground as it flies. Simpler and cheaper than steering, but the handover between satellites has to be perfectly choreographed.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "tiles", w: 0.9, d: 0.9, rows: 2, cols: 2 },
  },

  /* ---- BACKHAUL ---- */
  {
    id: "ka-gateway",
    rf: { band: "Ka", w: 0.7, h: 0.7, aperture: true },
    cat: "BACKHAUL",
    name: "Ka-band gateway antenna",
    origin: "Starlink v1.0",
    year: 2019,
    mass: 18,
    power: -320,
    spec: "17.8–19.3 GHz down · 27.5–30.0 up",
    note: "The link that connects the satellite back to the internet. Customer traffic goes up on Ku and comes down to a gateway dish on Ka; heavy rain on the gateway can close it, so operators build several and switch.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "dish", r: 0.35, depth: 0.12, count: 2 },
  },
  {
    id: "ttc-uhf",
    cat: "BACKHAUL",
    name: "CubeSat command radio",
    origin: "SuperDove / cubesat standard",
    year: 2013,
    mass: 0.35,
    power: -6,
    spec: "UHF/S-band, low rate",
    note: "A few kilobits per second, enough to ask the satellite how it is and tell it what to do next. Small spacecraft still separate this from the payload downlink, for the same reason big ones do.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "patch", w: 0.07, d: 0.07, mat: "gold" },
  },
  {
    id: "xband-small",
    cat: "BACKHAUL",
    name: "Compact X-band transmitter",
    origin: "SuperDove / smallsat imaging",
    year: 2017,
    mass: 0.9,
    power: -35,
    spec: "≈200 Mbps in short passes",
    note: "The whole day's images have to leave in the eight minutes the satellite is over a ground station. Everything about a small imaging satellite's schedule is arranged around that window.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "patch", w: 0.09, d: 0.09, mat: "copper" },
  },
  {
    id: "ka-e-dual",
    rf: { band: "E", w: 0.6, h: 0.6, aperture: true },
    cat: "BACKHAUL",
    name: "Ka/E dual-band antennas",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 40,
    power: -1100,
    spec: "E-band 71–76 / 81–86 GHz",
    note: "E-band opened five whole gigahertz of feeder spectrum in 2024. Much more room than Ka, but the beams are narrower and the atmosphere is less forgiving, so pointing and weather margins get tight.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "dish", r: 0.3, depth: 0.1, count: 3 },
  },
  {
    id: "doppio",
    rf: { band: "Ka", w: 0.68, h: 0.68, aperture: true },
    cat: "BACKHAUL",
    name: "\u201cDoppio\u201d dual-band backhaul",
    origin: "Starlink V2 Mini Optimized",
    year: 2025,
    mass: 30,
    power: -900,
    spec: "Two bands, one aperture",
    note: "One antenna doing the work of two, which is where a good part of the Optimized variant's 22% mass saving came from. Fewer apertures, less structure, more satellites per launch.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "dish", r: 0.34, depth: 0.11, count: 2 },
  },
  {
    id: "eband-v3",
    rf: { band: "E", w: 0.66, h: 0.66, aperture: true },
    cat: "BACKHAUL",
    name: "E-band backhaul cluster",
    origin: "Starlink V3",
    year: 2026,
    mass: 90,
    power: -2400,
    spec: "Part of ~4 Tbps combined backhaul",
    note: "The published 'nearly 4 Tbps' figure covers RF and laser backhaul together — it is the satellite's total capacity to move traffic onward, not a number any single link reaches.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "dish", r: 0.33, depth: 0.11, count: 4 },
  },
  {
    id: "ttc-sband",
    cat: "BACKHAUL",
    name: "S-band TT&C transponder",
    origin: "Universal",
    year: 1960,
    mass: 6,
    power: -40,
    spec: "Telemetry, tracking and command",
    note: "The command link, deliberately kept separate from customer traffic and deliberately low-rate. If everything else on the spacecraft fails, this is the channel operators use to find out why and to bring it home.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "patch", w: 0.2, d: 0.2, mat: "gold" },
  },
  {
    id: "xband-down",
    cat: "BACKHAUL",
    name: "X-band science downlink",
    origin: "Sentinel-2 / imaging fleets",
    year: 2015,
    mass: 9,
    power: -320,
    spec: "≈560 Mbps to ground station",
    note: "Imaging satellites store data and dump it in a few minutes as they pass over a ground station. The bottleneck is usually not the camera — it is how much you can offload per pass.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "dish", r: 0.4, depth: 0.14, count: 1 },
  },

  /* ---- OPTICAL ---- */
  {
    id: "isl-3x200",
    cat: "OPTICAL",
    name: "Three optical ISL terminals",
    origin: "Starlink V2 Mini",
    year: 2023,
    mass: 45,
    power: -600,
    isl: 600,
    needsPointing: 3,
    spec: "3 × up to 200 Gbps",
    note: "Infrared lasers between spacecraft, roughly 100 Gbps per transceiver and good to 5,400 km. A SpaceX engineer told SPIE Photonics West the mesh was already carrying over 42 petabytes a day across more than 9,000 terminals, re-acquiring links about 266,000 times daily. A satellite over the mid-Pacific relays across moving neighbours until one can see a gateway.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "laser", r: 0.11, count: 3 },
  },
  {
    id: "isl-6x400",
    cat: "OPTICAL",
    name: "Six 400 Gbps laser terminals",
    origin: "Starlink V3",
    year: 2026,
    mass: 130,
    power: -1500,
    isl: 2400,
    needsPointing: 4,
    spec: "6 × 400 Gbps",
    note: "Six links per satellite instead of three means every node has redundant paths, so the mesh routes around a failure without dropping the session. Starlink describes the result as a petabit-scale laser network.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "laser", r: 0.12, count: 6 },
  },
  {
    id: "isl-mini",
    cat: "OPTICAL",
    name: "Hosted mini laser terminal",
    origin: "Mini Laser demo, 2025",
    year: 2025,
    mass: 12,
    power: -120,
    isl: 25,
    needsPointing: 3,
    spec: ">25 Gbps demonstrated",
    note: "A small terminal designed to bolt onto somebody else's satellite and join the Starlink mesh. Two demo units on third-party buses pushed more than 25 Gbps into the network in 2025.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "laser", r: 0.08, count: 1 },
  },

  /* ---- PAYLOAD ---- */
  {
    id: "pay-sar",
    cat: "PAYLOAD",
    name: "X-band SAR antenna",
    origin: "ICEYE X-series",
    year: 2018,
    mass: 22,
    power: -1800,
    burst: true,
    spec: "≈3.2 m active aperture",
    note: "Radar imaging: the satellite lights up the ground itself and listens to the echo. It sees through cloud and works at night, which is why flood and conflict mapping runs on SAR rather than cameras.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "panel", w: 3.2, d: 0.7, mat: "gold" },
  },
  {
    id: "pay-msi",
    cat: "PAYLOAD",
    name: "Multispectral imager",
    origin: "Sentinel-2",
    year: 2015,
    mass: 290,
    power: -270,
    spec: "13 bands · 10–60 m",
    note: "Splits the view into thirteen colour bands, several of them invisible to us. The difference between two infrared bands is how you measure whether a crop is healthy from 786 km up — and the data is free to anyone.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "telescope", r: 0.55, len: 1.3 },
  },
  {
    id: "pay-hires",
    cat: "PAYLOAD",
    name: "High-resolution telescope",
    origin: "Maxar WorldView Legion",
    year: 2024,
    mass: 340,
    power: -400,
    spec: "≈30 cm class ground sample",
    note: "At 30 cm per pixel you can count cars and tell a lorry from a bus. The mirror is the expensive part and the pointing is the hard part — the satellite has to slew, settle and shoot in seconds.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "telescope", r: 0.65, len: 1.9 },
  },
  {
    id: "pay-dove",
    cat: "PAYLOAD",
    name: "Compact Dove imager",
    origin: "Planet SuperDove",
    year: 2019,
    mass: 1.4,
    power: -14,
    spec: "8 bands · ≈3 m",
    note: "A telescope built from commercial optics, cheap enough to fly two hundred of them. Individually unremarkable; collectively they photograph the entire land surface of Earth every single day.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "telescope", r: 0.045, len: 0.2 },
  },
  {
    id: "pay-nav",
    cat: "PAYLOAD",
    name: "Navigation payload + atomic clocks",
    origin: "GPS III",
    year: 2018,
    mass: 320,
    power: -1900,
    spec: "Rubidium standards, L-band",
    note: "GPS is a clock broadcast, not a map. The satellite tells you the time so precisely that your receiver can turn the delay into a position — and the clocks must be corrected for relativity or the fix drifts kilometres a day.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "panel", w: 2.0, d: 1.6, mat: "gold" },
  },
  {
    id: "pay-ais",
    cat: "PAYLOAD",
    name: "AIS ship receiver",
    origin: "Maritime domain smallsats",
    year: 2012,
    mass: 3,
    power: -12,
    spec: "VHF 161.975 / 162.025 MHz",
    note: "Listens for the position beacons ships broadcast to avoid hitting each other. From orbit you hear a whole ocean at once — which also makes it obvious when a vessel switches its beacon off.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "whip", len: 1.1 },
  },

  /* ---- AVIONICS & THERMAL ---- */
  {
    id: "avi-computer",
    cat: "AVIONICS",
    name: "Flight computer stack",
    origin: "Common",
    year: 2015,
    mass: 9,
    power: -60,
    spec: "Redundant processors",
    note: "Radiation flips bits in memory, so flight software is written expecting its own hardware to lie to it. Voting between redundant processors is cheaper than making one processor perfect.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.36, h: 0.12, d: 0.28, mat: "dark" },
  },
  {
    id: "avi-micro",
    cat: "AVIONICS",
    name: "Compact avionics stack",
    origin: "CubeSat / microsat class",
    year: 2016,
    mass: 0.4,
    power: -8,
    spec: "Single-board computer",
    note: "Commercial silicon flown with a watchdog and a plan for when radiation upsets it. Reboot and carry on is a legitimate design strategy when the satellite cost less than the test campaign would have.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 0.09, h: 0.03, d: 0.09, mat: "dark" },
  },
  {
    id: "avi-v3modem",
    cat: "AVIONICS",
    name: "Next-gen modem and switch",
    origin: "Starlink V3",
    year: 2026,
    mass: 110,
    power: -3000,
    spec: "Beamforming and packet switching",
    note: "The part that makes V3 a different machine rather than a bigger one. Every beam, every laser and every gateway link is routed here — the satellite is a router that happens to be in orbit.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "box", w: 1.0, h: 0.18, d: 0.7, mat: "dark" },
  },
  {
    id: "th-radiator",
    cat: "THERMAL",
    name: "Radiator panel",
    origin: "Common",
    year: 2000,
    mass: 15,
    power: -4,
    spec: "Rejects waste heat to deep space",
    note: "Vacuum is an excellent insulator, so a satellite's problem is usually getting rid of heat, not keeping it. Radiators face cold sky and are painted to emit infrared while reflecting sunlight.",
    dir: "up",
    slot: "zenith",
    geom: { kind: "panel", w: 1.2, d: 0.8, mat: "white" },
  },
  {
    id: "br-visor",
    cat: "BRIGHTNESS",
    name: "VisorSat sun visor",
    origin: "Starlink v1.0, from Aug 2020",
    year: 2020,
    mass: 3,
    power: 0,
    spec: "Median magnitude 6.62",
    note: "A deployable shade that keeps sunlight off the white antenna surfaces, made of material radio waves pass straight through. Astronomers measured it at magnitude 6.62 against 5.37 for a bare v1.0 — roughly a third of the brightness, though still short of the magnitude 7 the community asked for.",
    dir: "down",
    slot: "nadir",
    geom: { kind: "panel", w: 2.6, d: 1.7, mat: "dark" },
  },
  {
    id: "br-darksat",
    cat: "BRIGHTNESS",
    name: "DarkSat low-albedo coating",
    origin: "STARLINK-1130, Jan 2020",
    year: 2020,
    mass: 1,
    power: 0,
    spec: "Median magnitude 8.43",
    note: "Paint one side black and the satellite nearly disappears — magnitude 8.43, the darkest Starlink ever measured. It was also the last: a black satellite absorbs the heat it used to reflect, and the thermal problems ended the experiment after two units.",
    dir: "up",
    slot: "shell",
    geom: { kind: "blanket", mat: "dark" },
  },
  {
    id: "br-mirror",
    cat: "BRIGHTNESS",
    name: "Dielectric mirror film",
    origin: "Starlink v1.5 onward",
    year: 2021,
    mass: 2,
    power: 0,
    spec: "Median magnitude 6.11",
    note: "Instead of absorbing sunlight or blocking it, reflect it away from the ground. A stack of transparent layers acts as a mirror that sends the glare off into space rather than down a telescope — and unlike black paint, it does not cook the spacecraft.",
    dir: "up",
    slot: "shell",
    geom: { kind: "blanket", mat: "white" },
  },
  {
    id: "th-mli",
    cat: "THERMAL",
    name: "MLI blanket",
    origin: "Universal",
    year: 1960,
    mass: 5,
    power: 0,
    spec: "Multi-layer insulation",
    note: "The gold crinkle on every spacecraft photograph. Dozens of near-weightless reflective layers separated by mesh, so heat has to cross each one by radiation alone. The colour is just what polyimide looks like.",
    dir: "up",
    slot: "shell",
    geom: { kind: "blanket" },
  },
];

export const PART_BY_ID: Record<string, Part> = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export const CATS = [
  "STRUCTURE",
  "POWER",
  "PROPULSION",
  "ATTITUDE",
  "USER LINK",
  "BACKHAUL",
  "OPTICAL",
  "PAYLOAD",
  "AVIONICS",
  "THERMAL",
  "BRIGHTNESS",
];

/* ------------------------------------------------------------ SPACECRAFT -- */

export const FLEET: Spacecraft[] = [
  {
    id: "sl-v09",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink v0.9",
    year: 2019,
    built: 60,
    status: "Retired",
    mass: 227,
    alt: 550,
    inc: 53,
    blurb:
      "The first sixty. No inter-satellite links, no sunshade, and every one of them deliberately deorbited — this batch existed to prove the flat-pack stack and the production line, not to sell internet.",
    parts: [
      "bus-flatpack",
      "wing-single",
      "batt-liion",
      "prop-kr-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "ku-array-1",
      "ka-gateway",
      "ttc-sband",
      "avi-computer",
      "th-mli",
    ],
  },
  {
    id: "sl-v10",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink v1.0",
    year: 2019,
    built: 1665,
    status: "Legacy, mostly retired",
    mass: 260,
    alt: 550,
    inc: 53,
    blurb:
      "The first version that carried paying customers. Traffic could only flow where one satellite saw both a user and a gateway at once, so coverage stopped at the edge of the ground-station map.",
    parts: [
      "bus-flatpack",
      "wing-single",
      "batt-liion",
      "prop-kr-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-magnetorquer",
      "ku-array-1",
      "ka-gateway",
      "ttc-sband",
      "avi-computer",
      "th-mli",
      "br-visor",
    ],
  },
  {
    id: "sl-v15",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink v1.5",
    year: 2021,
    built: 2987,
    status: "Legacy fleet active",
    mass: 306,
    alt: 540,
    inc: 53,
    blurb:
      "Lasers arrive. Once satellites could pass traffic to each other, Starlink stopped being limited by where SpaceX could build ground stations, and polar and mid-ocean coverage became possible.",
    parts: [
      "bus-flatpack",
      "wing-single",
      "batt-liion",
      "prop-kr-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-finepoint",
      "ku-array-1",
      "ka-gateway",
      "isl-mini",
      "ttc-sband",
      "avi-computer",
      "th-mli",
      "br-mirror",
    ],
  },
  {
    id: "sl-v2mini",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink V2 Mini",
    year: 2023,
    built: 7424,
    status: "Active Gen2",
    mass: 800,
    alt: 525,
    inc: 43,
    blurb:
      "A V2 shrunk to fit a Falcon 9, because Starship was not ready. Four times the user capacity of a V1.5, dual drag-balanced wings, and argon thrusters chosen so propellant supply could scale with the factory.",
    parts: [
      "bus-v2mini",
      "wing-dual",
      "batt-hicap",
      "prop-ar-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-finepoint",
      "ku-array-5",
      "ka-e-dual",
      "isl-3x200",
      "ttc-sband",
      "avi-computer",
      "th-radiator",
      "th-mli",
      "br-mirror",
    ],
  },
  {
    id: "sl-v2opt",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink V2 Mini Optimized",
    year: 2025,
    built: null,
    status: "Current Falcon 9 production",
    mass: 575,
    alt: 525,
    inc: 43,
    blurb:
      "The same capability at 22% less mass. Nothing here is a breakthrough — it is a year of taking grams out of brackets and merging two antennas into one, which bought six more satellites per launch.",
    parts: [
      "bus-v2opt",
      "wing-dual",
      "batt-hicap",
      "prop-ar-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-finepoint",
      "ku-array-5",
      "doppio",
      "isl-3x200",
      "ttc-sband",
      "avi-computer",
      "th-radiator",
      "th-mli",
    ],
  },
  {
    id: "sl-dtc",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink V1 Mobile (Direct to Cell)",
    year: 2024,
    built: null,
    status: "Active, separate constellation",
    mass: 800,
    alt: 360,
    inc: 53,
    blurb:
      "A different animal wearing the same name. These carry a cell tower rather than broadband arrays, and SpaceX's own filings keep the mobile and broadband constellations apart — not every V2 does direct-to-cell.",
    parts: [
      "bus-v2mini",
      "wing-dual",
      "batt-hicap",
      "prop-ar-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-finepoint",
      "dtc-array",
      "ka-e-dual",
      "isl-3x200",
      "ttc-sband",
      "avi-computer",
      "th-radiator",
      "th-mli",
    ],
  },
  {
    id: "sl-v3",
    op: "SpaceX",
    family: "Starlink",
    name: "Starlink V3",
    year: 2026,
    built: 20,
    status: "Flight-tested, none operational",
    mass: 1500,
    alt: 350,
    inc: 53,
    blurb:
      "Twenty flew on Starship Flight 13 on 24 July 2026 — but on a suborbital arc. They unfolded arrays and antennas, linked to the constellation by laser and to a ground station in South Africa, then burned up on reentry twenty minutes later, exactly as planned. Not one V3 is in service.",
    caution:
      "No V3 is operational. The first launch attempt aborted on 16 July when four booster engines failed to light; the 24 July flight deployed 20 working satellites suborbitally and demised them on purpose. Mass, dimensions and layout are undisclosed — reported figures run from ~1,500 kg to a 2,000 kg FCC filing scenario.",
    parts: [
      "bus-v3",
      "wing-v3",
      "batt-hicap",
      "prop-ar-v3",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-finepoint",
      "ku-array-v3",
      "eband-v3",
      "isl-6x400",
      "ttc-sband",
      "avi-v3modem",
      "th-radiator",
      "th-mli",
      "br-mirror",
    ],
  },
  {
    id: "ow-g1",
    op: "Eutelsat OneWeb",
    family: "OneWeb",
    name: "OneWeb Gen 1",
    year: 2019,
    built: 648,
    status: "Operational",
    mass: 150,
    alt: 1200,
    inc: 87.9,
    blurb:
      "Built on an aircraft-style production line at roughly two per day. Flies four times higher than Starlink, so fewer satellites cover the globe — at the cost of latency and of a much longer wait before a dead one comes down.",
    parts: [
      "bus-smallsat",
      "wing-rigid",
      "batt-liion",
      "prop-xe-hall",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "ku-fixed",
      "ka-gateway",
      "ttc-sband",
      "avi-computer",
      "th-mli",
    ],
  },
  {
    id: "ast-bb2",
    op: "AST SpaceMobile",
    family: "BlueBird",
    name: "BlueBird Block 2",
    year: 2025,
    built: null,
    status: "Deploying",
    mass: 6000,
    alt: 520,
    inc: 53,
    blurb:
      "The opposite bet to Starlink: rather than many small satellites, unfold a single 223 m² antenna so an ordinary phone can close the link. The largest commercial array ever deployed in low orbit.",
    parts: [
      "bus-bluebird",
      "wing-dual",
      "batt-hicap",
      "prop-ar-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "bluebird-array",
      "ka-gateway",
      "ttc-sband",
      "avi-computer",
      "th-mli",
    ],
  },
  {
    id: "iceye-x",
    op: "ICEYE",
    family: "X-series",
    name: "ICEYE X-series SAR",
    year: 2018,
    built: 40,
    status: "Operational",
    mass: 85,
    alt: 570,
    inc: 97.6,
    blurb:
      "Radar imaging in a suitcase. Sees through cloud and darkness, which is why flood mapping, sea ice and conflict monitoring depend on it — a camera would be looking at weather half the time.",
    parts: [
      "bus-sarmicro",
      "wing-micro",
      "batt-mid",
      "prop-coldgas",
      "adcs-micro",
      "adcs-startracker",
      "adcs-gnss-micro",
      "pay-sar",
      "xband-down",
      "ttc-uhf",
      "avi-micro",
      "th-mli",
    ],
  },
  {
    id: "planet-dove",
    op: "Planet Labs",
    family: "Flock",
    name: "SuperDove (Flock 4)",
    year: 2019,
    built: 200,
    status: "Operational",
    mass: 5,
    alt: 475,
    inc: 97.4,
    blurb:
      "A 3U cubesat with no propulsion at all — it drifts, images, and eventually burns up. On its own it is unremarkable; two hundred of them photograph every landmass on Earth daily.",
    parts: [
      "bus-cubesat",
      "wing-bodycells",
      "batt-small",
      "adcs-magnetorquer",
      "adcs-gnss-micro",
      "pay-dove",
      "xband-small",
      "ttc-uhf",
      "avi-micro",
    ],
  },
  {
    id: "sentinel-2",
    op: "ESA / Copernicus",
    family: "Sentinel",
    name: "Sentinel-2",
    year: 2015,
    built: 4,
    status: "Operational",
    mass: 1140,
    alt: 786,
    inc: 98.6,
    blurb:
      "Thirteen spectral bands, a five-day revisit, and every pixel free to anyone who wants it. Most of what the world knows about deforestation and crop health starts as a Sentinel-2 scene.",
    parts: [
      "bus-eo",
      "wing-eo",
      "batt-liion",
      "prop-mono",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "pay-msi",
      "xband-down",
      "ttc-sband",
      "avi-computer",
      "th-radiator",
      "th-mli",
    ],
  },
  {
    id: "legion",
    op: "Maxar",
    family: "WorldView",
    name: "WorldView Legion",
    year: 2024,
    built: 6,
    status: "Operational",
    mass: 1400,
    alt: 500,
    inc: 45,
    blurb:
      "30 cm imaging that can revisit the same spot up to fifteen times a day. The hard part is not the mirror — it is slewing, settling and shooting fast enough to catch several targets on one pass.",
    parts: [
      "bus-eo",
      "wing-eo",
      "batt-liion",
      "prop-mono",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "adcs-gnss",
      "adcs-finepoint",
      "pay-hires",
      "xband-down",
      "ttc-sband",
      "avi-computer",
      "th-radiator",
      "th-mli",
    ],
  },
  {
    id: "gps-iii",
    op: "U.S. Space Force",
    family: "GPS",
    name: "GPS III",
    year: 2018,
    built: 10,
    status: "Operational",
    mass: 3880,
    alt: 20180,
    inc: 55,
    blurb:
      "Twenty thousand kilometres up, designed for fifteen years in the radiation belts. It does not know where you are — it broadcasts the time so precisely that your phone can work the rest out.",
    parts: [
      "bus-nav",
      "wing-geo",
      "batt-liion",
      "tank-apogee",
      "prop-mono",
      "adcs-wheels",
      "adcs-startracker",
      "pay-nav",
      "ttc-sband",
      "avi-computer",
      "th-radiator",
      "th-mli",
    ],
  },
  {
    id: "astranis",
    op: "Astranis",
    family: "MicroGEO",
    name: "Astranis MicroGEO",
    year: 2023,
    built: null,
    status: "Operational",
    mass: 350,
    alt: 35786,
    inc: 0,
    blurb:
      "A geostationary satellite small enough to rideshare, dedicated to one country instead of a continent. It changes not what the hardware can do, but who can afford to own any of it.",
    parts: [
      "bus-microgeo",
      "wing-rigid",
      "batt-liion",
      "prop-xe-hall",
      "tank-cots",
      "adcs-wheels",
      "adcs-startracker",
      "ku-fixed",
      "ka-gateway",
      "ttc-sband",
      "avi-computer",
      "th-mli",
    ],
  },
];

/* Gen1 shells as licensed by the FCC. Real occupancy runs below the design
   figure — the 53.0° shell targets 1,584 and sits nearer 1,500. */
export const SHELLS = [
  { inc: 53.0, alt: 550, planes: 72, per: 22, total: 1584 },
  { inc: 70.0, alt: 570, planes: 36, per: 20, total: 720 },
  { inc: 97.6, alt: 560, planes: 6, per: 58, total: 348 },
  { inc: 53.2, alt: 540, planes: 72, per: 22, total: 1584 },
  { inc: 97.6, alt: 560, planes: 4, per: 43, total: 172 },
];

/* --------------------------------------------------------------- ANALYSIS -- */

export function analyze(parts: Part[]) {
  let mass = 0,
    gen = 0,
    load = 0,
    burst = 0,
    down = 0,
    isl = 0,
    thrust = 0,
    isp = 0,
    prop = 0,
    area = 0,
    pointing = 0;
  for (const p of parts) {
    mass += p.mass || 0;
    if ((p.power || 0) > 0) gen += p.power;
    else if (p.burst) burst += -(p.power || 0);
    else load += -(p.power || 0);
    down += p.downlink || 0;
    isl += p.isl || 0;
    if (p.thrust) {
      thrust += p.thrust;
      isp = Math.max(isp, p.isp || 0);
      prop += p.prop || 0;
    }
    area += p.area || 0;
    pointing = Math.max(pointing, p.pointing || 0);
  }
  const wet = mass + prop;
  const dv = prop > 0 && isp > 0 ? isp * 9.80665 * Math.log(wet / mass) : 0;
  return {
    mass: wet,
    dry: mass,
    gen,
    load,
    burst,
    peak: load + burst,
    dv,
    margin: gen - load,
    down,
    isl,
    thrust,
    isp,
    prop,
    area,
    pointing,
    perF9: wet > 0 ? Math.floor(15600 / wet) : 0,
    perStarship: wet > 0 ? Math.floor(40000 / wet) : 0,
  };
}

export function validate(parts: Part[], a: any): [string, string, string][] {
  const has = (cat: string) => parts.some((p) => p.cat === cat);
  const bus = parts.find((p) => p.cat === "STRUCTURE");
  const out: [string, string, string][] = [];
  if (!bus)
    out.push(["error", "No structure", "Pick a bus. Everything else bolts to it."]);
  if (!has("POWER") || a.gen <= 0)
    out.push(["error", "No power source", "Add a solar array or body-mounted cells."]);
  if (a.margin < 0)
    out.push([
      "error",
      "Continuous load exceeds generation",
      `Housekeeping and payload draw ${Math.round(a.load)} W against ${Math.round(a.gen)} W generated. Cut load or add array.`,
    ]);
  if (a.burst > 0 && a.peak > a.gen)
    out.push([
      "note",
      "Bursts run off the battery",
      `Everything on at once draws ${Math.round(a.peak)} W, above the ${Math.round(a.gen)} W the array makes. Real operators duty-cycle: you thrust, or you image, or you serve traffic — not all three at full rate.`,
    ]);
  if (!parts.some((p) => p.id === "ttc-sband" || p.id === "ttc-uhf"))
    out.push([
      "error",
      "No command link",
      "Without a command transponder nothing on the ground can talk to this spacecraft, or recover it when something goes wrong.",
    ]);
  if (bus && bus.capacity && a.mass > bus.capacity)
    out.push([
      "error",
      "Over structural capacity",
      `${Math.round(a.mass)} kg on a bus rated for about ${bus.capacity} kg.`,
    ]);
  if (!has("ATTITUDE"))
    out.push([
      "error",
      "No attitude control",
      "It will tumble. Antennas and arrays both need to know which way is down.",
    ]);
  if (!parts.some((p) => p.id.startsWith("batt")))
    out.push([
      "warn",
      "No battery",
      "In low orbit the sun sets every 45 minutes. This satellite goes dark on the night side.",
    ]);
  const opt = parts.find((p) => p.needsPointing);
  if (opt && opt.needsPointing && a.pointing < opt.needsPointing)
    out.push([
      "warn",
      "Optical links under-pointed",
      "Laser terminals need star-tracker attitude knowledge and fine-pointing gimbals to acquire a moving target.",
    ]);
  if (!has("PROPULSION"))
    out.push([
      "warn",
      "No propulsion",
      "No stationkeeping, no collision avoidance and no controlled disposal. Fine for a cubesat, not for a constellation.",
    ]);
  if (!has("USER LINK") && !has("PAYLOAD"))
    out.push([
      "warn",
      "No payload",
      "This is a well-engineered bus with nothing to do. Add a user link or a sensor.",
    ]);
  if (!has("THERMAL") && a.load > 1500)
    out.push([
      "warn",
      "No heat rejection",
      `${Math.round(a.load)} W of electronics with nowhere to dump the waste heat.`,
    ]);
  if (a.isl > 0 && a.down === 0)
    out.push([
      "warn",
      "Mesh with no customers",
      "Laser links move traffic between satellites, but nothing here talks to the ground.",
    ]);
  return out;
}

/* -------------------------------------------------------------------- RF --
   Band table, EIRP densities and spacecraft antenna gains are taken from the
   NIS-Starlink-Video link budget visualiser (MIT, noiseinspacechannel), which
   derives them from SpaceX's own FCC filings. The array-factor and modulation
   maths below follow the same repository's phased-array simulators.
-------------------------------------------------------------------------- */

export const CLIGHT = 299792458;
export const KB_DBW = -228.6; // 10 log10(Boltzmann)

export const BANDS: Record<string, any> = {
  Ku: {
    label: "Ku user link",
    f: 11.7,
    bwMHz: 240,
    densityDbw: -11.6,
    refHz: 4000,
    gMin: 34.0,
    gMax: 48.0,
    ci: 13,
    rain: 0.9,
    gas: 0.15,
    note: "Eight 240 MHz channels spanning 10.7–12.7 GHz, spaced 250 MHz apart with a 10 MHz guard. The lowest two sit unused to protect radio astronomy at 10.6–10.7 GHz — a piece of spectrum etiquette visible in the live signal.",
  },
  Ka: {
    label: "Ka gateway link",
    f: 19.7,
    bwMHz: 3900,
    densityDbw: 18.7,
    refHz: 1e6,
    gMin: 34.5,
    gMax: 48.0,
    ci: 24,
    rain: 3.5,
    gas: 0.4,
    note: "Feeder link to a gateway dish on the ground. Sixteen times the bandwidth of the user link, because all the traffic of a whole beam pattern has to fit through it.",
  },
  E: {
    label: "E-band backhaul",
    f: 73.5,
    bwMHz: 5000,
    densityDbw: 27.3,
    refHz: 1e6,
    gMin: 47.1,
    gMax: 60.6,
    ci: 26,
    rain: 22,
    gas: 1.6,
    note: "Five gigahertz of feeder spectrum, authorised for Gen2 in 2024. The physics bill comes due as rain: a downpour that costs Ku a decibel can close an E-band link entirely.",
  },
  DTC: {
    label: "Direct to Cell",
    f: 2.0,
    bwMHz: 5,
    densityDbw: -11.3,
    refHz: 1,
    gMin: 30.0,
    gMax: 50.0,
    ci: 9,
    rain: 0.02,
    gas: 0.03,
    note: "An LTE eNodeB in orbit on T-Mobile's PCS 1900 MHz (Band 25), working to 3GPP Release 17's supplemental-coverage-from-space rules. Independent measurement puts it near 4 Mbps per beam outdoors — texts and light data, not video.",
  },
};

/* The Ku downlink is proprietary OFDM, not DVB-S2X. Every parameter below is
   from Humphreys, Iannucci, Komodromos & Graff, "Signal Structure of the
   Starlink Ku-Band Downlink", IEEE Trans. Aerospace & Electronic Systems 2023
   (arXiv:2210.11578) — the UT Austin Radionavigation Lab teardown of the live
   signal. Only 4QAM and 16QAM have ever been observed on air. */
export const OFDM = {
  fsMHz: 240,
  N: 1024,
  Ng: 32,
  frameHz: 750,
  symbolsPerFrame: 302,
  dataSymbols: 298,
  subcarrierHz: 234375,
  symbolUs: 4.4,
  cpNs: 130,
  channels: 8,
  channelSpacingMHz: 250,
  guardMHz: 10,
  occupancy: 24 / 25,
};

/* observed constellations only; code rates are inferred, not published */
export const STARLINK_MCS = [
  { mod: "4QAM", rate: "1/2", bits: 2, cr: 0.5, req: 2.0 },
  { mod: "4QAM", rate: "3/4", bits: 2, cr: 0.75, req: 5.0 },
  { mod: "16QAM", rate: "1/2", bits: 4, cr: 0.5, req: 8.5 },
  { mod: "16QAM", rate: "3/4", bits: 4, cr: 0.75, req: 11.5 },
];

export function ofdmRateMbps(m: { bits: number; cr: number }) {
  const active = OFDM.N * OFDM.occupancy;
  return (OFDM.dataSymbols * OFDM.frameHz * active * m.bits * m.cr) / 1e6;
}

export const MODCODS = [
  { mod: "QPSK", rate: "1/2", eff: 0.99, req: 1.0 },
  { mod: "QPSK", rate: "3/4", eff: 1.49, req: 4.03 },
  { mod: "QPSK", rate: "5/6", eff: 1.65, req: 4.68 },
  { mod: "8PSK", rate: "3/4", eff: 2.23, req: 7.91 },
  { mod: "8PSK", rate: "5/6", eff: 2.48, req: 9.35 },
  { mod: "16APSK", rate: "3/4", eff: 2.97, req: 10.21 },
  { mod: "16APSK", rate: "5/6", eff: 3.3, req: 11.61 },
  { mod: "32APSK", rate: "3/4", eff: 3.7, req: 12.73 },
  { mod: "32APSK", rate: "5/6", eff: 4.12, req: 14.33 },
  { mod: "64APSK", rate: "5/6", eff: 4.94, req: 17.2 },
  { mod: "128APSK", rate: "3/4", eff: 5.16, req: 19.3 },
  { mod: "256APSK", rate: "3/4", eff: 5.88, req: 23.5 },
];

export const db10 = (x: number) => 10 * Math.log10(Math.max(x, 1e-300));
export const db20 = (x: number) => 20 * Math.log10(Math.max(x, 1e-300));
export const DEG = Math.PI / 180;
export const RE = 6371e3;

/* rectangular aperture gain, from the repo's rectApertureGainDbi */
export function apertureGain(fGHz: number, w: number, h: number, eff = 0.55) {
  const lambda = CLIGHT / (fGHz * 1e9);
  return db10((eff * 4 * Math.PI * w * h) / (lambda * lambda));
}

/* array factor of a uniformly-fed line of N elements at spacing d, steered to
   thetaS. N = 0 means a continuous aperture of width d (a dish). */
export function patternDb(theta: number, thetaS: number, N: number, d: number, lambda: number) {
  const k = (2 * Math.PI) / lambda;
  const u = Math.sin(theta) - Math.sin(thetaS);
  if (N <= 1) return 0;
  const psi = k * d * u;
  const den = Math.sin(psi / 2);
  const af =
    Math.abs(den) < 1e-9
      ? 1
      : Math.abs(Math.sin((N * psi) / 2) / (N * den));
  // element pattern: a patch radiates like cos(theta), so scan loss is free
  const el = Math.max(Math.cos(theta), 1e-4);
  return db20(af) + db10(el);
}

/* geometry from the satellite down to the ground at a given scan angle */
export function lookGeometry(altKm: number, scanRad: number) {
  const h = altKm * 1e3;
  const rOrb = RE + h;
  const rho = Math.asin(RE / rOrb); // horizon nadir angle
  const eta = Math.min(scanRad, rho * 0.995);
  const sinE = Math.min(1, (Math.sin(eta) * rOrb) / RE);
  const elev = Math.acos(sinE); // elevation seen from the ground
  const gamma = Math.max(0, Math.PI / 2 - eta - elev);
  const slant = Math.sqrt(
    RE * RE + rOrb * rOrb - 2 * RE * rOrb * Math.cos(gamma)
  );
  return {
    slant,
    elevDeg: (elev * 180) / Math.PI,
    groundKm: (gamma * RE) / 1000,
    horizonDeg: (rho * 180) / Math.PI,
    incidence: Math.PI / 2 - elev,
  };
}

export function linkBudget(part: Part, opts: { scanDeg: number; spacing: number; altKm: number; rainPct: number }): any {
  const b = (BANDS as any)[part.rf!.band];
  const { scanDeg, spacing, altKm, rainPct } = opts;
  const lambda = CLIGHT / (b.f * 1e9);
  const lambdaTop = CLIGHT / 12.7e9; // arrays are spaced off the top of the band
  const d = spacing * lambdaTop;
  const isAperture = !!part.rf!.aperture;
  const N = isAperture ? 0 : Math.max(2, Math.round(part.rf!.w / d));
  const Nh = isAperture ? 0 : Math.max(2, Math.round(part.rf!.h / d));
  const scan = scanDeg * DEG;

  const g0 = apertureGain(b.f, part.rf!.w, part.rf!.h);
  const scanLoss = -db10(Math.max(Math.cos(scan), 1e-4));
  const gTx = g0 - scanLoss;

  // regulatory EIRP cap gives the transmit power, following the repo's method
  const eirpCap = b.densityDbw + db10((b.bwMHz * 1e6) / b.refHz);
  const txPowerDbw = eirpCap - (b.gMin + b.gMax) / 2;
  const eirp = txPowerDbw + gTx;

  const geo = lookGeometry(altKm, scan);
  const fspl = db20((4 * Math.PI * geo.slant) / lambda);
  const elevFactor = 1 / Math.max(Math.sin(geo.elevDeg * DEG), 0.08);
  const gas = b.gas * elevFactor;
  const rain = b.rain * (rainPct / 100) * elevFactor;
  const path = fspl + gas + rain;

  // ground receiver
  const isDtc = part.rf!.band === "DTC";
  const gRx = isDtc ? 0 : apertureGain(b.f, 0.594, 0.383, 0.5);
  const nfDb = isDtc ? 5 : 1.5;
  const tAnt = 150 + rainPct * 1.4;
  const tSys = tAnt + 290 * (Math.pow(10, nfDb / 10) - 1);

  const pr = eirp + gRx - path;
  const cn0 = pr - (KB_DBW + db10(tSys));
  const bwHz = b.bwMHz * 1e6;
  const esnoThermal = cn0 - db10(bwHz);
  // frequency reuse means neighbouring beams are the real noise floor
  const esno = -db10(
    Math.pow(10, -esnoThermal / 10) + Math.pow(10, -b.ci / 10)
  );
  const margin = 2.0;
  const usable = esno - margin;

  // Ku user traffic rides Starlink's own OFDM; gateway links are modelled with
  // DVB-S2X as a stand-in because their waveform has never been published.
  const wave = part.rf!.band === "Ku" ? "ofdm" : part.rf!.band === "DTC" ? "lte" : "dvbs2x";
  let best: any = null,
    mbps = 0;
  if (wave === "ofdm") {
    for (const m of STARLINK_MCS) if (usable >= m.req) best = m;
    mbps = best ? ofdmRateMbps(best) : 0;
  } else if (wave === "lte") {
    // measured, not modelled: Mendo et al., arXiv:2506.00283, ~4 Mbps per beam
    best = usable >= 2 ? { mod: "LTE", rate: "Band 25", measured: true } : null;
    mbps = best ? 4 : 0;
  } else {
    for (const m of MODCODS) if (usable >= m.req) best = m;
    mbps = best ? best.eff * b.bwMHz : 0;
  }

  // 3 dB beamwidth and the spot it makes on the ground
  const apW = isAperture ? part.rf!.w : N * d;
  const theta3 = (0.886 * lambda) / (apW * Math.max(Math.cos(scan), 0.05));
  const spotKm =
    (geo.slant * theta3) / Math.max(Math.cos(geo.incidence), 0.1) / 1000;

  // grating lobes appear once spacing exceeds lambda / (1 + |sin scan|)
  const grating = !isAperture && d / lambda > 1 / (1 + Math.abs(Math.sin(scan)));

  return {
    band: b,
    lambda,
    d,
    N,
    Nh,
    elements: isAperture ? 0 : N * Nh,
    g0,
    gTx,
    scanLoss,
    eirpCap,
    txPowerDbw,
    txPowerW: Math.pow(10, txPowerDbw / 10),
    eirp,
    geo,
    fspl,
    gas,
    rain,
    path,
    gRx,
    pr,
    tSys,
    cn0,
    esnoThermal,
    esno,
    usable,
    best,
    mbps,
    wave,
    theta3Deg: (theta3 * 180) / Math.PI,
    spotKm,
    grating,
    isAperture,
  };
}

