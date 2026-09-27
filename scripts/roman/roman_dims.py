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
                       "the widest thing on the observatory. NASA press "
                       "copy describes each of six panels as ~7 x 10 m, "
                       "which cannot coexist with a 4.4 m deployed width. "
                       "UNRESOLVED -- one of the two figures is wrong.",
     "[S1][S7]"),
]

# ===========================================================================
# OBSERVATORY ENVELOPE
# ===========================================================================

TOTAL_LENGTH  = PUB(12.70, "[S1] deployed, semi-truck-trailer length")
TOTAL_WIDTH   = PUB(4.40,  "[S1] deployed; read as the span across the "
                             "sun shield (X). Depth is not published.")
PM_DIA        = PUB(2.40,  "[S1][S5] inherited, re-figured to RST prescription")

# ===========================================================================
# STACK BUDGET  (Z=0 at LV separation plane, +Z = boresight)
# Closed against TOTAL_LENGTH: DAC_Z0 + DAC_H_DEPLOYED == 12.70
# ===========================================================================

LVA_Z0            = DER(0.00, "datum")
LVA_H             = EST(0.80, "TODO: Falcon Heavy PAF stack height")
LVA_DIA_BOTTOM    = EST(2.60)
LVA_DIA_TOP       = EST(3.20)

BUS_Z0            = DER(0.80, "= LVA_Z0 + LVA_H")
BUS_H             = EST(2.00, "TODO: measure off glb")
BUS_ACROSS_CORNERS = EST(2.90, "hexagonal prism [S4]; must clear OBA and fit TOTAL_WIDTH")

OBA_Z0            = DER(2.80, "= BUS_Z0 + BUS_H")
OBA_H             = PUB(5.00, "[S2] ~17 ft")
OBA_DIA           = PUB(4.00, "[S2] ~13.5 ft")
OBA_WALL          = EST(0.06)
OBA_VANE_W        = EST(0.35, "radial width of each annular baffle vane")
STAND_H           = EST(2.20, "[S2] 'elephant stand' lower truss")
STAND_LEGS        = EST(6)
STAND_LEG_DIA     = EST(0.16)

DAC_Z0            = DER(7.80, "= OBA_Z0 + OBA_H")
DAC_H_DEPLOYED    = DER(4.90, "= TOTAL_LENGTH - DAC_Z0; closes the budget")
DAC_H_STOWED      = EST(0.45)
# NOT a rigid cone. [S6]: "deployed once in orbit using a soft material
# attached to support booms". Previous passes solidified a cone shell,
# which is the wrong construction entirely.
DAC_MEMBRANE      = PUB(True, "[S6] soft material on support booms")
DAC_BOOMS         = EST(3,    "boom count not published")
DAC_BOOM_DIA      = EST(0.05)
DAC_DIA_BASE      = DER(3.95, "~ OBA_DIA less clearance")
DAC_DIA_TOP       = EST(3.10)

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
SM_STRUT_SKEW_DEG = EST(14.0, "hexapod pairs skew tangentially; not published")

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

# ===========================================================================
# INSTRUMENTS
# ===========================================================================

IC_Z0           = DER(2.80)
IC_H            = EST(0.55)
IC_DIA          = EST(3.40)

# Seated ON the instrument carrier deck (IC_Z0 + IC_H) and short enough to
# clear the Aft Metering Structure underside (~4.65 m). The first pass put
# the detectors inside the deck and the box through the AMS.
WFI_Z0          = DER(3.35, "= IC_Z0 + IC_H; sits on the deck")
WFI_SIZE        = EST((1.30, 1.10, 1.28))
WFI_OFFSET      = EST((0.75, 0.30))
WFI_DETECTORS   = PUB(18,  "[S5] 18 H4RG detectors, 300 MP mosaic")
WFI_ELEMENTS    = PUB(11,  "[S12] 11-position element wheel")
WFI_WHEEL_DIA   = EST(0.46, "wheel size not published")
WFI_WHEEL_Z     = EST(0.5, "height above the detectors, near the exit pupil")
WFI_FOV_DEG     = PUB((0.8, 0.5), "[S3] diffraction-limited ~0.8 x 0.5 deg")

CGI_Z0          = DER(3.35, "= IC_Z0 + IC_H; sits on the deck")
CGI_SIZE        = EST((0.95, 0.85, 1.22))
CGI_OFFSET      = EST((-0.80, -0.25))

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
SASS_Z0         = EST(2.60)
SASS_H          = EST(4.60)
SASS_PANEL_T    = EST(0.05)
SASS_HALF_SPAN  = DER(float(TOTAL_WIDTH) / 2.0,
                      "ASSUMES the arrays are the widest item -- see "
                      "CORRECTIONS; NASA panel sizing conflicts with this")
