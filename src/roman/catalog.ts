/**
 * What each part of the Roman model is.
 *
 * Subsystem keys are the tags roman_export_web.py stamps on every mesh
 * (`userData.subsystem`); part names are the Blender object names it stamps as
 * `userData.part`. Grouped by NASA's own five-part tour
 * (roman.gsfc.nasa.gov/interactive/), with the coronagraph and instrument
 * carrier beside the Wide Field Instrument.
 */
import { fact, stated, type Fact } from './dims';

export interface Subsystem {
  id: string;
  label: string;
  group: string;
  blurb: string;
  facts: Fact[];
  /** A source conflict the model settles one way without resolving it. */
  conflict?: string;
}

const S = (id: string, label: string, group: string, blurb: string, facts: Fact[], conflict?: string): Subsystem =>
  ({ id, label, group, blurb, facts, conflict });

export const SUBSYSTEMS: Subsystem[] = [
  S('TEL.PrimaryMirrorAssembly', 'Primary mirror', 'Telescope',
    'The 2.4 m mirror that gathers the light, inherited from another program and re-figured to Roman’s prescription. It sits on three bi-pods off the Aft Metering Structure, with a stray-light baffle rising through its centre.',
    [fact('Diameter', 'PM_DIA', 'm'), stated('Operating temperature', 'about −7 °C', 'PUB', 'roman.gsfc.nasa.gov/interactive'),
     fact('Areal density', 'PM_AREAL_DENSITY', 'kg/m²', 0),
     fact('Bi-pods', 'PM_BIPODS'), fact('Metering structure', 'AMS_THICK', 'm'),
     fact('Radius of curvature', 'PM_ROC', 'm')]),
  S('TEL.SecondaryMirrorAssembly', 'Secondary mirror', 'Telescope',
    'Hangs above the primary on a six-strut hexapod, positioned by six alignment drives and two focus drives, and sends the light back down through the primary’s centre. Its height is solved from the published strut length.',
    [stated('Diameter (NASA)', '581 mm', 'PUB', 'roman.gsfc.nasa.gov/interactive'), fact('Diameter as modelled', 'SM_DIA', 'm'),
     fact('Struts', 'SM_STRUTS'), fact('Strut length', 'SM_STRUT_LEN', 'm'), fact('Solved rise', 'SM_RISE', 'm')]),
  S('TEL.AftOpticsModule', 'Aft optics', 'Telescope',
    'Three optics under the metering structure that relay the beam to the Wide Field Instrument: fold mirror 1, which has three actuators for tip, tilt and focus; fold mirror 2, notched so the returning beam can pass; and the concave tertiary, the third powered mirror. They run at about −55 °C.',
    [fact('FM1 beam footprint', 'AOM_FM1_BEAM', 'mm', 0, 1000), fact('FM2 beam footprint', 'AOM_FM2_BEAM', 'mm', 0, 1000),
     fact('Tertiary footprint', 'AOM_TM_BEAM', 'mm', 0, 1000), fact('FM1 actuators', 'AOM_FM1_ACTUATORS'),
     fact('Bi-pods', 'AOM_BIPODS')]),
  S('TEL.TertiaryCollimatorAssembly', 'Tertiary collimator', 'Telescope',
    'The coronagraph’s share of the light. An oval pick-off flat folds part of the beam under the metering structure into three curved mirrors that collimate it, and a tip/tilt flat steers it into the instrument. Mostly at room temperature.',
    [fact('Powered mirrors', 'TOMA_POWERED_MIRRORS'), fact('Bi-pod pairs', 'TOMA_BIPOD_PAIRS'),
     fact('Pick-off flat', 'POMA_MIRROR', 'm')]),
  S('TEL.TelescopeControlElectronics', 'Telescope electronics', 'Telescope',
    'The “brain of the telescope”: runs hundreds of heaters and sensors and drives the secondary and aft-optics actuators. A Telescope part in NASA’s tour, though it is mounted on the spacecraft.',
    [fact('Circuit boards', 'TCE_BOARDS'), fact('Heater zones per side', 'TCE_HEATER_ZONES')]),
  S('TEL.DeployableApertureCover', 'Aperture cover', 'Telescope',
    'A two-layer soft visor on three booms, silver outside and glossy black inside, that keeps sunlight and stray light out of the barrel. It sprang up over about eight minutes on 1 September 2026 and stays up for the mission.',
    [fact('Soft membrane on booms', 'DAC_MEMBRANE'), fact('Deployed height', 'DAC_H_DEPLOYED', 'm'),
     fact('Base width', 'DAC_DIA_BASE', 'm'), fact('Stowed height', 'DAC_H_STOWED', 'm'),
     fact('Support booms', 'DAC_BOOMS')]),
  S('TEL.OuterBarrelAssembly', 'Outer barrel', 'Telescope',
    'The exoskeleton around the optics, built like a house on stilts: an open “elephant stand” carrying the barrel, silver-grey outside and matte black inside, that blocks stray light, keeps the mirrors cool, and carries the sun shield and visor.',
    [fact('Height', 'OBA_H', 'm'), fact('Outer diameter', 'OBA_DIA', 'm'),
     fact('Stand height', 'STAND_H', 'm'), fact('Wall', 'OBA_WALL', 'm'), fact('Vane width', 'OBA_VANE_W', 'm')]),
  S('TEL.ForwardStructureAssembly', 'Forward structure', 'Telescope',
    'The composite hoop around the primary, carrying its perimeter heaters and the six alignment drives that push the secondary’s struts.',
    [fact('Alignment drives', 'FMS_ALIGN_DRIVES'), fact('Hoop diameter', 'FMS_DIA', 'm')]),
  S('TEL.Interfaces', 'Optical assembly struts', 'Telescope',
    'Six struts with bearings at each end, tying the telescope to the instrument carrier.',
    [fact('Struts', 'FOA_STRUTS')]),

  S('OSS.PrimaryStructure', 'Spacecraft bus', 'Observatory support',
    'The six-sided bus: six avionics bays around a central cylinder, a top deck that carries the observatory and a bottom deck that met the rocket. Inside it, not yet modelled: six reaction wheels, hydrazine propulsion, power, and a 4 TB science data recorder.',
    [fact('Across corners', 'BUS_ACROSS_CORNERS', 'm'), fact('Height', 'BUS_H', 'm'),
     stated('Reaction wheels', '6', 'PUB', 'roman.gsfc.nasa.gov/interactive'), stated('Data recorder', '4 TB', 'PUB', 'roman.gsfc.nasa.gov/interactive')]),
  S('OSS.LowerInstrumentSunShade', 'Lower sun shade', 'Observatory support',
    'Two honeycomb panels in silver-grey blankets that swing out from the bus to shade the instruments. They were the first thing Roman deployed, 1 h 23 min after launch.',
    [fact('Panels', 'LISS_PANELS'), fact('Panel width', 'LISS_PANEL_W', 'm'), fact('Panel height', 'LISS_PANEL_H', 'm'),
     fact('Thickness', 'LISS_PANEL_T', 'mm', 0, 1000), fact('Deploy angle', 'LISS_OPEN_DEG', '°', 0)]),
  S('OSS.LaunchVehicleAdapter', 'Launch adapter', 'Observatory support',
    'The separation ring to the Falcon Heavy upper stage.',
    [fact('Height', 'LVA_H', 'm')]),

  S('SOLAR_ARRAY_SUN_SHIELD', 'Solar array sun shield', 'Solar array sun shield',
    'Six panels, three columns by two rows, of near-black cells on a red-orange backing — about 4 kW from 3,902 cells. The centre column is fixed to the barrel; the outer columns folded back for launch and swung out 1 h 23 min after it. It always faces the Sun.',
    [fact('Panels', 'SASS_PANELS'), stated('Layout', '3 columns × 2 rows', 'PUB', 'NASA integration photos, 2025'),
     fact('Fold for launch', 'SASS_FOLD_DEG', '°', 0),
     stated('Power', '4 kW', 'PUB', 'NASA Roman press kit, Aug 2026'), fact('Centre column', 'SASS_COL_W', 'm'),
     fact('Outer column', 'SASS_OUTER_W', 'm'), fact('Array height', 'SASS_H', 'm')],
    'NASA gives each panel as about 2.1 × 3 m, so three columns span about 6.2 m, wider than the 4.4 m NASA quotes for the observatory. The model reads 4.4 m as the body and lets only the wings reach past it, as NASA’s flight renders show.'),

  S('COMMUNICATIONS', 'Communications', 'Communications',
    'A 1.7 m carbon-composite dish on a gimbal: S-band for commands and telemetry, Ka-band for science, up to 500 Mbit/s — about 1.4 TB a day. Its boom swung out on 31 August 2026. The boom rises from the aft, sun-side edge of the bus, as NASA’s flight-configuration renders show.',
    [fact('Dish diameter', 'HGA_DISH_DIA', 'm'), stated('Bands', 'S 2 GHz · Ka 26 GHz', 'PUB', 'roman.gsfc.nasa.gov/interactive'),
     stated('Science downlink', 'up to 500 Mbit/s', 'PUB', 'roman.gsfc.nasa.gov/science/observatory_technical.html'),
     fact('Gimballed', 'HGA_GIMBALLED'), fact('Boom length', 'HGA_BOOM_LEN', 'm')]),

  S('WIDE_FIELD_INSTRUMENT', 'Wide Field Instrument', 'Instruments',
    'Roman’s main camera: eighteen 4096 × 4096 infrared detectors in an arch, 300 megapixels, at about −178 °C. An eleven-slot wheel just ahead of them turns filters, a grism or a prism into the beam.',
    [fact('H4RG-10 detectors', 'WFI_DETECTORS'), stated('Pixel scale', '0.11″', 'PUB', 'roman.gsfc.nasa.gov/science/WFI_technical.html'),
     stated('Field of view', '0.281 deg²', 'PUB', 'roman.gsfc.nasa.gov/science/WFI_technical.html'),
     stated('Wavelengths', '0.48–2.3 µm', 'PUB', 'roman.gsfc.nasa.gov/science/WFI_technical.html'),
     fact('Element wheel slots', 'WFI_ELEMENTS')]),
  S('CORONAGRAPH_INSTRUMENT', 'Coronagraph', 'Instruments',
    'A technology demonstration for photographing planets beside their stars: two deformable mirrors reshape the light thousands of times a second to dig a dark hole in the star’s glare, and a photon-counting detector records what is left. It powered on 1 September 2026.',
    [stated('Deformable mirrors', '2, each 1,600+ actuators', 'PUB', 'roman.gsfc.nasa.gov/interactive'),
     stated('Contrast requirement', 'one in ten million', 'PUB', 'arxiv.org/abs/2309.08672'),
     stated('Detector', 'EMCCD, photon counting', 'PUB', 'roman.gsfc.nasa.gov/interactive')]),
  S('INSTRUMENT_CARRIER', 'Instrument carrier', 'Instruments',
    'Meters the telescope to both science instruments and holds their alignment.',
    [fact('Deck diameter', 'IC_DIA', 'm')]),
];

