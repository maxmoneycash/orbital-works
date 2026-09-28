"""
roman_dims.py  --  v2
Single source of truth for Roman Space Telescope dimensions.

Pure Python. No bpy. Import from Blender, or run standalone to print a
provenance report:

    python3 roman_dims.py

PROVENANCE TAGS
---------------
    PUB   published by NASA / L3Harris / peer-reviewed. Trust it.
    DER   solved from PUB values by geometry or arithmetic. Trust it as
          far as you trust the PUB inputs and the stated assumption.
    MEAS  measured off NASA's .glb after normalising to the published
          12.70 m length. Better than an eyeball, worse than CAD.
          Populated by roman_measure.py -> roman_dims_measured.json.
    EST   still eyeballed. This is the remaining accuracy debt.
          Every EST here is a TODO, not a result.

SOURCES
-------
[S1] NASA Roman FAQ / Quick Facts -- 12.7 m long, 4.4 m wide deployed,
     2.4 m primary.
[S2] NASA, "Roman Space Telescope's 'Exoskeleton' Whirls Through Major
     Test" -- Outer Barrel Assembly ~5 m tall, ~4 m wide, built "like a
     house on stilts"; lower section is the "elephant stand".
[S3] Whitman et al., "Roman Optical Telescope Assembly (OTA) Build and
     Integration Progress", Proc. SPIE 12180-60 (2022).
     NTRS 20220010733 (ITAR-cleared public release).
[S4] NTRS 20240008727 -- Observatory build/test/verification status;
     Observatory = Spacecraft + Integrated Payload Assembly decomposition.
[S5] roman.ipac.caltech.edu -- TMA design, 2.4 m PM, WFI 300 MP / 18 H4RG.
[S6] roman.gsfc.nasa.gov/interactive/ -- NASA's own component-by-component
     tour. THE canonical public taxonomy. Consulted late; it corrected ten
     things, four of them structural. See NASA_TAXONOMY below.
[S7] NASA, "Roman Space Telescope Team Installs Observatory's Solar Panels"
     (Jun 2025) + science.nasa.gov/mission/roman-space-telescope/sass/
[S8] space.com / NASA, Lower Instrument Sun Shade installation (Aug 2025).
[S9] NASA integration photos, e.g. nasa.gov/wp-content/uploads/2025/12/complete.jpg
     -- SASS 3 x 2 panel layout; silver-grey barrel MLI, black interior.
[S10] NASA Roman launch press kit (Aug 2026) -- 1.7 m HGA, 4 kW, 8,000 kg;
     HGA boom deployed Aug 31 2026, aperture cover Sep 1 2026.
[S11] nasa.gov "High-Gain Antenna ... clears environmental tests" (2023).
[S12] roman.gsfc.nasa.gov/interactive/subparts/wfi-element-wheel/ and
     roman-docs.stsci.edu WFI optical elements -- 11-position element wheel.
[S13] NASA interactive tour renders, version V006 -- flight configuration,
     four views (roman.gsfc.nasa.gov/interactive/views/
     ROMAN_interactive_V006_{F,B,L,R}_Roman_off_00000_lg.png) plus the
     part-select overlays (.../part-select/ROMAN_interactive_V006_{view}_
     Roman_{tele,SP,support,comms,CGI,WFI}_00000.png). Pre-rendered
     perspective views, not CAD: good for shape, layout and proportion,
     not for metres. Every EST that cites it was read off those pixels.
[S14] NASA, "Telescope Milestone: Teams Check Out NASA Roman Solar Panels"
     (science.nasa.gov/blogs/roman, 16 Jul 2026) -- "each of the six panels
     is about 7 by 10 feet (2.1 by 3 meters)".

KNOWN NON-PUBLIC
----------------
Engineering CAD is not released. Primary mirror radius of curvature and
conic constant are NOT published in the cleared literature; PM_ROC /
PM_CONIC below are inferred and flagged EST_INF. They control the visual
sag of the dish and nothing else here -- do not use this file for optical
work.
"""

import json
import math
import os

# ---------------------------------------------------------------------------
# provenance-carrying scalar
# ---------------------------------------------------------------------------


class Dim(float):
    """A float that remembers where it came from."""

    def __new__(cls, value, tag, note=""):
        o = super().__new__(cls, value)
        o.tag = tag
        o.note = note
        return o

    def __repr__(self):
        return f"{float(self):.4f}<{self.tag}>"


class DimTuple(tuple):
    """Same, for sizes and offsets."""

    def __new__(cls, value, tag, note=""):
        o = super().__new__(cls, value)
        o.tag = tag
        o.note = note
        return o

    def __repr__(self):
        return f"{tuple(float(x) for x in self)}<{self.tag}>"


class DimFlag(int):
    """Same, for booleans and counts that carry a citation."""

    def __new__(cls, value, tag, note=""):
        o = super().__new__(cls, int(value))
        o.tag = tag
        o.note = note
        return o

    def __repr__(self):
        return f"{int(self)}<{self.tag}>"


def _mk(tag):
    def f(v, note=""):
        if isinstance(v, (tuple, list)):
            return DimTuple(v, tag, note)
        if isinstance(v, bool):
            return DimFlag(v, tag, note)
        return Dim(v, tag, note)
    return f


