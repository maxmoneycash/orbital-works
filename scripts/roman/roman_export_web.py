"""
roman_export_web.py
Export the built Roman scene to a web-ready .glb for three.js / r3f.

    run roman_build.py first, then this, in the same Blender session.

WHAT IT FIXES BEFORE EXPORTING
------------------------------
1. Applies modifiers. The OBA barrel and DAC get their walls from
   SOLIDIFY. Exported without applying, they are zero-thickness tubes
   that look right from outside and hollow-wrong from any other angle.
2. Solidifies the conic mirrors. PM.Surface and SMA.Mirror are open
   single-sided surfaces -- three.js backface-culls them and the primary
   disappears when you orbit behind it. Given real thickness here so you
   do not have to reach for DoubleSide (which doubles overdraw).
3. Merges by (subsystem, material). Straight per-object export is 129
   draw calls. Merging everything into one mesh would be ~9 but kills
   per-component picking. Grouping by subsystem keeps the inspector
   working and still cuts draw calls by ~4x.
4. Moves the DAC origin to its base so the deploy animation is a single
   scale on one node, instead of a transform puzzle.
5. Drops _REFERENCE and _SCENE. Otherwise you ship a wireframe envelope
   cage and a 1.8 m human reference dummy to production.

NOT FIXED HERE
   The anisotropic sheen on the gold MLI. Core glTF PBR has no anisotropy
   and the KHR_materials_anisotropy extension round-trip is unreliable.
   RomanViewer.jsx re-authors that one material on the three.js side.

COORDINATE NOTE
   glTF is Y-up. Blender's exporter converts, so in three.js the
   observatory's long axis is +Y, NOT +Z. Orbit target is [0, 6.35, 0].
"""

import bpy
import os
import json

OUT_DIR = os.path.expanduser(os.environ.get("ROMAN_OUT_DIR", "~/Desktop"))
OUT_NAME = "roman.glb"
MERGE = os.environ.get("ROMAN_MERGE", "1") != "0"   # the explorer needs parts unmerged
MIRROR_THICKNESS = 0.05
DRACO = False          # smaller file, needs a decoder in your bundle

EXCLUDE = {"_REFERENCE", "_SCENE"}

# Matches NASA's five-part taxonomy [S6], not the old Spacecraft/IPA split.
SUBSYSTEMS = [
    "TEL.PrimaryMirrorAssembly", "TEL.SecondaryMirrorAssembly",
    "TEL.AftOpticsModule", "TEL.TertiaryCollimatorAssembly",
    "TEL.TelescopeControlElectronics", "TEL.DeployableApertureCover",
    "TEL.OuterBarrelAssembly", "TEL.ForwardStructureAssembly",
    "TEL.Interfaces",
    "OSS.PrimaryStructure", "OSS.LowerInstrumentSunShade",
    "OSS.LaunchVehicleAdapter",
    "SOLAR_ARRAY_SUN_SHIELD", "COMMUNICATIONS",
    "WIDE_FIELD_INSTRUMENT", "CORONAGRAPH_INSTRUMENT", "INSTRUMENT_CARRIER",
]


def _deselect():
    for o in bpy.data.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = None


def _members(coll_name):
    c = bpy.data.collections.get(coll_name)
    return [o for o in c.objects if o.type == 'MESH'] if c else []


def thicken_mirrors():
    """Open surfaces vanish under backface culling. Give them a back."""
    n = 0
    for name in ("PM.Surface", "SMA.Mirror"):
        o = bpy.data.objects.get(name)
        if not o or o.type != 'MESH':
            continue
        if any(m.type == 'SOLIDIFY' for m in o.modifiers):
            continue
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_add(type='SOLIDIFY')
        o.modifiers[-1].thickness = MIRROR_THICKNESS
        o.modifiers[-1].offset = -1.0    # thicken away from the optical face
        n += 1
    print(f"[export] thickened {n} mirror surface(s)")


def apply_all_modifiers():
    n = 0
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or not o.modifiers:
            continue
        if any(c.name in EXCLUDE for c in o.users_collection):
            continue
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=m.name)
                n += 1
            except RuntimeError as e:
                print(f"[export] could not apply {m.name} on {o.name}: {e}")
    print(f"[export] applied {n} modifier(s)")


def set_dac_origin_to_base():
    """Deploy animation = one scale on one node. Origin must be the base."""
    objs = _members("TEL.DeployableApertureCover")
    if not objs:
        return
    lo = min(min((o.matrix_world @ v.co).z for v in o.data.vertices)
             for o in objs)
    _deselect()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    cur = bpy.context.scene.cursor.location.copy()
    bpy.context.scene.cursor.location = (0.0, 0.0, lo)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.context.scene.cursor.location = cur
    print(f"[export] DAC origin moved to base at Z={lo:.3f}")


