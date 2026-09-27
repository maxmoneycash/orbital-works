/**
 * The explorer's story, chapter by chapter. Copy only — the staging lives in
 * RomanExplorer.svelte, which reads `id` to decide what the 3D scene does.
 *
 * Every claim here is from NASA or the Roman technical pages; sources are in
 * scripts/roman/roman_dims.py and the research notes it cites. Mission status
 * is as of late September 2026.
 */

export interface Stat { value: string; label: string }
export interface Chapter {
  id: 'sky' | 'focal' | 'light' | 'coronagraph' | 'deploy' | 'thermal' | 'power' | 'explore';
  nav: string;
  title: string;
  body: string[];
  stats?: Stat[];
  next?: string;
  source?: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'sky', nav: 'What it sees',
    title: 'One exposure, two hundred Hubbles',
    body: [
      'Roman’s Wide Field Instrument takes in 0.28 square degrees of sky at a time. The eighteen outlines are its detectors, drawn to scale over a star field toward the centre of the Milky Way; the small square beside them is Hubble’s infrared camera.',
    ],
    stats: [
      { value: '≈200×', label: 'Hubble WFC3/IR field' },
      { value: '300 MP', label: '18 detectors' },
      { value: '0.11″', label: 'per pixel' },
    ],
    next: 'Pull back',
    source: 'roman.gsfc.nasa.gov/science/WFI_technical.html',
  },
  {
    id: 'focal', nav: 'The detectors',
    title: 'Where the image lands',
    body: [
      'Each outline was a detector: a 4096 × 4096 H4RG-10 infrared array, sixteen million pixels, held near −178 °C. Eighteen of them make the focal plane.',
      'They sit in an arch because the telescope’s image is sharpest in a ring around its centre. Above them, an eleven-slot wheel turns filters, a grism or a prism into the beam.',
    ],
    next: 'Follow the light back out',
    source: 'roman.gsfc.nasa.gov/interactive/parts/wfi',
  },
  {
    id: 'light', nav: 'The light path',
    title: 'Five reflections to the detectors',
    body: [
      'Roman is a three-mirror anastigmat. Starlight strikes the 2.4 m primary, rises to the secondary, and drops back through the primary’s centre into the aft optics, where two flats fold it and the concave tertiary forms the image.',
    ],
    next: 'The coronagraph',
    source: 'ntrs.nasa.gov/citations/20250006671',
  },
  {
    id: 'coronagraph', nav: 'Coronagraph',
    title: 'Switching off a star',
    body: [
      'A pick-off mirror takes part of the beam for the Coronagraph Instrument. Three curved mirrors collimate it and a tip/tilt flat steers it in.',
      'Inside, two deformable mirrors, each with more than 1,600 actuators, reshape the light to carve a dark hole in a star’s glare, deep enough to reveal planets ten million times fainter than it.',
    ],
    stats: [
      { value: '10⁻⁷', label: 'contrast required' },
      { value: '1,600+', label: 'actuators per deformable mirror' },
    ],
    next: 'How it unfolded',
    source: 'roman.gsfc.nasa.gov/interactive/parts/coronagraph',
  },
  {
    id: 'deploy', nav: 'Unfolding',
    title: 'Folded for the ride, opened in space',
    body: [
      'Roman launched on a Falcon Heavy on 30 August 2026. It came off the rocket folded, and opened in four steps over two days.',
    ],
    next: 'Keeping cold',
    source: 'science.nasa.gov/blogs/roman',
  },
  {
    id: 'thermal', nav: 'Staying cold',
    title: 'Always one side to the Sun',
    body: [
      'Roman keeps its solar array between the Sun and the telescope. The array, the lower sun shade and the visor keep direct light off the optics, so the primary holds near −7 °C, the aft optics near −55 °C, and the detectors near −178 °C.',
    ],
    stats: [
      { value: '−7 °C', label: 'primary mirror' },
      { value: '−55 °C', label: 'aft optics' },
      { value: '−178 °C', label: 'detectors' },
    ],
    next: 'Power and data',
    source: 'roman.gsfc.nasa.gov/interactive',
  },
  {
    id: 'power', nav: 'Power & data',
    title: 'Four kilowatts in, a terabyte a day out',
    body: [
      'Six panels of 3,902 cells make about 4 kW. From L2, Earth lies close to the Sun’s direction, and the 1.7 m high-gain antenna sends science home over Ka-band at up to 500 megabits a second — around 1.4 terabytes a day.',
    ],
    stats: [
      { value: '4 kW', label: 'solar array' },
      { value: '500 Mb/s', label: 'Ka-band downlink' },
      { value: '1.4 TB', label: 'per day' },
    ],
    next: 'Take it apart',
    source: 'roman.gsfc.nasa.gov/science/observatory_technical.html',
  },
  {
    id: 'explore', nav: 'Every part',
    title: 'Every part',
    body: [
      'Drag to turn it, scroll to come closer, pick any part. Every number carries where it came from: published, derived from published figures, or estimated.',
    ],
  },
];

/** The four deployments, as flown. */
export const DEPLOYMENTS = [
  { key: 'launch', when: '30 Aug 2026 · 07:26 EDT', what: 'Launch on Falcon Heavy from Kennedy’s pad 39A; free of the rocket 31 minutes later.' },
  { key: 'liss', when: 'Launch + 1 h 23 min', what: 'The lower sun shade and the solar array’s outer columns swing open.' },
  { key: 'hga', when: '31 Aug · 14:03 EDT', what: 'The high-gain antenna’s boom swings out, in about four minutes.' },
  { key: 'dac', when: '1 Sep · 06:05 EDT', what: 'Three booms spring the visor up over the aperture, in about eight minutes.' },
] as const;

export const LAUNCH = Date.UTC(2026, 7, 30, 11, 26); // 07:26 EDT

/** Captions for the light path's stops, in path order. */
export const STOP_NOTES: Record<string, string> = {
  aperture: 'Starlight enters the barrel, shaded by the visor.',
  pm: 'The 2.4 m primary gathers it and sends it up.',
  sm: 'The 581 mm secondary returns it down the axis.',
  hole: 'A baffle tube carries it through the primary’s centre.',
  fm1: 'Fold mirror 1 — actuated in tip, tilt and focus — turns it into the aft optics.',
  if: 'The light comes to a first focus.',
  fm2: 'Fold mirror 2, notched so the returning beam can pass it.',
  tm: 'The concave tertiary forms the final image.',
  wheel: 'One of the wheel’s eleven slots — a filter, the grism or the prism — sits in the beam.',
  fp: 'An f/7.9 image lands on the eighteen detectors.',
};