PUB, DER, MEAS, EST, EST_INF = (_mk(t) for t in
                                ("PUB", "DER", "MEAS", "EST", "EST_INF"))



# ===========================================================================
# NASA'S OWN TAXONOMY  [S6]
#
# The public interactive tour decomposes the observatory into FIVE parts.
# This project originally used Observatory = Spacecraft + Integrated
# Payload Assembly, taken from a build/verification paper [S4]. That
# decomposition is real but is not the canonical public one, and using it
# put the Outer Barrel Assembly and Deployable Aperture Cover under the
# spacecraft when NASA files both under the Telescope.
# ===========================================================================

NASA_TAXONOMY = {
    "Wide Field Instrument": [],
    "Communications": [
        "High-Gain Antenna (HGA)",
        "RF Communications Electronics",
    ],
    "Solar Array Sun Shield": [
        "SASS Solar Panels",
    ],
    "Observatory Support Systems": [
        "Primary Structure",
        "Lower Instrument Sun Shade (LISS)",
        "Attitude Control System (ACS)",
        "Propulsion",
        "Power",
        "Command and Data Handling (C&DH)",
    ],
    "Telescope": [
        "Primary Mirror Assembly (PMA)",
        "Secondary Mirror Assembly (SMA)",
        "Aft-Optics Module (AOM)",
        "Tertiary Collimator Assembly (TCA)",
        "Telescope Control Electronics (TCE)",
        "Deployable Aperture Cover (DAC)",
        "Outer Barrel Assembly (OBA)",
    ],
}

# Every correction the interactive tour forced. Kept in the file so the
# next pass can see what was wrong and why, rather than rediscovering it.
CORRECTIONS = [
    ("hierarchy", "OBA and DAC were under Spacecraft; NASA files both "
                  "under Telescope", "[S6]"),
    ("hierarchy", "TCE was modelled inside the bus; it is a Telescope "
                  "subpart, though physically mounted on the spacecraft "
                  "element per [S3] -- both are true", "[S6][S3]"),
    ("hierarchy", "'Spacecraft Bus' is properly Observatory Support "
                  "Systems > Primary Structure", "[S6]"),
    ("SASS", "modelled as 2 splayed wings; it is SIX panels -- 2 centre "
             "fixed to the OBA, 4 outer hinged, folded down against the "
             "OBA for launch, swinging up to align in orbit", "[S6][S7]"),
    ("DAC", "modelled as a rigid solidified cone; it is SOFT MATERIAL on "
            "support booms -- a membrane visor", "[S6]"),
    ("LISS", "absent entirely; two deployable panels on the bus, each "
             "~2.1 x 2.1 m and 0.076 m thick", "[S6][S8]"),
    ("HGA", "modelled as a fixed boom; the HGA is GIMBALLED and dual-band "
            "S-band 2 GHz / Ka-band 26 GHz", "[S6]"),
    ("OBA", "stand legs were plain vertical cylinders; OBA attaches to the "
            "upper deck of the primary structure via a series of struts "
            "that extend PAST the WFI and CGI", "[S6]"),
    ("OSS", "ACS, Propulsion, Power and C&DH are named subsystems and are "
            "all still unmodelled", "[S6]"),
    ("appearance", "barrel and bus blankets were rendered gold; NASA photos "
                   "show silver-grey crinkled MLI outside and matte black "
                   "inside the barrel", "[S9]"),
    ("SASS", "centre pair + four thin outer strips was still wrong: the "
             "photos show 3 columns x 2 rows, centre column fixed, outer "
             "columns hinged", "[S9]"),
    ("HGA", "0.6 m dish on a side boom; the press kit gives a 1.7 m dish, "
            "which cannot fit beside the bus inside 4.4 m -- now below the "
            "bus on a deploying boom, placement schematic", "[S10]"),
    ("WFI", "no element wheel; an 11-position wheel of filters, grism and "
            "prism sits in the beam just ahead of the detectors", "[S12]"),
    ("TOTAL_WIDTH", "the 4.40 m width is now read as the span across the "
                    "sun shield. Read as a radius in every direction it had "
                    "forced the LISS to 18 deg; that conflict dissolves, and "
                    "the LISS angle is an honest EST", "[S1]"),
    ("SASS_HALF_SPAN", "derived from the assumption that the arrays are "
                       "the widest thing on the observatory, against a "
                       "reading of the panels as ~7 x 10 m. RESOLVED by "
                       "[S14]: the panels are 7 x 10 FEET, 2.1 x 3 m, and "
                       "three 2.1 m columns span ~6.3 m -- wider than 4.4",
     "[S1][S7][S14]"),
    # --- v3: shape pass against NASA's flight-configuration renders -----
    ("OBA", "a round 4 m tube on six vertical stilts; V006 shows a "
            "HEXAGONAL shroud (corners at +-X, a flat sun-side top) around "
            "a round inscribed bore, framed at four stations, on a short "
            "open truss bay with isogrid panels -- the barrel is ~3.6 m of "
            "the 5 m, the bay ~1.4 m, not 2.8 + 2.2", "[S13][S2]"),
    ("OBA", "no front bulkhead; V006 F shows a flat front ring carrying the "
            "visor, its lower edge following the hex's lower facets down to "
            "a stepped keel with fittings -- the observatory's lowest point",
     "[S13]"),
    ("DAC", "a truncated cone; V006 shows a GABLED SCOOP -- one ridge boom "
            "and two eave booms run the full length, the roof flares up "
            "toward the tip, and the side walls are cut at a slant so the "
            "sun-side edge reaches ~4 m past the lower edge", "[S13]"),
    ("SASS", "flat roof 0.62 m off a round barrel with three equal columns; "
             "V006 F puts the roof just proud of the hex's sun-side flat and "
             "the hinge lines on that flat's corners, so the fixed centre "
             "column is the flat's width (2.0 m) and the outer columns are "
             "what is left of the envelope", "[S13]"),
    ("LISS", "two panels leaning 28 deg off the bus's sun face; V006 B/L "
             "put them in the roof plane, carrying the sun shield aft over "
             "the bus", "[S13][S8]"),
    ("HGA", "dish slung below the bus on a downward boom; V006 B shows the "
            "boom rising from the aft top of the bus and the 1.7 m dish "
            "above the sun shield, bowl toward the Sun/Earth side", "[S13]"),
    ("WFI/CGI", "WFI on +X and CGI on -X, both near the axis; the V006 "
                "part overlays put the CGI on +X and the WFI on -X, both in "
                "the anti-sun half of the bay, their outer faces standing "
                "just proud of the bay's lower facets", "[S13]"),
    ("bus", "2.9 m hexagon, flats at +-X, well inside the barrel, on a "
            "0.8 m cone adapter; V006 B shows a hexagon nearly the barrel's "
            "width with its corners at +-X, on a short interface ring under "
            "a flat aft deck ringed by isogrid", "[S13]"),
    ("bus", "a closed 2.0 m box; V006 L/R show a closed box only ~1.4 m "
            "long, then an open, isogrid-framed bay ~2.5 m long that the "
            "WFI and CGI enclosures hang in, carrying on into the OBA's "
            "stand", "[S13]"),
    ("SASS/LISS", "array over the barrel only, shade tilted off the bus; "
                  "V006 R/B show one roof: the LISS panels in the array's "
                  "plane over the bus, the array running on to the front "
                  "ring", "[S13]"),
    ("SMA", "hexapod struts skewed 14 deg with alternating heads; V006 F "
            "shows three V-pairs, one on the sun side, feet ~76 deg apart, "
            "heads converging to ~26 deg", "[S13][S3]"),
    ("TOTAL_WIDTH", "the model squeezed its wings inside 4.40 m. NASA's "
                    "own panel size [S14] and the V006 renders [S13] both "
                    "put the deployed wing span at ~6.2-7 m, so 4.40 m "
                    "cannot be the span across the wings. The wings now "
                    "take NASA's panel width (outer columns 2.1 m, LISS "
                    "swung out from the bus's sun-side corners), and 4.40 m "
                    "is read as the body's width: nothing but the wings "
                    "may exceed it", "[S1][S13][S14]"),
]