def merge_by_subsystem_and_material():
    """One mesh per (subsystem, material). Keeps picking, cuts draw calls."""
    before = len([o for o in bpy.data.objects if o.type == 'MESH'])
    made = 0
    for sub in SUBSYSTEMS:
        objs = _members(sub)
        if len(objs) < 2:
            continue
        groups = {}
        for o in objs:
            key = o.data.materials[0].name if o.data.materials else "_none"
            groups.setdefault(key, []).append(o)
        for mat, members in groups.items():
            if len(members) < 2:
                made += 1
                continue
            _deselect()
            for o in members:
                o.select_set(True)
            bpy.context.view_layer.objects.active = members[0]
            bpy.ops.object.join()
            joined = bpy.context.view_layer.objects.active
            joined.name = f"{sub}__{mat}"
            made += 1
    after = len([o for o in bpy.data.objects if o.type == 'MESH'])
    print(f"[export] merged {before} meshes -> {after} "
          f"({made} subsystem/material groups)")
    return after


def set_deploy_origins():
    """Put each deployable's origin on its hinge line.

    roman_build.py tags the parts that fold for launch (SASS outer panels,
    LISS panels) with deploy_pivot / deploy_axis / stowed_deg. With the
    origin on the pivot, stowing is one rotation of one node about one
    axis in the viewer, and the extras ride along to say which.
    """
    cur = bpy.context.scene.cursor.location.copy()
    n = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or "deploy_pivot" not in o.keys():
            continue
        _deselect()
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.context.scene.cursor.location = tuple(o["deploy_pivot"])
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        n += 1
    bpy.context.scene.cursor.location = cur
    print(f"[export] moved {n} deployable origin(s) onto their hinges")


def tag_subsystems():
    """Stamp each mesh with its subsystem as a glTF extra.

    Single-member groups keep their Blender name (HGA.Dish, not
    COMMUNICATIONS__MLI_Silver), so the viewer cannot recover the
    subsystem from names alone. The extra survives the join below
    because every member of a group carries the same value.
    """
    n = 0
    for sub in SUBSYSTEMS:
        for o in _members(sub):
            o["subsystem"] = sub
            o["part"] = o.name          # glTF loaders sanitise node names
            n += 1
    print(f"[export] tagged {n} mesh(es) with their subsystem")


def strip_excluded():
    for name in EXCLUDE:
        c = bpy.data.collections.get(name)
        if not c:
            continue
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
    print(f"[export] removed {', '.join(sorted(EXCLUDE))}")


def write_manifest(path, mesh_count):
    """Names the viewer can rely on, so the JSX has no magic strings."""
    manifest = {
        "up_axis": "Y",
        "orbit_target": [0.0, 6.35, 0.0],
        "total_length_m": 12.70,
        "total_width_m": 4.40,
        "dac_node_prefix": "TEL.DeployableApertureCover",
        "dac_stowed_scale": round(0.45 / 4.90, 4),
        "mesh_count": mesh_count,
        "subsystems": [s for s in SUBSYSTEMS if _members(s) or True],
        "materials": sorted(m.name for m in bpy.data.materials),
    }
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[export] wrote manifest -> {path}")


def main():
    if not bpy.data.collections.get("OBSERVATORY"):
        raise RuntimeError("No OBSERVATORY collection. Run roman_build.py first.")

    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')

    thicken_mirrors()
    apply_all_modifiers()
    set_dac_origin_to_base()
    set_deploy_origins()
    strip_excluded()
    tag_subsystems()
    n = merge_by_subsystem_and_material() if MERGE else \
        len([o for o in bpy.data.objects if o.type == 'MESH'])

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, OUT_NAME)

    _deselect()
    for o in bpy.data.objects:
        if o.type in {'MESH', 'EMPTY'}:
            o.select_set(True)

    kw = dict(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_apply=True,          # belt and braces
        export_yup=True,            # long axis becomes +Y in three.js
        export_cameras=False,
        export_lights=False,
        export_materials='EXPORT',
        export_texcoords=True,
        export_normals=True,
        export_extras=True,         # carries the subsystem tag
    )
    if DRACO:
        kw["export_draco_mesh_compression_enable"] = True
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        # older/newer exporters rename args; retry with the stable subset
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB',
                                  use_selection=True, export_apply=True)

    write_manifest(os.path.join(OUT_DIR, "roman.manifest.json"), n)
    size = os.path.getsize(out) / 1e6
    print(f"\n[export] {out}  ({size:.2f} MB, {n} meshes)")
    print("[export] copy roman.glb into your app's /public folder")


if __name__ == "__main__":
    main()