export const SUBSYSTEM = Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, s])) as Record<string, Subsystem>;

export const GROUPS: [group: string, ids: string[]][] = (() => {
  const m = new Map<string, string[]>();
  for (const s of SUBSYSTEMS) {
    if (!m.has(s.group)) m.set(s.group, []);
    m.get(s.group)!.push(s.id);
  }
  return [...m];
})();

/* ------------------------------------------------------------ parts -- */

/**
 * Human names for the model's parts, matched on the Blender name's prefix.
 * Longest prefix wins; a trailing index becomes "n of N" in the UI.
 */
const PART_NAMES: [prefix: string, label: string][] = [
  ['PM.Surface', 'Primary mirror surface'], ['PM.Substrate', 'Primary mirror substrate'],
  ['PM.StrayLightBaffle', 'Central stray-light baffle'], ['PM.Bipod', 'Primary mirror bi-pod leg'],
  ['AMS.Structure', 'Aft metering structure'], ['AMS.Rib', 'Metering structure rib'],
  ['SMA.Mirror', 'Secondary mirror'], ['SMA.Housing', 'Secondary mirror housing'],
  ['SMA.Strut', 'Hexapod strut'], ['SMA.Scraper', 'Stray-light scraper'], ['SMA.FocusDrive', 'Fine-focus drive'],
  ['FMS.Hoop', 'Forward metering hoop'], ['FMS.AlignmentDrive', 'Alignment drive'],
  ['FMS.PerimeterHeaters', 'Perimeter heater ring'],
  ['AOM.Structure', 'Aft optics bench'], ['AOM.Bipod', 'Aft optics bi-pod leg'],
  ['AOM.FM1_Actuator', 'Fold mirror 1 actuator'], ['AOM.FM1', 'Fold mirror 1'], ['AOM.FM2', 'Fold mirror 2'],
  ['AOM.Tertiary', 'Tertiary mirror'],
  ['POMA.FoldFlat', 'Pick-off mirror'], ['TOMA.Structure', 'Collimator module'], ['TOMA.Bipod', 'Collimator bi-pod leg'],
  ['TOMA.M3', 'Collimator mirror M3'], ['TOMA.M4', 'Collimator mirror M4'], ['TOMA.M5', 'Collimator mirror M5'],
  ['TOMA.TipTiltFlat', 'Tip/tilt flat'],
  ['FOA.Strut', 'Optical assembly strut'], ['FOA.Bearing', 'Strut bearing'],
  ['TCE.Chassis', 'Telescope control electronics'],
  ['OBA.Barrel', 'Outer barrel'], ['OBA.Baffle', 'Baffle vane'], ['OBA.StandLeg', '“Elephant stand” leg'],
  ['DAC.Membrane', 'Aperture cover membrane'], ['DAC.SupportBoom', 'Aperture cover boom'],
  ['BUS.Hex', 'Spacecraft bus'], ['BUS.Radiator', 'Bus radiator'],
  ['LISS.Panel', 'Lower sun shade panel'], ['LISS.Hinge', 'Sun shade hinge'],
  ['LVA.Adapter', 'Launch vehicle adapter'],
  ['SASS.Centre', 'Fixed solar panel'], ['SASS.Outer', 'Hinged solar panel'], ['SASS.Hinge', 'Solar panel hinge'],
  ['HGA.Dish', 'High-gain antenna dish'], ['HGA.Boom', 'Antenna boom'], ['HGA.FeedStrut', 'Antenna feed strut'],
  ['HGA.Feed', 'Antenna feed'], ['SASS.Standoff', 'Sun shield standoff'],
  ['WFI.ElementWheel', 'Element wheel'], ['WFI.Element', 'Filter / grism / prism slot'],
  ['HGA.GimbalAzimuth', 'Antenna azimuth gimbal'], ['HGA.GimbalElevation', 'Antenna elevation gimbal'],
  ['LGA', 'Low-gain antenna'],
  ['WFI.Body', 'Wide Field Instrument'], ['WFI.H4RG', 'H4RG-10 detector'],
  ['CGI.Body', 'Coronagraph Instrument'], ['IC.Deck', 'Instrument carrier deck'],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

export function partLabel(part: string): string {
  for (const [p, label] of PART_NAMES) {
    if (part === p || part.startsWith(p + '.') || part.startsWith(p)) {
      const n = part.slice(p.length).match(/(\d+)/);
      return n ? `${label} ${n[1]}` : label;
    }
  }
  return part;
}