# ===========================================================================
# OBSERVATORY ENVELOPE
# ===========================================================================

TOTAL_LENGTH  = PUB(12.70, "[S1] deployed, semi-truck-trailer length")
TOTAL_WIDTH   = PUB(4.40,  "[S1][S10] 'over 14 ft wide'; read as the "
                             "body's width (X). The wings reach past it: "
                             "see SASS_HALF_SPAN and CORRECTIONS.")
PM_DIA        = PUB(2.40,  "[S1][S5] inherited, re-figured to RST prescription")

# ===========================================================================
# STACK BUDGET  (Z=0 at LV separation plane, +Z = boresight)
# Closed against TOTAL_LENGTH: DAC_Z0 + DAC_H_DEPLOYED == 12.70
# ===========================================================================

LVA_Z0            = DER(0.00, "datum")
LVA_H             = EST(0.30, "V006 B/L [S13]: a short interface ring under "
                              "a flat aft deck, not a tall cone (was 0.80)")
LVA_DIA_BOTTOM    = EST(3.05, "separation flange; V006 B ring ~0.75x the "
                              "bus's across-corners width")
LVA_DIA_TOP       = EST(2.95, "ring body, same V006 B reading")

BUS_Z0            = DER(0.30, "= LVA_Z0 + LVA_H")
BUS_H             = EST(2.50, "primary structure up to its top deck; keeps "
                              "OBA_Z0 at 2.80 (was 2.00)")
BUS_BOX_H         = EST(1.40, "V006 L/R [S13]: the CLOSED avionics box is only "
                              "the aft ~1.4 m; the rest is an open, isogrid-"
                              "framed bay the instruments hang in")
BUS_ACROSS_CORNERS = EST(3.90, "hexagonal prism [S4], corners at +-X; V006 B "
                               "[S13] shows it nearly the barrel's width "
                               "(was 2.90)")

OBA_Z0            = DER(2.80, "= BUS_Z0 + BUS_H")
OBA_H             = PUB(5.00, "[S2] ~17 ft")
OBA_DIA           = PUB(4.00, "[S2] ~13.5 ft; read as the hex shroud's "
                              "across-corners width (X), per V006 [S13]")
OBA_BORE_DIA      = EST(3.36, "round bore inscribed in the hex shroud, nearly "
                              "touching its flats as in V006 F [S13]; clears "
                              "the 2.62 m forward metering hoop")
