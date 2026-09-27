"""
roman_build.py  --  v2
Nancy Grace Roman Space Telescope -- Blender scene builder.

Requires roman_dims.py in the same folder.

    Blender > Scripting > Open > roman_build.py > Run
    (or)  blender --python roman_build.py

WHAT CHANGED FROM v1
--------------------
* Optical design corrected. Roman is a THREE-MIRROR ANASTIGMAT, not a
  Ritchey-Chretien. v1 said otherwise and was wrong.
* The whole OTA interior is now built from the ITAR-cleared SPIE paper:
  Aft Metering Structure, PM bipods, PM stray-light baffle, Forward
  Metering Structure hoop, 6-strut hexapod solved from the published
  2.4 m strut length, Aft Optics Module (FM1/FM2/tertiary), POMA, TOMA
  on 3 bipod pairs, and the 6 FOA struts to the Instrument Carrier.
* Mirrors are real conic surfaces generated from the sag equation with
  actual radial geometry -- not flat n-gons with a disabled modifier.
* QC MEASURES the built meshes through the evaluated depsgraph and
  compares to published anchors. v1's audit compared constants to
  themselves and could not fail.
* Scene setup: camera rig, sun-at-L2 lighting, Cycles config.

COORDINATES
    +Z  boresight     -Y  sun side     Z=0  LV separation plane
"""

import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix

# --- bootstrap roman_dims -------------------------------------------------
_here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else ""
if not _here and bpy.data.filepath:
    _here = os.path.dirname(bpy.data.filepath)
for _p in filter(None, [_here, os.getcwd()]):
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    import roman_dims as D
    import importlib
    importlib.reload(D)
except ImportError:
    raise ImportError(
        "roman_dims.py not found. Put it next to roman_build.py, or add its "
        "folder to sys.path before running.")

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
WIPE_SCENE      = True
USE_MEASURED    = True    # pull roman_dims_measured.json if present
DEPLOYED        = True    # False -> stowed launch config
SASS_STOWED     = False   # True -> outer panels folded against the OBA
BUILD_OTA       = True    # the internals; slowest part
BUILD_SCENE     = True    # camera + lights + render settings
RUN_QC          = True
QC_TOLERANCE    = 0.02    # metres

MIRROR_RADIAL   = 48      # sag mesh resolution
MIRROR_ANGULAR  = 128

COLLS = {}
MATS = {}


# ===========================================================================
# PLUMBING
# ===========================================================================

def wipe():
    if bpy.context.mode != 'OBJECT' and bpy.context.object:
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                  bpy.data.lights):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def set_units():
    u = bpy.context.scene.unit_settings
    u.system, u.scale_length, u.length_unit = 'METRIC', 1.0, 'METERS'
    if bpy.context.screen:
        for area in bpy.context.screen.areas:
            if area.type == 'VIEW_3D':
                for sp in area.spaces:
                    if sp.type == 'VIEW_3D':
                        sp.clip_start, sp.clip_end = 0.01, 500.0


def coll(name, parent=None):
    if name in COLLS:
        return COLLS[name]
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    COLLS[name] = c
    return c


def move_to(obj, target):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    target.objects.link(obj)


def _finish(obj, name, target, parent=None, mat=None):
    obj.name = name
    if obj.data:
        obj.data.name = name + ".data"
    move_to(obj, target)
    if parent:
        # BUGFIX v1: matrix_world can be stale here. Force a depsgraph
        # update before reading it, or children land at the wrong offset.
        bpy.context.view_layer.update()
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    if mat:
        obj.data.materials.append(mat)
    return obj


def empty(name, loc, target, parent=None, size=0.4, kind='PLAIN_AXES'):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type, e.empty_display_size = kind, size
    e.location = Vector(loc)
    target.objects.link(e)
    if parent:
        bpy.context.view_layer.update()
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    return e


def M(k):
    return MATS.get(k)


# ===========================================================================
# GEOMETRY PRIMITIVES
# ===========================================================================

def cyl(name, dia, h, z, target, parent=None, verts=64, mat=None,
        rot=(0, 0, 0), xy=(0, 0), fill='NGON'):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=dia / 2, depth=h, end_fill_type=fill,
        location=(xy[0], xy[1], z + h / 2), rotation=rot)
    return _finish(bpy.context.object, name, target, parent, mat)


def cone(name, d0, d1, h, z, target, parent=None, verts=64, mat=None,
         xy=(0, 0), fill='NGON'):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=d0 / 2, radius2=d1 / 2, depth=h,
        end_fill_type=fill, location=(xy[0], xy[1], z + h / 2))
    return _finish(bpy.context.object, name, target, parent, mat)