SASS_COL_W      = DER(float(TOTAL_WIDTH) / float(SASS_COLUMNS),
                      "three coplanar columns spanning the published width")
SASS_STANDOFF   = EST(0.62, "sun-side standoff from the barrel")


# The fold is NOT free either. An outer column hinged at the centre column's
# edge swings back toward the barrel for launch; the deepest it can go is
# where its far edge would touch the barrel. Solved, not guessed.
def _solve_sass_fold(col_w, standoff, barrel_r, clearance=0.06):
    hx, hy = col_w / 2, barrel_r + standoff      # hinge, in the plane
    best = 0.0
    for tenth in range(0, 900):
        th = math.radians(tenth / 10)
        ok = all(math.hypot(hx + s * col_w * math.cos(th),
                            hy - s * col_w * math.sin(th)) >= barrel_r + clearance
                 for s in (0.25, 0.5, 0.75, 1.0))
        if not ok:
            break
        best = tenth / 10
    return best


SASS_FOLD_DEG   = DER(_solve_sass_fold(float(SASS_COL_W), float(SASS_STANDOFF),
                                       float(OBA_DIA) / 2),
                      "deepest fold before the column's edge meets the barrel")

# --- Lower Instrument Sun Shade -- absent from every previous pass -------
LISS_PANELS     = PUB(2,     "[S6] two deployable panels on the bus")
LISS_PANEL_W    = PUB(2.10,  "[S8] ~7 ft")
LISS_PANEL_H    = PUB(2.10,  "[S8] ~7 ft")
LISS_PANEL_T    = PUB(0.076, "[S8] 3 in, aluminium honeycomb sandwich")
LISS_Z0         = EST(1.10,  "attachment height on the bus")
LISS_HINGE_GAP  = EST(0.10,  "standoff from the bus face")

# Earlier passes solved this angle from the 4.40 m width, which pinned the
# panels at 18 deg, nearly flat. The width is now read across the sun shield
# (see TOTAL_WIDTH), and the LISS tilts out along the depth axis, so the
# envelope no longer sets it -- and nothing published does either.
LISS_OPEN_DEG   = EST(28.0, "not published; kept inside the SASS plane")

HGA_DISH_DIA    = PUB(1.70, "[S10] 1.7 m carbon-composite dish, 10.9 kg")
HGA_DISH_DEPTH  = EST(0.26)
HGA_FEED_STRUTS = PUB(4, "[S11] test photo: four struts to a central feed")
HGA_BOOM_DIA    = EST(0.10)
HGA_GIMBALLED   = PUB(True, "[S6] gimbals allow multi-axis ground pointing")
HGA_GIMBAL_DIA  = EST(0.22)
LGA_DIA         = EST(0.14)
# Where the boom lives is not published. A 1.7 m dish cannot sit beside the
# bus inside the 4.4 m width (v2 derived a 0.45 m boom for a 0.6 m dish that
# the press kit now contradicts), so it hangs below the bus on the sun side,
# where Earth is from L2, and swings down on its boom after launch [S10].
HGA_ROOT_Z      = EST(1.70, "boom root height on the bus")
HGA_BOOM_LEN    = EST(1.25, "placement schematic; boom deploys after launch")
HGA_BOOM_DOWN_DEG = EST(38.0, "deployed boom angle below the bus")
HGA_STOWED_DEG  = EST(-70.0, "boom folded up against the bus for launch")

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

    # Width is the span across the sun shield (X); see TOTAL_WIDTH.
    half = float(TOTAL_WIDTH) / 2
    reach = {
        "solar array edge": float(SASS_COL_W) * float(SASS_COLUMNS) / 2,
        "outer barrel":     float(OBA_DIA) / 2,
        "spacecraft bus":   float(BUS_ACROSS_CORNERS) / 2,
        "LISS panel span":  float(LISS_PANEL_W),
    }
    for what, r in reach.items():
        assert r <= half + 1e-6, (
            f"{what} reaches {r:.3f} m across, but the published "
            f"deployed half-width is {half:.3f} m")
    assert float(SASS_FOLD_DEG) > 30, "outer SASS columns barely fold"
    assert float(BUS_ACROSS_CORNERS) < float(OBA_DIA), \
        "bus must be narrower than the outer barrel that slides over it"
    return True


if __name__ == "__main__":
    check_budget()
    audit_provenance()
    print(f"  SM height solved from published 2.4 m struts:")
    print(f"    horizontal chord {_chord:.3f} m (skew {float(SM_STRUT_SKEW_DEG):.0f} deg)")
    print(f"    vertical rise   {float(SM_RISE):.3f} m")
    print(f"    SM vertex at Z  {float(SM_Z):.3f} m\n")