OBA_WALL          = EST(0.06, "blanketed shroud skin")
OBA_VANE_W        = EST(0.22, "radial width of each annular baffle vane; "
                              "V006 L shows narrow closely spaced rings")
OBA_VANES         = EST(6, "V006 L [S13]: ~5-6 rings visible in the bore")
OBA_FRAME_STATIONS = EST((0.0, 0.27, 0.66, 0.84),
                         "external ring frames as fractions of the barrel "
                         "length, read off V006 L/R [S13]")
STAND_H           = EST(1.40, "[S2] 'elephant stand' lower truss; V006 L/R "
                              "[S13] open bay ~0.4x the barrel (was 2.20)")
STAND_LEGS        = EST(6, "one longeron per hex corner")
STAND_LEG_DIA     = EST(0.11)
OBA_RING_T        = EST(0.12, "front ring plate carrying the visor, V006 F")
OBA_KEEL_DEPTH    = EST(2.20, "front ring's stepped keel reaches this far "
                              "below the axis. V006 F/L fits read ~2.5, but "
                              "V006 B hides it behind the bus, which caps it "
                              "near 2.2; the lowest point in F/L/R")

DAC_Z0            = DER(7.80, "= OBA_Z0 + OBA_H")
DAC_H_DEPLOYED    = DER(4.90, "= TOTAL_LENGTH - DAC_Z0; closes the budget")
DAC_H_STOWED      = EST(0.45)
# NOT a rigid cone. [S6]: "deployed once in orbit using a soft material
# attached to support booms". Previous passes solidified a cone shell,
# which is the wrong construction entirely.
#
# Nor a truncated cone of membrane, v2's reading. V006 [S13] shows a gabled
# SCOOP: a ridge boom and two eave booms run the full length; two roof
# panels hang between them, flaring up toward the tip; the side walls drop
# from the eaves and are cut at a slant, so the sun-side edge reaches far
# past the lower edge. Scaling it along the axis about its base (how the
# viewer stows it) keeps that shape as a short slanted collar.
DAC_MEMBRANE      = PUB(True, "[S6] soft material on support booms")
DAC_BOOMS         = EST(3,    "V006 F [S13]: boom-end fittings at the ridge "
                              "and both eaves")
DAC_BOOM_DIA      = EST(0.06)
# The section is constant: a straight gabled prism. Its mouth is cut on a
# slant: the side walls from the end of their short lower edge up to the
# eave corners, well forward, and the roof from the eave corners on to the
# ridge's tip. Each side's cut edge therefore runs skirt -> eave corner ->
# ridge tip -- the kinked edge V006 L shows, with a boom-end fitting at the
# kink. Numbers come from perspective cameras fitted to V006 [S13]; read as
# orthographic, the renders make the tip look ~15 % larger than the base,
# which is how v3's first cut came out flared.
DAC_DIA_BASE      = EST(4.12, "width across the side walls (no longer a "
                              "diameter); just outside the shroud's corners")
DAC_DIA_TOP       = EST(4.12, "walls run straight; V006 F fit puts the eave "
                              "corners and wall corners on one width")
DAC_APEX_H        = EST(2.36, "ridge height above the axis; clears the hex "
                              "shroud's top corners at the V006 roof pitch")
DAC_EAVE_H        = EST(1.30, "eave height; V006 F/L fits, roof pitch ~27 deg")
DAC_EAVE_REACH    = EST(4.10, "the eave booms and the walls' cut run this far "
                              "forward of the base; the ridge runs the full "
                              "4.90 m. V006 L camera fit: eave corner at "
                              "~11.9 m")
DAC_WALL_BOTTOM   = EST(0.55, "side walls stop this far BELOW the axis; "
                              "V006 F fit")
DAC_SKIRT_LEN     = EST(0.80, "length of the walls' short lower edge, where "
                              "the mouth's slanted plane starts; V006 L/R")

# ===========================================================================
# OPTICAL TELESCOPE ASSEMBLY  -- all [S3] unless noted
#
# Stack, bottom to top:
#   TOMA (on 3 bi-pod strut pairs under the AMS)  -- CGI collimator
#   POMA (flat oval mirror on the AMS)
#   Aft Optics Module (FM1, FM2, tertiary) on 3 bi-pod struts under AMS
#   Aft Metering Structure  -- 0.28 m thick ribbed composite box panel
#   Primary Mirror on 3 bi-pod struts off the AMS
#   PM stray-light baffle -- from AMS centre up through the PM centre
#   Forward Metering Structure -- composite hoop on top of the AMS
#   6 struts in hexapod, ~2.4 m long, driven by 6 alignment drives
#   Secondary Mirror Assembly on top of the six struts
# ===========================================================================

AMS_THICK       = PUB(0.28, "[S3] ribbed composite box-paneled Aft Metering Structure")
AMS_DIA         = EST(2.55, "TODO: measure; must exceed PM_DIA to carry the bipods")

PM_Z            = EST(5.35, "vertex height in stack; TODO measure off glb")
PM_BIPODS       = PUB(3,    "[S3] PM sits on 3 bi-pod struts")
PM_BIPOD_LEN    = EST(0.42)
PM_BAFFLE_DIA   = EST(0.50, "[S3] composite baffle AMS centre -> through PM centre")
PM_BAFFLE_H     = EST(0.95)
PM_AREAL_DENSITY = PUB(40.0, "[S3] kg/m^2, ULE honeycomb core + facesheets")

