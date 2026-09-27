/**
 * The explorer's story, chapter by chapter. Copy only — the staging lives in
 * RomanExplorer.svelte, which reads `id` to decide what the 3D scene does.
 *
 * Every claim here is from NASA or the Roman technical pages; sources are in
 * scripts/roman/roman_dims.py and the research notes it cites. Mission status
 * is as of late September 2026.
 */
import type { Tag } from './dims';

/** A number shown in a chapter, carrying where it came from like every other. */
export interface Figure { value: string; sup?: string; label: string; tag: Tag; celsius?: number; dir?: string }

/**
 * Each chapter's numbers take the form their point needs: one figure when a
 * single number is the claim, a temperature scale when the claim is how cold
 * each tier runs, an in/out ledger when it is what flows through.
 */
export type Figures =
  | { form: 'hero'; items: Figure[] }
  | { form: 'ladder'; items: Figure[] }
  | { form: 'ledger'; items: Figure[] };

export interface Source { label: string; href: string }

export interface Chapter {
  id: 'sky' | 'focal' | 'light' | 'coronagraph' | 'deploy' | 'thermal' | 'power' | 'explore';
  nav: string;
  title: string;
  body: string[];
  figures?: Figures;
  next?: string;
  sources?: Source[];
}

const src = (href: string, label = href.replace(/^https:\/\//, '')): Source => ({ label, href });

export const CHAPTERS: Chapter[] = [
  {
    id: 'sky', nav: 'What it sees',
    title: 'One exposure, two hundred Hubbles',
    body: [
      'Roman’s Wide Field Instrument takes in 0.28 square degrees of sky at a time. The eighteen outlines are its detectors, drawn to scale over a star field toward the centre of the Milky Way; the small square beside them is Hubble’s infrared camera.',
    ],
    next: 'Pull back',
    sources: [src('https://roman.gsfc.nasa.gov/science/WFI_technical.html')],
  },
  {
    id: 'focal', nav: 'The detectors',
    title: 'Where the image lands',
    body: [
      'Each outline was a detector: a 4096 × 4096 H4RG-10 infrared array, sixteen million pixels, held near −178 °C. Eighteen of them make the focal plane.',
      'They sit in an arch because the telescope’s image is sharpest in a ring around its centre. Above them, an eleven-slot wheel turns filters, a grism or a prism into the beam.',
    ],
    next: 'Follow the light back out',
    sources: [src('https://roman.gsfc.nasa.gov/interactive/parts/wfi')],
  },
  {
    id: 'light', nav: 'The light path',
    title: 'Five reflections to the detectors',
    body: [
      'Roman is a three-mirror anastigmat: the 2.4 m primary sends starlight up to the secondary, which drops it back through the primary’s centre into the aft optics, where two flats fold it and the concave tertiary forms the image. Here it is traced back out, from the detectors to the sky.',
    ],
    next: 'The coronagraph',
    sources: [src('https://ntrs.nasa.gov/citations/20250006671')],
  },
  {
    id: 'coronagraph', nav: 'Coronagraph',
    title: 'Switching off a star',
    body: [
      'A pick-off mirror takes part of the beam for the Coronagraph Instrument. Three curved mirrors collimate it and a tip/tilt flat steers it in.',
      'Inside, two deformable mirrors, each with more than 1,600 actuators, reshape the light to carve a dark hole in a star’s glare, deep enough to reveal planets ten million times fainter than it.',
    ],
    figures: { form: 'hero', items: [{ value: '10', sup: '−7', label: 'planet-to-star contrast the coronagraph must reach', tag: 'PUB' }] },
    next: 'How it unfolded',
    sources: [src('https://roman.gsfc.nasa.gov/interactive/parts/coronagraph')],
  },
  {
    id: 'deploy', nav: 'Unfolding',
    title: 'Folded for the ride, opened in space',
    body: [
      'Roman launched on a Falcon Heavy on 30 August 2026. It came off the rocket folded, and opened in four steps over two days.',
    ],
    next: 'Keeping cold',
    sources: [
      src('https://www.nasa.gov/news-release/nasas-dark-universe-seeking-nancy-grace-roman-space-telescope-launches/', 'NASA launch release, 30 Aug'),
      src('https://science.nasa.gov/blogs/roman/2026/09/01/nasa-roman-space-telescopes-antenna-visor-deployed/', 'Antenna and visor deployed, 1 Sep'),
    ],
  },
  {
    id: 'thermal', nav: 'Staying cold',
    title: 'Always one side to the Sun',
    body: [
      'Roman keeps its solar array between the Sun and the telescope. The array, the lower sun shade and the visor keep direct light off the optics, so the mirrors, the aft optics and the detectors can each run colder than the last.',
    ],
    figures: {
      form: 'ladder',
      items: [
        { value: '−7 °C', celsius: -7, label: 'Primary mirror', tag: 'PUB' },
        { value: '−55 °C', celsius: -55, label: 'Aft optics', tag: 'PUB' },
        { value: '−178 °C', celsius: -178, label: 'Detectors', tag: 'PUB' },
      ],
    },
    next: 'Power and data',
    sources: [src('https://roman.gsfc.nasa.gov/interactive/parts/telescope'), src('https://roman.gsfc.nasa.gov/interactive/parts/wfi')],
  },
  {
    id: 'power', nav: 'Power & data',
    title: 'Four kilowatts in, a terabyte a day out',
    body: [
      'From L2, Earth lies close to the Sun’s direction. The array powers the observatory, and the gimballed 1.7 m high-gain antenna sends the science home over Ka-band.',
    ],
    figures: {
      form: 'ledger',
      items: [
        { dir: 'In', value: '4 kW', label: 'six panels, 3,902 cells', tag: 'PUB' },
        { dir: 'Out', value: '500 Mb/s', label: 'Ka-band, about 1.4 TB a day', tag: 'PUB' },
      ],
    },
    next: 'Take it apart',
    sources: [src('https://roman.gsfc.nasa.gov/science/observatory_technical.html')],
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

/**
 * Captions for the light path's stops, in the order the explorer traces them:
 * from the detectors back out to the sky, each one the step before the last.
 */
export const STOP_NOTES: Record<string, string> = {
  fp: 'An f/7.9 image lands on the eighteen detectors.',
  wheel: 'Just before, it crossed one of the wheel’s eleven slots: a filter, the grism or the prism.',
  tm: 'The concave tertiary, the only curved mirror in the aft optics, formed that image.',
  fm2: 'Fold mirror 2 sent it there, notched so the beam leaving the tertiary can pass it.',
  if: 'Between the two folds the light came to a first focus.',
  fm1: 'Fold mirror 1, actuated in tip, tilt and focus, turned it toward that focus.',
  hole: 'It reached fold mirror 1 down a baffle through the primary’s centre.',
  sm: 'The 581 mm secondary sent it down that axis.',
  pm: 'The 2.4 m primary gathered it and sent it up to the secondary.',
  aperture: 'It came in at the aperture, shaded by the visor.',
};