def _wall(obj, thickness):
    """Solidify INWARD, so the outer diameter stays the published one.

    Blender's primitives have outward normals and offset +1 grows along
    them -- outward. Earlier passes used +1 believing it grew inward, and
    on capped cylinders the corner vertices moved out diagonally too:
    OBA measured 4.086 x 5.042 m against a published 4.00 x 5.00 m. That
    was the first thing a real Blender run caught.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_add(type='SOLIDIFY')
    obj.modifiers[-1].thickness = thickness
    obj.modifiers[-1].offset = -1.0
    return obj


def _deployable(obj, pivot, axis, stowed_deg):
    """Tag a part the web viewer can fold for launch.

    Stored as custom properties, which the glTF exporter writes as node
    extras. roman_export_web.py moves the object's origin onto `pivot` so
    the fold is a single rotation about `axis` (Blender frame) by
    `stowed_deg`, measured from the deployed pose built here.
    """
    obj["deploy_pivot"] = [float(v) for v in pivot]
    obj["deploy_axis"] = axis
    obj["stowed_deg"] = float(stowed_deg)
    return obj


def tube(name, dia, h, z, wall, target, parent=None, verts=96, mat=None):
    """Open-ended cylinder with a real wall.

    primitive_cylinder_add caps both ends by default. Barrels, hoops and
    ring heaters built with it were sealed drums, and together they put
    four solid lids between the aperture and the primary mirror. A
    shallow tube with a wide wall is also how the barrel's annular
    baffle vanes are made.
    """
    o = cyl(name, dia, h, z, target, parent, verts, mat, fill='NOTHING')
    return _wall(o, wall)


def box(name, size, loc, target, parent=None, mat=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = Vector(size)
    return _finish(o, name, target, parent, mat)


def strut(name, p0, p1, dia, target, parent=None, mat=None):
    """A cylinder spanning two world points. Used for every bipod and vane."""
    p0, p1 = Vector(p0), Vector(p1)
    v = p1 - p0
    L = v.length
    if L < 1e-6:
        return None
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=16, radius=dia / 2, depth=L, location=(p0 + p1) / 2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = v.to_track_quat('Z', 'Y')
    return _finish(o, name, target, parent, mat)


def conic_mirror(name, dia, roc, conic, z, target, parent=None, mat=None,
                 inner_dia=0.0, flip=False):
    """Generate a real conic surface from the standard sag equation:

           z(r) = r^2 / ( R * (1 + sqrt(1 - (1+K) r^2 / R^2)) )

    K = 0 sphere, -1 paraboloid, K < -1 hyperboloid.
    Roman's actual prescription is not in the public literature -- this
    gives a geometrically correct conic of the stated R and K, which is
    right for rendering and wrong for optics. Do not raytrace it.
    """
    bm = bmesh.new()
    r_in, r_out = inner_dia / 2, dia / 2
    nr, na = MIRROR_RADIAL, MIRROR_ANGULAR
    R, K = float(roc), float(conic)

    def sag(r):
        if abs(R) < 1e-9:
            return 0.0
        disc = 1.0 - (1.0 + K) * r * r / (R * R)
        if disc < 0:
            return 0.0
        s = r * r / (R * (1.0 + math.sqrt(disc)))
        return -s if flip else s

    rings = []
    for i in range(nr + 1):
        rr = r_in + (r_out - r_in) * i / nr
        ring = []
        for j in range(na):
            a = 2 * math.pi * j / na
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a),
                                      sag(rr))))
        rings.append(ring)

    for i in range(nr):
        for j in range(na):
            k = (j + 1) % na
            bm.faces.new((rings[i][j], rings[i][k],
                          rings[i + 1][k], rings[i + 1][j]))

    if r_in <= 1e-6:
        bm.faces.new(rings[0][::-1])  # cap the centre if solid

    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location.z = z
    for poly in me.polygons:
        try: poly.use_smooth = True
        except Exception: pass
    return _finish(o, name, target, parent, mat)


def paraboloid_dish(name, dia, depth, loc, target, parent=None, mat=None):
    """A real parabolic dish, not a squashed sphere (v1 used a sphere)."""
    r = dia / 2
    a = depth / (r * r) if r > 1e-9 else 0.0
    bm = bmesh.new()
    nr, na = 20, 48
    rings = []
    for i in range(nr + 1):
        rr = r * i / nr
        rings.append([bm.verts.new((rr * math.cos(2 * math.pi * j / na),
                                    rr * math.sin(2 * math.pi * j / na),
                                    a * rr * rr)) for j in range(na)])
    for i in range(nr):
        for j in range(na):
            k = (j + 1) % na
            bm.faces.new((rings[i][j], rings[i][k],
                          rings[i + 1][k], rings[i + 1][j]))
    bm.faces.new(rings[0][::-1])
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    return _finish(o, name, target, parent, mat)


# ===========================================================================
# MATERIALS
# ===========================================================================

def _pbr(name, base, metallic, rough, extra=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = (*base, 1.0)
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = rough
        for k, v in (extra or {}).items():
            if k in b.inputs:
                b.inputs[k].default_value = v
    return m


def build_materials():
    MATS.update({
        "MLI_Gold":    _pbr("MLI_Gold", (0.72, 0.48, 0.13), 1.0, 0.32,
                            {"Anisotropic": 0.6}),
        "MLI_Silver":  _pbr("MLI_Silver", (0.78, 0.79, 0.80), 1.0, 0.28,
                            {"Anisotropic": 0.5}),
        "SolarArray":  _pbr("SolarArray", (0.29, 0.10, 0.06), 0.35, 0.22),
        "Mirror":      _pbr("Mirror", (0.95, 0.93, 0.88), 1.0, 0.015),
        "Baffle_Black": _pbr("Baffle_Black", (0.012, 0.012, 0.014), 0.0, 0.92),
        "Structure_White": _pbr("Structure_White", (0.82, 0.82, 0.83), 0.0, 0.45),
        "Composite":   _pbr("Composite", (0.05, 0.05, 0.055), 0.1, 0.55),
        "Radiator":    _pbr("Radiator", (0.88, 0.89, 0.90), 0.2, 0.18),
        "ULE_Glass":   _pbr("ULE_Glass", (0.86, 0.87, 0.88), 0.05, 0.30),
        # HgCdTe detector arrays read near-black with a violet cast.
        "Detector":    _pbr("Detector", (0.045, 0.035, 0.075), 0.55, 0.22),
        # Per NASA photos [S9]: silver-grey MLI outside, matte black inside
        # the barrel; the visor is silver out, glossy black in. The web
        # viewer shades the inner faces by name; Cycles shows the outer.
        "MLI_Barrel":  _pbr("MLI_Barrel", (0.62, 0.63, 0.65), 1.0, 0.36),
        "Visor":       _pbr("Visor", (0.66, 0.67, 0.69), 0.9, 0.3),
        "HGA_Carbon":  _pbr("HGA_Carbon", (0.07, 0.072, 0.078), 0.2, 0.55),
        "Filter":      _pbr("Filter", (0.2, 0.26, 0.34), 0.3, 0.08),
    })


# ===========================================================================
# HIERARCHY
# ===========================================================================

def build_hierarchy():
    """NASA's canonical five-part decomposition [S6].

    Earlier passes used Observatory = Spacecraft + Integrated Payload
    Assembly, from a build/verification paper. That put the Outer Barrel
    Assembly and Deployable Aperture Cover under the spacecraft; NASA
    files both under the Telescope. Corrected here.
    """
    obs = coll("OBSERVATORY")

    tele = coll("TELESCOPE", obs)
    for n in ("TEL.PrimaryMirrorAssembly", "TEL.SecondaryMirrorAssembly",
              "TEL.AftOpticsModule", "TEL.TertiaryCollimatorAssembly",
              "TEL.TelescopeControlElectronics",
              "TEL.DeployableApertureCover", "TEL.OuterBarrelAssembly",
              "TEL.ForwardStructureAssembly", "TEL.Interfaces"):
        coll(n, tele)

    oss = coll("OBSERVATORY_SUPPORT_SYSTEMS", obs)
    for n in ("OSS.PrimaryStructure", "OSS.LowerInstrumentSunShade",
              "OSS.LaunchVehicleAdapter"):
        coll(n, oss)

    coll("SOLAR_ARRAY_SUN_SHIELD", obs)
    coll("COMMUNICATIONS", obs)
    coll("WIDE_FIELD_INSTRUMENT", obs)
    coll("CORONAGRAPH_INSTRUMENT", obs)
    coll("INSTRUMENT_CARRIER", obs)

    coll("_REFERENCE")
    coll("_SCENE")
    return obs


# ===========================================================================
# OTA  --  built from the ITAR-cleared SPIE paper
# ===========================================================================

def build_ota(root):
    pm_z = float(D.PM_Z)
    ams_top = pm_z - float(D.PM_BIPOD_LEN)
    ams_bot = ams_top - float(D.AMS_THICK)

    # ---- Primary Mirror Assembly ----------------------------------------
    c = COLLS["TEL.PrimaryMirrorAssembly"]
    n = empty("N.PrimaryMirrorAssembly", (0, 0, pm_z), c, root, 1.0, 'SPHERE')

    conic_mirror("PM.Surface", float(D.PM_DIA), float(D.PM_ROC),
                 float(D.PM_CONIC), pm_z, c, n, M("Mirror"),
                 inner_dia=float(D.PM_BAFFLE_DIA))
    cyl("PM.Substrate", float(D.PM_DIA), 0.14, pm_z - 0.15, c, n,
        verts=96, mat=M("ULE_Glass"))

    # AMS: 0.28 m ribbed composite box-panel structure  [PUB]
    cyl("AMS.Structure", float(D.AMS_DIA), float(D.AMS_THICK), ams_bot,
        c, n, verts=64, mat=M("Composite"))
    for i in range(8):  # rib pattern, visual
        a = 2 * math.pi * i / 8
        box("AMS.Rib.%d" % (i + 1),
            (float(D.AMS_DIA) * 0.48, 0.03, float(D.AMS_THICK) * 0.85),
            (0, 0, ams_bot + float(D.AMS_THICK) / 2), c, n,
            M("Composite"), rot=(0, 0, a))

    # PM sits on 3 bi-pod struts off the AMS  [PUB]
    for i in range(int(D.PM_BIPODS)):
        a = 2 * math.pi * i / int(D.PM_BIPODS)
        top_r, bot_r, spread = float(D.PM_DIA) * 0.42, float(D.AMS_DIA) * 0.44, 0.18
        apex = (top_r * math.cos(a), top_r * math.sin(a), pm_z - 0.16)
        for s, lbl in ((+1, "A"), (-1, "B")):
            aa = a + s * spread
            foot = (bot_r * math.cos(aa), bot_r * math.sin(aa), ams_top)
            strut(f"PM.Bipod{i+1}{lbl}", foot, apex, 0.045, c, n, M("Composite"))

    # stray-light baffle: AMS centre -> up through the PM centre  [PUB]
    cyl("PM.StrayLightBaffle", float(D.PM_BAFFLE_DIA), float(D.PM_BAFFLE_H),
        ams_top, c, n, verts=48, mat=M("Baffle_Black"))

    # ---- Forward Structure Assembly (FMS hoop + alignment drives) --------
    c = COLLS["TEL.ForwardStructureAssembly"]
    nf = empty("N.ForwardStructureAssembly", (0, 0, pm_z), c, root, 0.8)
    tube("FMS.Hoop", float(D.FMS_DIA), float(D.FMS_H), pm_z, 0.04, c, nf,
         mat=M("Composite"))

    for i in range(int(D.FMS_ALIGN_DRIVES)):  # six actuators  [PUB]
        a = 2 * math.pi * i / int(D.FMS_ALIGN_DRIVES)
        cyl(f"FMS.AlignmentDrive.{i+1}", 0.09, 0.18, pm_z + float(D.FMS_H),
            c, nf, verts=16, mat=M("Structure_White"),
            xy=(float(D.SM_BASE_RADIUS) * math.cos(a),
                float(D.SM_BASE_RADIUS) * math.sin(a)))
    # heaters around the PM perimeter  [PUB]
    tube("FMS.PerimeterHeaters", float(D.FMS_DIA) * 0.985, 0.05, pm_z + 0.02,
         0.03, c, nf, mat=M("Structure_White"))

    # ---- Secondary Mirror Assembly + hexapod -----------------------------
    # Strut length is PUBLISHED at ~2.4 m. Solve the rise; do not guess it.
    c = COLLS["TEL.SecondaryMirrorAssembly"]
    sm_z = float(D.SM_Z)
    ns = empty("N.SecondaryMirrorAssembly", (0, 0, sm_z), c, root, 0.5, 'SPHERE')

    base_z = pm_z + float(D.FMS_H)
    br, tr = float(D.SM_BASE_RADIUS), float(D.SM_TOP_RADIUS)
    # skew must match the value the rise was SOLVED with in roman_dims,
    # or the struts come out the wrong length. v2 hardcoded 14 deg here
    # while solving radially -- gave 2.360 m against a published 2.400 m.
    skew = math.radians(float(D.SM_STRUT_SKEW_DEG))
    strut_top_z = base_z + float(D.SM_RISE)
    lengths = []
    for i in range(int(D.SM_STRUTS)):
        a_b = 2 * math.pi * i / int(D.SM_STRUTS)
        a_t = a_b + (skew if i % 2 == 0 else -skew)
        p0 = (br * math.cos(a_b), br * math.sin(a_b), base_z)
        p1 = (tr * math.cos(a_t), tr * math.sin(a_t), strut_top_z)
        lengths.append((Vector(p1) - Vector(p0)).length)
        strut(f"SMA.Strut.{i+1}", p0, p1, float(D.SM_STRUT_DIA), c, ns,
              M("Composite"))
        # stray-light scrapers bonded under the strut blankets  [PUB]
        mid = tuple((p0[k] + p1[k]) / 2 for k in range(3))
        box(f"SMA.Scraper.{i+1}", (0.05, 0.012, 0.9), mid, c, ns,
            M("Baffle_Black"), rot=(0, 0, a_b))

    print(f"[ota] hexapod strut lengths {min(lengths):.3f}-{max(lengths):.3f} m "
          f"(published ~{float(D.SM_STRUT_LEN):.2f} m)")

    conic_mirror("SMA.Mirror", float(D.SM_DIA), 1.60, -1.8, sm_z, c, ns,
                 M("Mirror"), flip=True)
    cyl("SMA.Housing", float(D.SM_DIA) * 1.25, 0.20, sm_z, c, ns,
        verts=48, mat=M("MLI_Silver"))
    for i in range(3):  # redundant fine-focus drives  [PUB]
        a = 2 * math.pi * i / 3
        cyl(f"SMA.FocusDrive.{i+1}", 0.05, 0.12, sm_z + 0.20, c, ns,
            verts=12, mat=M("Structure_White"),
            xy=(0.16 * math.cos(a), 0.16 * math.sin(a)))

    # ---- Aft Optics Module (WFI channel: FM1, FM2, tertiary) -------------
    c = COLLS["TEL.AftOpticsModule"]
    aom_z = ams_bot - float(D.AOM_Z_BELOW_AMS)
    na = empty("N.AftOpticsModule", (0, 0, aom_z), c, root, 0.4)
    box("AOM.Structure", tuple(D.AOM_BODY), (0, 0, aom_z), c, na, M("Composite"))
    # 3 bi-pod struts between AMS and Aft Optics Structure  [PUB]
    for i in range(int(D.AOM_BIPODS)):
        a = 2 * math.pi * i / int(D.AOM_BIPODS)
        apex = (0.30 * math.cos(a), 0.30 * math.sin(a),
                aom_z + float(D.AOM_BODY[2]) / 2)
        for s, lbl in ((+1, "A"), (-1, "B")):
            aa = a + s * 0.22
            strut(f"AOM.Bipod{i+1}{lbl}",
                  (0.75 * math.cos(aa), 0.75 * math.sin(aa), ams_bot),
                  apex, 0.035, c, na, M("Composite"))
    # mirrors sized from PUBLISHED beam footprints (mirror >= footprint)
    for nm, beam, off in (("FM1", float(D.AOM_FM1_BEAM), (0.22, 0.0)),
                          ("FM2", float(D.AOM_FM2_BEAM), (-0.10, 0.14)),
                          ("Tertiary", float(D.AOM_TM_BEAM), (0.0, -0.16))):
        cyl(f"AOM.{nm}", beam * 1.35, 0.012, aom_z + 0.05, c, na,
            verts=48, mat=M("Mirror"), xy=off,
            rot=(math.radians(45), 0, 0))
    for i in range(int(D.AOM_FM1_ACTUATORS)):  # FM1 has three actuators [PUB]
        a = 2 * math.pi * i / 3
        cyl(f"AOM.FM1_Actuator.{i+1}", 0.022, 0.07, aom_z, c, na, verts=10,
            mat=M("Structure_White"),
            xy=(0.22 + 0.03 * math.cos(a), 0.03 * math.sin(a)))

    # ---- Tertiary Collimator Assembly (CGI channel: POMA + TOMA) ---------
    c = COLLS["TEL.TertiaryCollimatorAssembly"]
    nt = empty("N.TertiaryCollimatorAssembly", (0, 0, ams_bot), c, root, 0.4)
    # POMA: flat OVAL mirror on the AMS folding the SM beam underneath  [PUB]
    poma = cyl("POMA.FoldFlat", float(D.POMA_MIRROR[0]), 0.012,
               ams_bot - 0.06, c, nt, verts=64, mat=M("Mirror"),
               xy=(0.0, 0.62), rot=(math.radians(38), 0, 0))
    poma.scale.y = float(D.POMA_MIRROR[1]) / float(D.POMA_MIRROR[0])  # oval
    toma_z = ams_bot - float(D.TOMA_Z_BELOW_AMS) - float(D.TOMA_BODY[2]) / 2
    box("TOMA.Structure", tuple(D.TOMA_BODY), (0.0, 0.72, toma_z), c, nt,
        M("Composite"))
    # 3 bi-pod STRUT PAIRS off the bottom of the AMS  [PUB]
    for i in range(int(D.TOMA_BIPOD_PAIRS)):
        a = 2 * math.pi * i / int(D.TOMA_BIPOD_PAIRS)
        apex = (0.72 * math.sin(a) * 0.4, 0.72 + 0.22 * math.cos(a),
                toma_z + float(D.TOMA_BODY[2]) / 2)
        for s, lbl in ((+1, "A"), (-1, "B")):
            strut(f"TOMA.Bipod{i+1}{lbl}",
                  (apex[0] + s * 0.16, apex[1] + s * 0.06, ams_bot),
                  apex, 0.03, c, nt, M("Composite"))
    for j, nm in enumerate(("M3", "M4", "M5")):  # three powered mirrors [PUB]
        cyl(f"TOMA.{nm}", 0.09, 0.010, toma_z + 0.10 - j * 0.08, c, nt,
            verts=32, mat=M("Mirror"),
            xy=(0.10 - j * 0.10, 0.72), rot=(math.radians(40), 0, 0))
    cyl("TOMA.TipTiltFlat", 0.07, 0.010, toma_z - 0.16, c, nt, verts=32,
        mat=M("Mirror"), xy=(-0.10, 0.72), rot=(math.radians(50), 0, 0))

    # ---- Interfaces: 6 FOA struts to the Instrument Carrier  [PUB] -------
    c = COLLS["TEL.Interfaces"]
    ni = empty("N.OTA_Interfaces", (0, 0, ams_bot), c, root, 0.4)
    ic_top = float(D.IC_Z0) + float(D.IC_H)
    for i in range(int(D.FOA_STRUTS)):
        a = 2 * math.pi * i / int(D.FOA_STRUTS)
        aa = a + (0.20 if i % 2 == 0 else -0.20)
        strut(f"FOA.Strut.{i+1}",
              (float(D.IC_DIA) * 0.42 * math.cos(aa),
               float(D.IC_DIA) * 0.42 * math.sin(aa), ic_top),
              (float(D.AMS_DIA) * 0.45 * math.cos(a),
               float(D.AMS_DIA) * 0.45 * math.sin(a), ams_bot),
              float(D.FOA_STRUT_DIA), c, ni, M("Composite"))
        for zz in (ic_top, ams_bot):  # bearings at each strut end  [PUB]
            cyl(f"FOA.Bearing.{i+1}.{'lo' if zz==ic_top else 'hi'}",
                0.07, 0.05, zz - 0.025, c, ni, verts=16,
                mat=M("Structure_White"),
                xy=(float(D.IC_DIA) * 0.42 * math.cos(aa),
                    float(D.IC_DIA) * 0.42 * math.sin(aa)))


# ===========================================================================
# SPACECRAFT + INSTRUMENTS
# ===========================================================================

def build_spacecraft(root):
    # ---- LVA -------------------------------------------------------------
    c = COLLS["OSS.LaunchVehicleAdapter"]
    n = empty("N.LaunchVehicleAdapter", (0, 0, float(D.LVA_Z0)), c, root)
    cone("LVA.Adapter", float(D.LVA_DIA_BOTTOM), float(D.LVA_DIA_TOP),
         float(D.LVA_H), float(D.LVA_Z0), c, n, mat=M("Composite"))

    # ---- Bus -------------------------------------------------------------
    c = COLLS["OSS.PrimaryStructure"]
    n = empty("N.Bus", (0, 0, float(D.BUS_Z0)), c, root)
    cyl("BUS.Hex", float(D.BUS_ACROSS_CORNERS), float(D.BUS_H),
        float(D.BUS_Z0), c, n, verts=6, mat=M("MLI_Silver"))
    box("BUS.Radiator", (2.4, 0.04, 1.5),
        (0, float(D.BUS_ACROSS_CORNERS) * 0.43,
         float(D.BUS_Z0) + float(D.BUS_H) / 2), c, n, M("Radiator"))
    # Telescope Control Electronics: 17 boards, on the spacecraft element [PUB]
    # TCE is a TELESCOPE subpart [S6] though physically mounted on the
    # spacecraft element [S3]. Filed under Telescope, built where it sits.
    tc = COLLS["TEL.TelescopeControlElectronics"]
    box("TCE.Chassis", (0.45, 0.30, 0.55),
        (0.9, -0.6, float(D.BUS_Z0) + 0.5), tc, n, M("Structure_White"))

    # ---- Comms -----------------------------------------------------------
    # A 1.7 m dish [S10] on a boom that swings down from the bottom of the
    # bus on the sun side, where Earth is seen from L2. The whole assembly
    # is one deployable about the boom's root hinge; placement is schematic.
    c = COLLS["COMMUNICATIONS"]
    bx = float(D.BUS_ACROSS_CORNERS) / 2
    root_pt = Vector((0.0, -bx * 0.8, float(D.HGA_ROOT_Z)))
    n = empty("N.Comms", tuple(root_pt), c, root)
    down = math.radians(float(D.HGA_BOOM_DOWN_DEG))
    L = float(D.HGA_BOOM_LEN)
    tip = root_pt + Vector((0.0, -L * math.cos(down), -L * math.sin(down)))
    hga = []
    hga.append(strut("HGA.Boom", tuple(root_pt), tuple(tip),
                     float(D.HGA_BOOM_DIA), c, n, M("Composite")))
    # Two-axis gimbal [S6] at the boom tip, then the dish facing the sun side.
    for k, lbl in enumerate(("Azimuth", "Elevation")):
        g = cyl(f"HGA.Gimbal{lbl}", float(D.HGA_GIMBAL_DIA), 0.08,
                tip.z - 0.04 + k * 0.09, c, n, verts=24,
                mat=M("Structure_White"), xy=(tip.x, tip.y - k * 0.06))
        hga.append(g)
    dish_c = tip + Vector((0.0, -0.18, -0.05))
    dish = paraboloid_dish("HGA.Dish", float(D.HGA_DISH_DIA),
                           float(D.HGA_DISH_DEPTH), tuple(dish_c), c, n,
                           M("HGA_Carbon"))
    dish.rotation_euler = (math.radians(90), 0, 0)   # aperture toward -Y
    hga.append(dish)
    f = float(D.HGA_DISH_DIA) ** 2 / (16 * float(D.HGA_DISH_DEPTH))
    feed = dish_c + Vector((0.0, -f, 0.0))
    for k in range(int(D.HGA_FEED_STRUTS)):
        a = math.pi / 4 + k * math.pi / 2
        rim = dish_c + Vector((float(D.HGA_DISH_DIA) / 2 * 0.92 * math.cos(a),
                               -float(D.HGA_DISH_DEPTH),
                               float(D.HGA_DISH_DIA) / 2 * 0.92 * math.sin(a)))
        hga.append(strut(f"HGA.FeedStrut.{k+1}", tuple(rim), tuple(feed), 0.025,
                         c, n, M("HGA_Carbon")))
    hga.append(cyl("HGA.Feed", 0.12, 0.14, feed.z - 0.07, c, n, verts=16,
                   mat=M("Structure_White"), xy=(feed.x, feed.y)))
    for o in hga:
        _deployable(o, tuple(root_pt), 'X', float(D.HGA_STOWED_DEG))
    for i, sx in enumerate((1, -1)):
        cone(f"LGA.{i+1}", float(D.LGA_DIA), float(D.LGA_DIA) * 0.65, 0.22,
             float(D.BUS_Z0) + 0.1, c, n, verts=24, mat=M("Structure_White"),
             xy=(sx * float(D.BUS_ACROSS_CORNERS) * 0.4, 0))

    # ---- Outer Barrel Assembly ("house on stilts") -----------------------
    c = COLLS["TEL.OuterBarrelAssembly"]
    n = empty("N.OuterBarrelAssembly", (0, 0, float(D.OBA_Z0)), c, root, 1.0)
    for i in range(int(D.STAND_LEGS)):
        a = 2 * math.pi * i / int(D.STAND_LEGS)
        r = float(D.OBA_DIA) / 2 - 0.15
        cyl(f"OBA.StandLeg.{i+1}", float(D.STAND_LEG_DIA), float(D.STAND_H),
            float(D.OBA_Z0), c, n, verts=16, mat=M("Composite"),
            xy=(r * math.cos(a), r * math.sin(a)))
    bz = float(D.OBA_Z0) + float(D.STAND_H)
    bh = float(D.OBA_H) - float(D.STAND_H)
    tube("OBA.Barrel", float(D.OBA_DIA), bh, bz, float(D.OBA_WALL), c, n,
         mat=M("MLI_Barrel"))
    # Annular vanes, not discs: a solid disc here would block the beam.
    for i in range(4):
        tube(f"OBA.Baffle.{i+1}", float(D.OBA_DIA) - 2 * float(D.OBA_WALL),
             0.02, bz + (i + 1) * bh / 5, float(D.OBA_VANE_W), c, n,
             mat=M("Baffle_Black"))

    # ---- Deployable Aperture Cover [S6] --------------------------------
    # NOT a rigid cone. NASA: "deployed once in orbit using a soft
    # material attached to support booms". Built as booms plus a thin
    # membrane skin; earlier passes solidified a cone shell.
    c = COLLS["TEL.DeployableApertureCover"]
    h = float(D.DAC_H_DEPLOYED if DEPLOYED else D.DAC_H_STOWED)
    n = empty("N.DeployableApertureCover", (0, 0, float(D.DAC_Z0)), c, root, 1.0)
    dac = cone("DAC.Membrane", float(D.DAC_DIA_BASE), float(D.DAC_DIA_TOP), h,
               float(D.DAC_Z0), c, n, verts=96, mat=M("Visor"),
               fill='NOTHING')           # a visor, open at the top
    _wall(dac, 0.004)                    # membrane, not structure
    for i in range(int(D.DAC_BOOMS)):
        a = 2 * math.pi * i / int(D.DAC_BOOMS)
        strut(f"DAC.SupportBoom.{i+1}",
              (float(D.DAC_DIA_BASE) / 2 * math.cos(a),
               float(D.DAC_DIA_BASE) / 2 * math.sin(a), float(D.DAC_Z0)),
              (float(D.DAC_DIA_TOP) / 2 * math.cos(a),
               float(D.DAC_DIA_TOP) / 2 * math.sin(a), float(D.DAC_Z0) + h),
              float(D.DAC_BOOM_DIA), c, n, M("Composite"))

    # ---- Solar Array Sun Shield: SIX panels [S6][S7] --------------------
    # Two centre panels fixed flat to the OBA; four outer panels hinged,
    # folded down against the OBA for launch, swinging up in orbit to
    # align with the centre pair. Earlier passes built two splayed wings,
    # which is the wrong count, topology and deployment behaviour.
    # Laid out as the integration photos show it [S9]: three columns by two
    # rows. The centre column's pair is fixed; each outer column is hinged at
    # the centre column's edge and folds back toward the barrel for launch,
    # as deep as it can go before touching it (SASS_FOLD_DEG, solved).
    c = COLLS["SOLAR_ARRAY_SUN_SHIELD"]
    n = empty("N.SolarArraySunShield", (0, 0, float(D.SASS_Z0)), c, root, 1.0)
    obar = float(D.OBA_DIA) / 2
    cw = float(D.SASS_COL_W)
    ph = float(D.SASS_H)
    rh = ph / int(D.SASS_ROWS)
    t = float(D.SASS_PANEL_T)
    gap = 0.03
    plane_y = -(obar + float(D.SASS_STANDOFF))
    fold = float(D.SASS_FOLD_DEG)

    for j in range(int(D.SASS_ROWS)):
        zc = float(D.SASS_Z0) + j * rh + rh / 2
        box(f"SASS.Centre.{j+1}", (cw - gap, t, rh - gap), (0, plane_y, zc),
            c, n, M("SolarArray"))
        # Standoff struts from the centre panels back to the barrel.
        for sx in (-1, 1):
            strut(f"SASS.Standoff.{j+1}{'A' if sx < 0 else 'B'}",
                  (sx * cw * 0.3, plane_y + t / 2, zc),
                  (sx * cw * 0.3, -math.sqrt(max(obar ** 2 - (cw * 0.3) ** 2, 0)), zc),
                  0.05, c, n, M("Composite"))
        for sx in (1, -1):
            hinge_x = sx * cw / 2
            ang = sx * math.radians(fold) if SASS_STOWED else 0.0
            panel = box(f"SASS.Outer.{'PX' if sx > 0 else 'NX'}.{j+1}",
                        (cw - gap, t, rh - gap),
                        # gap on the hinge side: the outer edge lands
                        # exactly on the published width
                        (hinge_x + sx * (cw + gap) / 2, plane_y, zc),
                        c, n, M("SolarArray"), rot=(0, 0, ang))
            _deployable(panel, (hinge_x, plane_y, zc), 'Z', sx * fold)
            cyl(f"SASS.Hinge.{'PX' if sx > 0 else 'NX'}.{j+1}",
                0.05, rh * 0.9, zc - rh * 0.45, c, n,
                verts=12, mat=M("Structure_White"), xy=(hinge_x, plane_y))

    # ---- Lower Instrument Sun Shade [S6][S8] ---------------------------
    # Two deployable panels on the bus. Missing from every previous pass.
    c = COLLS["OSS.LowerInstrumentSunShade"]
    n = empty("N.LowerInstrumentSunShade", (0, 0, float(D.LISS_Z0)), c, root, 0.6)
    lw, lh, lt = float(D.LISS_PANEL_W), float(D.LISS_PANEL_H), float(D.LISS_PANEL_T)
    # Two 2.10 m panels only fit inside the published 4.40 m width if they
    # SPAN it side by side (2 x 2.10 = 4.20 m) rather than hanging off the
    # bus flanks. Hanging them off the flanks put the observatory at
    # 5.55 m wide -- caught by test_harness.py. They therefore tilt about
    # X, away from the sun side, not about Z.
    a = math.radians(float(D.LISS_OPEN_DEG))
    hinge_y = -(float(D.BUS_ACROSS_CORNERS) / 2 + float(D.LISS_HINGE_GAP))
    for i, sx in enumerate((1, -1)):
        liss = box(f"LISS.Panel.{i+1}", (lw, lt, lh),
                   (sx * lw / 2, hinge_y - lh / 2 * math.sin(a),
                    float(D.LISS_Z0) + lh / 2 * math.cos(a)),
                   c, n, M("MLI_Silver"), rot=(a, 0, 0))
        # Stowed = standing flat against the bus, i.e. the deploy angle undone.
        _deployable(liss, (sx * lw / 2, hinge_y, float(D.LISS_Z0)), 'X',
                    -float(D.LISS_OPEN_DEG))
        cyl(f"LISS.Hinge.{i+1}", 0.07, lw * 0.92, float(D.LISS_Z0), c, n,
            verts=12, mat=M("Composite"), rot=(0, math.radians(90), 0),
            xy=(sx * lw / 2,
                -(float(D.BUS_ACROSS_CORNERS) / 2 + float(D.LISS_HINGE_GAP))))


def build_instruments(root):
    c = COLLS["INSTRUMENT_CARRIER"]
    n = empty("N.InstrumentCarrier", (0, 0, float(D.IC_Z0)), c, root)
    cyl("IC.Deck", float(D.IC_DIA), float(D.IC_H), float(D.IC_Z0), c, n,
        verts=48, mat=M("Composite"))

    c = COLLS["WIDE_FIELD_INSTRUMENT"]
    n = empty("N.WideFieldInstrument",
              (*D.WFI_OFFSET, float(D.WFI_Z0)), c, root, 0.4)
    box("WFI.Body", tuple(D.WFI_SIZE),
        (D.WFI_OFFSET[0], D.WFI_OFFSET[1],
         float(D.WFI_Z0) + D.WFI_SIZE[2] / 2), c, n, M("MLI_Silver"))
    # 300 MP focal plane: 18 H4RG detectors  [PUB]
    # 6 x 3 mosaic. The real focal plane bows its columns into a shallow
    # arc; reproduced here approximately (offsets and tilt are EST).
    for i in range(int(D.WFI_DETECTORS)):
        col, row = i % 6, i // 6
        u = col - 2.5
        box(f"WFI.H4RG.{i+1}", (0.11, 0.11, 0.012),
            (D.WFI_OFFSET[0] + u * 0.13,
             D.WFI_OFFSET[1] + (row - 1) * 0.13 + 0.010 * u * u,
             float(D.WFI_Z0) + 0.03), c, n, M("Detector"),
            rot=(0, 0, math.radians(-2.2 * u)))
    # Element wheel [S12]: a disc ahead of the detectors whose rim carries
    # the filters, grism and prism; it turns one slot into the beam. The
    # active slot sits over the mosaic's centre.
    slot_r = float(D.WFI_WHEEL_DIA) / 2 * 0.72
    wz = float(D.WFI_Z0) + float(D.WFI_WHEEL_Z)
    wc = (D.WFI_OFFSET[0], D.WFI_OFFSET[1] + slot_r)
    cyl("WFI.ElementWheel", float(D.WFI_WHEEL_DIA), 0.018, wz, c, n, verts=64,
        mat=M("Structure_White"), xy=wc)
    for k in range(int(D.WFI_ELEMENTS)):
        a = -math.pi / 2 + 2 * math.pi * k / int(D.WFI_ELEMENTS)
        cyl(f"WFI.Element.{k+1}", 0.085, 0.024, wz - 0.003, c, n, verts=24,
            mat=M("Filter"),
            xy=(wc[0] + slot_r * math.cos(a), wc[1] + slot_r * math.sin(a)))

    c = COLLS["CORONAGRAPH_INSTRUMENT"]
    n = empty("N.CoronagraphInstrument",
              (*D.CGI_OFFSET, float(D.CGI_Z0)), c, root, 0.4)
    box("CGI.Body", tuple(D.CGI_SIZE),
        (D.CGI_OFFSET[0], D.CGI_OFFSET[1],
         float(D.CGI_Z0) + D.CGI_SIZE[2] / 2), c, n, M("MLI_Silver"))


# ===========================================================================
# REFERENCE + SCENE
# ===========================================================================

def build_reference():
    c = COLLS["_REFERENCE"]
    env = box("REF.Envelope_12.7x4.4",
              (float(D.TOTAL_WIDTH), float(D.TOTAL_WIDTH), float(D.TOTAL_LENGTH)),
              (0, 0, float(D.TOTAL_LENGTH) / 2), c)
    env.display_type, env.hide_render = 'WIRE', True
    h = cyl("REF.Human_1.8m", 0.44, 1.8, 0.0, c, verts=12, xy=(3.6, 0))
    h.display_type, h.hide_render = 'WIRE', True
    empty("REF.Z_TotalLength", (0, 0, float(D.TOTAL_LENGTH)), c,
          size=0.6, kind='SINGLE_ARROW')


def build_scene():
    c = COLLS["_SCENE"]
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        sc.cycles.samples = 256
        sc.cycles.use_denoising = True
    except AttributeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 2048, 2048
    sc.render.film_transparent = True
    if sc.world:
        sc.world.use_nodes = True
        bg = sc.world.node_tree.nodes.get("Background")
        if bg:
            bg.inputs["Color"].default_value = (0.004, 0.005, 0.008, 1)
            bg.inputs["Strength"].default_value = 1.0

    cam_data = bpy.data.cameras.new("Cam.ThreeQuarter")
    cam_data.lens = 85
    cam_data.clip_start, cam_data.clip_end = 0.1, 500
    cam = bpy.data.objects.new("Cam.ThreeQuarter", cam_data)
    c.objects.link(cam)
    cam.location = (16.0, -20.0, 11.0)
    target = Vector((0, 0, float(D.TOTAL_LENGTH) * 0.45))
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (cam.location - target).to_track_quat('Z', 'Y')
    sc.camera = cam

    # single hard sun from -Y: this is what L2 actually looks like
    sun_d = bpy.data.lights.new("Sun.L2", type='SUN')
    sun_d.energy, sun_d.angle = 4.0, math.radians(0.53)
    sun = bpy.data.objects.new("Sun.L2", sun_d)
    c.objects.link(sun)
    sun.rotation_euler = (math.radians(72), 0, math.radians(18))

    fill_d = bpy.data.lights.new("Fill.Earthshine", type='AREA')
    fill_d.energy, fill_d.size = 60.0, 12.0
    fill_d.color = (0.55, 0.68, 0.9)
    fill = bpy.data.objects.new("Fill.Earthshine", fill_d)
    c.objects.link(fill)
    fill.location = (-14, 10, 4)
    fill.rotation_quaternion = (fill.location - target).to_track_quat('Z', 'Y')
    fill.rotation_mode = 'QUATERNION'


# ===========================================================================
# QC  --  measures BUILT GEOMETRY, not constants
# ===========================================================================

def _evaluated_bbox(objs):
    """World-space bbox through the depsgraph, so modifiers count."""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    found = False
    for o in objs:
        if o.type != 'MESH' or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        if not me.vertices:
            ev.to_mesh_clear()
            continue
        found = True
        mw = ev.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    return (lo, hi) if found else (None, None)


def _collect(coll_name):
    c = bpy.data.collections.get(coll_name)
    if not c:
        return []
    out = list(c.objects)
    for ch in c.children_recursive:
        out.extend(ch.objects)
    return out


# Published anchors, hardcoded as LITERALS on purpose.
#
# QC must not read these from roman_dims. If the oracle and the thing
# under test share a source, changing a dimension moves both sides and
# the check cannot fail -- which is exactly the bug v1 shipped, and
# exactly what v3's first regression run reproduced. These literals are
# the independent ground truth; roman_dims is the hypothesis.
PUBLISHED_ANCHORS = {
    "total_length_m":   (12.70, "[S1] NASA Roman FAQ, deployed"),
    "total_width_m":    (4.40,  "[S1] NASA Roman FAQ, deployed"),
    "primary_mirror_m": (2.40,  "[S1][S5] inherited, re-figured"),
    "oba_height_m":     (5.00,  "[S2] ~17 ft"),
    "oba_width_m":      (4.00,  "[S2] ~13.5 ft"),
    "sm_strut_len_m":   (2.40,  "[S3] SPIE 12180-60"),
}

PUBLISHED_COUNTS = {
    "SMA.Strut.":           (6,  "[S3] SMA mounts at the top of six struts"),
    "FMS.AlignmentDrive.":  (6,  "[S3] six actuators in hexapod"),
    "PM.Bipod":             (6,  "[S3] 3 bi-pods = 6 legs"),
    "FOA.Strut.":           (6,  "[S3] six Forward Optical Assembly struts"),
    "WFI.H4RG.":            (18, "[S5] 18 H4RG detectors, 300 MP"),
    "AOM.Bipod":            (6,  "[S3] 3 bi-pods between AMS and AOS"),
    "TOMA.Bipod":           (6,  "[S3] 3 bi-pod strut pairs"),
    "SASS.Centre.":         (2,  "[S7] two centre panels fixed to the OBA"),
    "WFI.Element.":         (11, "[S12] 11-position element wheel"),
    "SASS.Outer.":          (4,  "[S7] four hinged outer panels"),
    "LISS.Panel.":          (2,  "[S6] two deployable panels on the bus"),
    "DAC.SupportBoom.":     (3,  "[S6] soft material on support booms"),
    "HGA.Gimbal":           (2,  "[S6] gimballed, two-axis pointing"),
}


def qc():
    """Measure the BUILT MESHES and compare against published literals.

    Two independent failure modes are covered:
      * build bugs  -- geometry does not match the dimension it was given
      * dimension bugs -- the dimension itself disagrees with NASA
    v2's audit could catch neither.
    """
    print("\n" + "=" * 72)
    print("  QC  --  built geometry vs. independently-held published values")
    print("=" * 72)
    bpy.context.view_layer.update()
    fails = 0

    def check(label, got, key):
        nonlocal fails
        want, src = PUBLISHED_ANCHORS[key]
        ok = abs(got - want) <= QC_TOLERANCE
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {label:<34} "
              f"{got:>7.3f}  want {want:>7.3f}   {src}")

    lo, hi = _evaluated_bbox(_collect("OBSERVATORY"))
    if lo is None:
        print("  !! no renderable geometry"); return False
    d = hi - lo
    check("observatory length (Z)", d.z, "total_length_m")
    # Across the sun shield (X): see roman_dims.TOTAL_WIDTH.
    check("observatory width (X)", d.x, "total_width_m")

    ok = abs(lo.z) <= QC_TOLERANCE
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {'base seated at Z=0':<34} "
          f"{lo.z:>7.3f}  want {0.0:>7.3f}   datum")

    pm = bpy.data.objects.get("PM.Surface")
    if pm:
        l, h = _evaluated_bbox([pm])
        check("primary mirror diameter", max((h - l).x, (h - l).y),
              "primary_mirror_m")

    ob = bpy.data.objects.get("OBA.Barrel")
    if ob:
        l, h = _evaluated_bbox([ob])
        check("OBA outer dia (post-solidify)", max((h - l).x, (h - l).y),
              "oba_width_m")

    oba = _collect("TEL.OuterBarrelAssembly")
    if oba:
        l, h = _evaluated_bbox(oba)
        check("OBA total height", (h - l).z, "oba_height_m")

    struts = [o for o in bpy.data.objects if o.name.startswith("SMA.Strut.")]
    if struts:
        lens = []
        # Along the strut's own axis (local Z). The world-bbox diagonal of
        # a tilted cylinder includes its thickness and read 2.448 m for
        # struts built at exactly 2.400 m.
        dg = bpy.context.evaluated_depsgraph_get()
        for o in struts:
            ev = o.evaluated_get(dg)
            zs = [v.co.z for v in ev.to_mesh().vertices]
            ev.to_mesh_clear()
            lens.append((max(zs) - min(zs)) * abs(o.scale.z))
        check("SM hexapod strut length (mean)", sum(lens) / len(lens),
              "sm_strut_len_m")

    print("-" * 72)
    for prefix, (want, src) in PUBLISHED_COUNTS.items():
        got = len([o for o in bpy.data.objects if o.name.startswith(prefix)])
        ok = got == want
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {prefix + ' count':<34} "
              f"{got:>7d}  want {want:>7d}   {src}")

    print("-" * 72)
    mesh_n = len([o for o in bpy.data.objects if o.type == 'MESH'])
    print(f"  {mesh_n} meshes, {len(bpy.data.collections)} collections, "
          f"{fails} check(s) failed")
    print("=" * 72)
    D.audit_provenance()
    return fails == 0


# ===========================================================================

def main():
    if WIPE_SCENE:
        wipe()
    COLLS.clear()
    MATS.clear()
    if USE_MEASURED:
        D.apply_measured()
    D.check_budget()
    set_units()
    build_hierarchy()
    build_materials()
    root = empty("ROOT.Observatory", (0, 0, 0), COLLS["OBSERVATORY"],
                 size=1.5, kind='ARROWS')
    build_spacecraft(root)
    build_instruments(root)
    if BUILD_OTA:
        build_ota(root)
    build_reference()
    if BUILD_SCENE:
        build_scene()
    if RUN_QC:
        qc()


if __name__ == "__main__":
    main()