# Sag of the dish. NOT published -- inferred so the render reads right.
PM_ROC          = EST_INF(5.76, "assumes ~f/1.2 primary; R = 2f. NOT published.")
PM_CONIC        = EST_INF(-1.0, "parabola stand-in. Roman is a TMA, not RC.")

FMS_DIA         = DER(2.62, "composite hoop on top of AMS, encircling the PM")
FMS_H           = EST(0.22)
FMS_ALIGN_DRIVES = PUB(6, "[S3] six actuators driving six struts in hexapod")

SM_STRUTS       = PUB(6,    "[S3] SMA mounts at the top of six struts")
SM_STRUT_LEN    = PUB(2.40, "[S3] ~2.4-meter-length secondary mirror struts")
SM_STRUT_DIA    = EST(0.055)
SM_DIA          = EST(0.62, "TODO: not published in cleared literature")
SM_BASE_RADIUS  = DER(1.31, "= FMS_DIA/2, strut feet on the hoop")
SM_TOP_RADIUS   = EST(0.34, "strut heads on the SMA")
# V006 F [S13] looks straight down the bore at the hexapod: three V-pairs,
# one centred on the sun side, feet ~76 deg apart on the hoop, heads
# converging to ~26 deg apart at the secondary. Each strut therefore turns
# (foot half-angle - head half-angle) tangentially, which is the skew the
# rise is solved with below.
SM_PAIR_CENTRES_DEG = EST((270.0, 30.0, 150.0),
                          "pair centres, Blender angle from +X; 270 = sun "
                          "side (-Y). V006 F")
SM_PAIR_FOOT_HALF_DEG = EST(38.0, "V006 F: feet at pair centre +-38 deg")
SM_PAIR_HEAD_HALF_DEG = EST(13.0, "V006 F: heads at pair centre +-13 deg")
SM_STRUT_SKEW_DEG = DER(float(SM_PAIR_FOOT_HALF_DEG) - float(SM_PAIR_HEAD_HALF_DEG),
                        "= foot half-angle - head half-angle (was EST 14)")

# Solve SM height from the PUBLISHED 2.4 m strut length instead of guessing.
# A hexapod strut is NOT radial -- it skews tangentially, so the horizontal
# chord is the law-of-cosines distance between foot and head, not (br - tr).
# v2 bug: solving with (br - tr) and then building with skew yielded 2.360 m
# struts against a published 2.400 m. Caught by test_harness.py.
def _solve_sm_rise(base_r, top_r, strut_len, skew_deg):
    dtheta = math.radians(skew_deg)
    chord2 = base_r ** 2 + top_r ** 2 - 2 * base_r * top_r * math.cos(dtheta)
    return math.sqrt(max(strut_len ** 2 - chord2, 0.0)), math.sqrt(chord2)


_rise, _chord = _solve_sm_rise(float(SM_BASE_RADIUS), float(SM_TOP_RADIUS),
                               float(SM_STRUT_LEN), float(SM_STRUT_SKEW_DEG))
SM_RISE = DER(_rise, "= sqrt(L^2 - chord^2), chord by law of cosines w/ skew")
SM_Z = DER(float(PM_Z) + float(FMS_H) + float(SM_RISE),
           "PM vertex + hoop + solved rise")

SCRAPERS        = PUB(True, "[S3] stray-light scrapers bonded under the strut blankets")

# --- Aft Optics Module (WFI channel) -----------------------------------
AOM_BIPODS      = PUB(3, "[S3] three bi-pod struts between AMS and Aft Optics Structure")
AOM_FM1_BEAM    = PUB(0.035, "[S3] Fold Mirror 1 beam footprint dia, m")
AOM_FM2_BEAM    = PUB(0.100, "[S3] Fold Mirror 2 beam footprint dia, m")
AOM_TM_BEAM     = PUB(0.211, "[S3] Tertiary Mirror beam footprint dia, m")
AOM_BODY        = EST((0.85, 0.70, 0.60), "envelope packaging FM1/FM2/TM")
AOM_Z_BELOW_AMS = EST(0.55)
AOM_FM2_BITE    = PUB(True, "[S3] FM2 has a bite removed for WFI beam clearance")
AOM_FM1_ACTUATORS = PUB(3, "[S3] FM1 includes three actuators")

# --- Tertiary Collimator Assembly (CGI channel) -------------------------
POMA_MIRROR     = EST((0.30, 0.20), "[S3] flat OVAL mirror on the AMS")
TOMA_BIPOD_PAIRS = PUB(3, "[S3] TOMA on 3 bi-pod strut pairs off the AMS bottom")
TOMA_BODY       = EST((0.75, 0.60, 0.50), "[S3] holds M3, M4, M5 + fold flat")
TOMA_Z_BELOW_AMS = EST(0.30)
TOMA_POWERED_MIRRORS = PUB(3, "[S3] M3, M4, M5")

# --- Instrument Carrier interface ---------------------------------------
FOA_STRUTS      = PUB(6, "[S3] six Forward Optical Assembly struts, bearings each end")
FOA_STRUT_DIA   = EST(0.09)
FOA_FOOT_RADIUS = EST(1.02, "strut feet on the carrier, pulled inboard of the "
                            "WFI/CGI enclosures (was 0.42 x IC_DIA)")

# ===========================================================================
# INSTRUMENTS
# ===========================================================================

IC_Z0           = DER(2.80)
IC_H            = EST(0.55)
IC_DIA          = EST(3.20, "fits inside the bay truss (hex inradius ~1.69 m); was 3.40")

# Seated ON the instrument carrier deck (IC_Z0 + IC_H) and short enough to
# clear the Aft Metering Structure underside (~4.65 m). The first pass put
# the detectors inside the deck and the box through the AMS.
WFI_Z0          = DER(3.35, "= IC_Z0 + IC_H; sits on the deck")
# V006 part overlays [S13]: the WFI sits in the anti-sun, -X corner of the
# bay with its outer face just proud of the bay's lower-left facet (Blender
# angle 150 deg), and the CGI mirrors it on +X. v2 had them the other way
# round and near the axis. Sizes are (radial, tangential, height) in that
# facet's frame.
WFI_FACET_DEG   = EST(150.0, "enclosure faces the lower -X facet; V006 R/F")
INSTR_BOX_Z0    = EST(1.85, "WFI and CGI enclosures start just forward of "
                            "the closed bus box and run the bay's length; "
                            "V006 L/R")
WFI_SIZE        = EST((0.85, 1.50, 2.40), "(radial, tangential, height) of "
                                          "the enclosure; V006 R")
WFI_OFFSET      = EST((-1.381, 0.798), "enclosure centre, radius 1.595 m "
                                       "along WFI_FACET_DEG")
WFI_DETECTORS   = PUB(18,  "[S5] 18 H4RG detectors, 300 MP mosaic")
WFI_ELEMENTS    = PUB(11,  "[S12] 11-position element wheel")
WFI_WHEEL_DIA   = EST(0.46, "wheel size not published")
WFI_WHEEL_Z     = EST(0.5, "height above the detectors, near the exit pupil")
WFI_FOV_DEG     = PUB((0.8, 0.5), "[S3] diffraction-limited ~0.8 x 0.5 deg")

CGI_Z0          = DER(3.35, "= IC_Z0 + IC_H; sits on the deck")
CGI_FACET_DEG   = EST(30.0, "enclosure faces the lower +X facet; V006 L")
CGI_SIZE        = EST((0.70, 1.10, 2.40), "(radial, tangential, height); "
                                          "V006 L")
CGI_OFFSET      = EST((1.429, 0.825), "enclosure centre, radius 1.65 m "
                                      "along CGI_FACET_DEG")

# ===========================================================================
# SPACECRAFT SUBSYSTEMS
# ===========================================================================

# SIX panels [S6][S7], not two wings. Two centre panels are fixed to the
# OBA; four outer panels are hinged, fold down against the OBA for launch,
# and swing up in orbit to align with the centre pair.
SASS_PANELS         = PUB(6, "[S6][S7] six solar array panels")
SASS_FIXED_PANELS   = PUB(2, "[S7] centre pair, fixed to the OBA")
SASS_DEPLOY_PANELS  = PUB(4, "[S7] outer, hinged, swing up in orbit")
SASS_STOWED_AGAINST_OBA = PUB(True, "[S6] folded down against the OBA for launch")
# Layout from NASA's integration photos [S9]: three columns by two rows.
# The centre column's two panels are the fixed pair; the outer columns'
# four are the hinged ones.
SASS_COLUMNS    = PUB(3, "[S9] photos: 3 columns x 2 rows of panels")
SASS_ROWS       = PUB(2, "[S9] photos: 3 columns x 2 rows of panels")
SASS_Z0         = EST(2.20, "aft edge of the array, just forward of the LISS "
                            "it continues; V006 L/R/B (was 2.60)")
SASS_H          = EST(5.45, "two ~2.7 m rows running to the barrel's front "
                            "ring; V006 R (was 4.60)")
SASS_PANEL_T    = EST(0.06, "V006 F edge-on panels read as slabs")
# The shroud is a hexagon with its corners at +-X, so its sun-side flat runs
# between x = -R/2 and +R/2. V006 F [S13] puts the SASS hinge lines on that
# flat's corners: the fixed centre column is the flat's width, and the
# hinged outer columns fold down onto the sloping upper facets for launch.
OBA_TOP_FLAT_W  = DER(float(OBA_DIA) / 2, "hex side = circumradius = OBA_DIA/2")
SASS_COL_W      = DER(float(OBA_TOP_FLAT_W),
                      "fixed centre column = the barrel's sun-side flat, "
                      "hinged at its corners; V006 F (was TOTAL_WIDTH/3)")
SASS_OUTER_W    = PUB(2.10, "[S14] each panel ~7 x 10 ft (2.1 x 3 m); the "
                            "V006 F camera fit reads ~2.5 m, within its "
                            "perspective error (was 1.20, squeezed into "
                            "4.40 m)")
SASS_HALF_SPAN  = DER(float(SASS_COL_W) / 2 + float(SASS_OUTER_W),
                      "centre half-column + one outer column, deployed "
                      "flat; the wings, not the body, set the span")
SASS_CHAMFER    = EST(0.30, "outer corners of the end panels are cut at 45 "
                            "deg; V006 F/L")
SASS_STANDOFF   = EST(0.55, "array centre-plane above the barrel's sun-side "
                            "flat, on brackets; V006 F camera fit puts the "
                            "wings ~2.3 m above the axis (was 0.62 off a "
                            "round barrel)")


# The fold is NOT free either. An outer column hinged at the centre column's
# edge swings down toward the barrel for launch; the deepest it can go is
# where it would touch the shroud. Solved against the hexagon, not guessed.
def _hex_inside(x, y, R, clearance):
    """Is (x, y) inside a hexagon of circumradius R (corners on +-X), grown
    by `clearance`?"""
    a = R * math.sqrt(3) / 2
    return (abs(y) < a + clearance and
            math.sqrt(3) * abs(x) + abs(y) < math.sqrt(3) * R + 2 * clearance)


def _solve_sass_fold(hinge_x, panel_w, standoff, barrel_R, clearance=0.06):
    hx, hy = hinge_x, barrel_R * math.sqrt(3) / 2 + standoff   # hinge
    best = 0.0
    for tenth in range(0, 1200):
        th = math.radians(tenth / 10)
        ok = not any(_hex_inside(hx + s * panel_w * math.cos(th),
                                 hy - s * panel_w * math.sin(th),
                                 barrel_R, clearance)
                     for s in (0.1, 0.25, 0.5, 0.75, 1.0))
        if not ok:
            break
        best = tenth / 10
    return best


SASS_FOLD_DEG   = DER(_solve_sass_fold(float(SASS_COL_W) / 2, float(SASS_OUTER_W),
                                       float(SASS_STANDOFF), float(OBA_DIA) / 2),
                      "deepest fold before the column meets the hex shroud")

# --- Lower Instrument Sun Shade -- absent from every previous pass -------
LISS_PANELS     = PUB(2,     "[S6] two deployable panels on the bus")
LISS_PANEL_W    = PUB(2.10,  "[S8] ~7 ft")
LISS_PANEL_H    = PUB(2.10,  "[S8] ~7 ft")
LISS_PANEL_T    = PUB(0.076, "[S8] 3 in, aluminium honeycomb sandwich")
# V006 B/L [S13] put the LISS in the sun shield's plane, over the bus: the
# roof continues aft of the array. V006 hinges each panel at a sun-side
# corner of the bus and swings it OUT to the array's span; for launch it
# folds down onto the bus's sloping upper facet.
LISS_Z0         = EST(0.05,  "aft edge of the panels, flush with the aft "
                             "end; V006 L overhangs it, the Z=0 datum does "
                             "not allow that (was 1.10)")
LISS_STANDOFF   = DER(float(OBA_DIA) / 2 * math.sqrt(3) / 2 + float(SASS_STANDOFF)
                      - float(BUS_ACROSS_CORNERS) / 2 * math.sqrt(3) / 2,
                      "panels sit in the sun shield's plane, on arms off "
                      "the bus's sun-side corners; V006 B/R")
LISS_CHAMFER    = EST(0.35,  "outer-aft corner cut; V006 L/B roof outline")
LISS_OPEN_DEG   = EST(60.0,  "swing from folded onto the bus's upper facet "
                             "(the hexagon's 60 deg slope) out to the roof "
                             "plane; not published (was 90, hanging down "
                             "the bus flank)")

HGA_DISH_DIA    = PUB(1.70, "[S10] 1.7 m carbon-composite dish, 10.9 kg")
HGA_DISH_DEPTH  = EST(0.38, "V006 F/B show a deep bowl, depth ~0.2 D "
                            "(was 0.26)")
HGA_DISH_RIBS   = EST(24, "radial ribs on the dish's back; V006 F/B/L")
HGA_FEED_STRUTS = PUB(4, "[S11] test photo: four struts to a central feed")
HGA_BOOM_DIA    = EST(0.10)
HGA_GIMBALLED   = PUB(True, "[S6] gimbals allow multi-axis ground pointing")
HGA_GIMBAL_DIA  = EST(0.22)
LGA_DIA         = EST(0.14)
# Where the boom lives is not published in text, but V006 [S13] shows it:
# rising from the aft, sun-side edge of the bus, past the sun shield, with
# the dish above the roof over the bus's aft end, bowl toward the Sun and
# Earth. v2 hung it below the bus on a downward boom.
HGA_ROOT_Z      = EST(0.45, "boom root on the bus's sun-side flat, just "
                            "forward of the aft deck; V006 B/L (was 1.70)")
HGA_BOOM_LEN    = EST(1.50, "V006 F fit: dish vertex ~3.6 m above the axis")
HGA_BOOM_TILT_DEG = EST(14.0, "boom leans forward from vertical just enough "
                              "that the dish clears the Z=0 datum; V006 L "
                              "puts the dish ~0.6 m further aft")
HGA_STOWED_DEG  = EST(-34.0, "boom folded forward through the slot between "
                             "the LISS panels, dish clear above the roof; the "
                             "real launch stowage is not published (-70 swung "
                             "the dish into the instrument bay)")

TCE_BOARDS      = PUB(17, "[S3] 17 circuit board assemblies, on the spacecraft element")
TCE_HEATER_ZONES = PUB(96, "[S3] per side")


# ===========================================================================
# MEASURED OVERRIDES
# ===========================================================================

_MEAS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "roman_dims_measured.json")


def apply_measured(path=None, verbose=True):
    """Overwrite EST values with MEAS values from roman_measure.py.

    Only EST/EST_INF entries are overridden -- a measurement off a
    visualisation asset must never overwrite a published number.
    Returns the list of names that changed.
    """
    path = path or _MEAS_FILE
    if not os.path.exists(path):
        if verbose:
            print(f"[dims] no measured overrides at {path} -- using defaults")
        return []
    with open(path) as f:
        data = json.load(f)

    g = globals()
    changed = []
    for name, value in data.items():
        cur = g.get(name)
        if cur is None:
            continue
        tag = getattr(cur, "tag", None)
        if tag not in ("EST", "EST_INF"):
            if verbose:
                print(f"[dims] refusing to override {name} (tag={tag})")
            continue
        g[name] = MEAS(value, f"measured off NASA glb (was {tag} {float(cur):.3f})")
        changed.append(name)
    if verbose:
        print(f"[dims] applied {len(changed)} measured overrides")
    return changed


# ===========================================================================
# PROVENANCE REPORT
# ===========================================================================

def audit_provenance(verbose=True):
    counts = {}
    est_names = []
    for name, val in sorted(globals().items()):
        if name.startswith("_") or not isinstance(val, (Dim, DimTuple, DimFlag)):
            continue
        counts[val.tag] = counts.get(val.tag, 0) + 1
        if val.tag in ("EST", "EST_INF"):
            shown = (float(val) if isinstance(val, (Dim, DimFlag))
                     else tuple(round(float(x), 2) for x in val))
            est_names.append((name, shown, val.note))

    total = sum(counts.values())
    solid = counts.get("PUB", 0) + counts.get("DER", 0) + counts.get("MEAS", 0)

    if verbose:
        print("\n" + "=" * 66)
        print("  DIMENSION PROVENANCE")
        print("=" * 66)
        for tag in ("PUB", "DER", "MEAS", "EST", "EST_INF"):
            if tag in counts:
                print(f"    {tag:<8} {counts[tag]:>3}")
        print(f"    {'-'*20}")
        print(f"    grounded  {solid}/{total}  ({100*solid/max(total,1):.0f}%)")
        if est_names:
            print("\n  REMAINING ACCURACY DEBT (each is a TODO):")
            for n, v, note in est_names:
                vs = f"{v:8.3f}" if isinstance(v, float) else f"{str(v):>8}"
                print(f"    {n:<22} {vs}  {note[:34]}")
        print("=" * 66 + "\n")
    return counts, est_names


def check_budget():
    """Assert the stack closes AND nothing exceeds the published envelope.

    v2 only checked the Z budget, so a 1.6 m antenna boom that doubled
    the observatory's width sailed through. Width is now checked too.
    """
    top = float(DAC_Z0) + float(DAC_H_DEPLOYED)
    assert abs(top - float(TOTAL_LENGTH)) < 1e-6, \
        f"stack budget open by {abs(top - float(TOTAL_LENGTH)):.4f} m"
    assert abs(float(OBA_Z0) + float(OBA_H) - float(DAC_Z0)) < 1e-6
    assert abs(float(BUS_Z0) + float(BUS_H) - float(OBA_Z0)) < 1e-6

    # The body stays inside the published width; the wings set the span
    # (see TOTAL_WIDTH and SASS_HALF_SPAN).
    half = float(TOTAL_WIDTH) / 2
    reach = {
        "outer barrel":     float(OBA_DIA) / 2,
        "spacecraft bus":   float(BUS_ACROSS_CORNERS) / 2,
        "aperture cover":   max(float(DAC_DIA_BASE), float(DAC_DIA_TOP)) / 2,
    }
    for what, r in reach.items():
        assert r <= half + 1e-6, (
            f"{what} reaches {r:.3f} m across, but the published "
            f"body half-width is {half:.3f} m")
    liss_reach = float(BUS_ACROSS_CORNERS) / 4 + float(LISS_PANEL_W)
    assert abs(liss_reach - float(SASS_HALF_SPAN)) < 0.15, (
        f"LISS reaches {liss_reach:.3f} m but the array {float(SASS_HALF_SPAN):.3f} m; "
        "V006 shows one continuous roof edge")
    assert float(SASS_FOLD_DEG) > 30, "outer SASS columns barely fold"
    assert float(BUS_ACROSS_CORNERS) < float(OBA_DIA), \
        "bus must not be wider than the barrel it carries"
    inradius = float(OBA_DIA) / 2 * math.sqrt(3) / 2
    assert float(OBA_BORE_DIA) / 2 < inradius - 0.02, \
        "round bore does not fit inside the hex shroud"
    assert float(DAC_WALL_BOTTOM) + float(DAC_EAVE_H) > 0, \
        "visor side walls have no height"
    return True


if __name__ == "__main__":
    check_budget()
    audit_provenance()
    print(f"  SM height solved from published 2.4 m struts:")
    print(f"    horizontal chord {_chord:.3f} m (skew {float(SM_STRUT_SKEW_DEG):.0f} deg)")
    print(f"    vertical rise   {float(SM_RISE):.3f} m")
    print(f"    SM vertex at Z  {float(SM_Z):.3f} m\n")
