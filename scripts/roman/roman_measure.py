"""
roman_measure.py  --  v2
Import NASA's Roman .glb, normalise it to the published 12.70 m, measure
the components I would otherwise be guessing, and write those numbers to
roman_dims_measured.json for roman_dims.apply_measured() to consume.

    Blender > Scripting > Open > roman_measure.py > set GLB_PATH > Run
    then re-run roman_build.py (USE_MEASURED = True)

WHY THIS EXISTS
    v1 hardcoded ~30 eyeballed dimensions and labelled them EST. Labelling
    a guess honestly is not the same as not guessing. NASA's own asset,
    once scaled against the published length, is a strictly better source
    than my eye -- so measure it instead.

WHAT THIS IS NOT
    The .glb is a visualisation asset (~2.55 MB for a whole observatory),
    not engineering CAD. Measurements off it inherit its simplifications.
    They land in the store tagged MEAS, which ranks below PUB and DER,
    and roman_dims REFUSES to let them overwrite a published number.

Get the file:
    https://science.nasa.gov/3d-resources/nancy-grace-roman-space-telescope-a/
"""

import bpy
import json
import math
import os
import sys
from mathutils import Vector

GLB_PATH = "/absolute/path/to/Nancy Grace Roman Space Telescope (A).glb"
TARGET_LENGTH = 12.70          # [PUB]
OUT_JSON = "roman_dims_measured.json"
SPLIT_LOOSE_PARTS = True
AS_WIREFRAME_REFERENCE = True
LOCK_TRANSFORMS = True

# Components to measure, as fractions of the normalised stack height.
# Each entry: dim_name -> (z_lo_frac, z_hi_frac, what, how)
#   how = "width"  -> max XY extent of geometry in that Z band
#         "height" -> Z extent of the contiguous geometry in that band
SLICES = {
    "BUS_ACROSS_CORNERS": (0.05, 0.24, "spacecraft bus", "width"),
    "BUS_H":              (0.05, 0.24, "spacecraft bus", "height"),
    "LVA_H":              (0.00, 0.07, "launch vehicle adapter", "height"),
    "IC_DIA":             (0.20, 0.30, "instrument carrier", "width"),
    "DAC_DIA_TOP":        (0.96, 1.00, "aperture cover rim", "width"),
    "SASS_H":             (0.20, 0.62, "solar array wing", "height"),
}


def world_bbox(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    found = False
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            found = True
            for i in range(3):
                lo[i], hi[i] = min(lo[i], w[i]), max(hi[i], w[i])
    return (lo, hi) if found else (None, None)


def verts_world(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            yield mw @ v.co
        ev.to_mesh_clear()


def main():
    if not os.path.exists(GLB_PATH):
        raise FileNotFoundError(
            f"GLB_PATH does not exist:\n  {GLB_PATH}\n"
            "Download it from NASA 3D Resources and set GLB_PATH.")

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        raise RuntimeError("No mesh imported -- check the file.")
    print(f"[measure] imported {len(imported)} objects, {len(meshes)} meshes")

    name = "NASA_IMPORT"
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if name not in {x.name for x in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(c)
    for o in imported:
        for old in list(o.users_collection):
            old.objects.unlink(o)
        c.objects.link(o)

    pivot = bpy.data.objects.new("NASA_IMPORT.Pivot", None)
    pivot.empty_display_type, pivot.empty_display_size = 'ARROWS', 1.5
    c.objects.link(pivot)
    for o in imported:
        if o.parent is None:
            o.parent = pivot
    bpy.context.view_layer.update()

    # --- normalise against the published length --------------------------
    lo, hi = world_bbox(meshes)
    dims = hi - lo
    axis = max(range(3), key=lambda i: dims[i])
    print(f"[measure] raw bbox {dims.x:.3f} x {dims.y:.3f} x {dims.z:.3f} "
          f"(long axis {'XYZ'[axis]})")
    factor = TARGET_LENGTH / dims[axis]
    pivot.scale = (factor,) * 3
    if axis == 1:
        pivot.rotation_euler = (math.radians(90), 0, 0)
    elif axis == 0:
        pivot.rotation_euler = (0, math.radians(90), 0)
    bpy.context.view_layer.update()

    lo, hi = world_bbox(meshes)
    pivot.location.z -= lo.z
    pivot.location.x -= (lo.x + hi.x) / 2
    pivot.location.y -= (lo.y + hi.y) / 2
    bpy.context.view_layer.update()

    lo, hi = world_bbox(meshes)
    d = hi - lo
    print(f"[measure] normalised bbox {d.x:.3f} x {d.y:.3f} x {d.z:.3f} m "
          f"(scale factor {factor:.6f})")
    if abs(d.z - TARGET_LENGTH) > 0.05:
        print("[measure] WARNING: normalisation did not land on target; "
              "the long axis may not be the boresight.")

    # --- measure Z slices -------------------------------------------------
    pts = list(verts_world(meshes))
    z0, z1 = lo.z, hi.z
    span = z1 - z0
    out = {}
    print(f"\n[measure] {len(pts)} vertices; slicing the normalised stack")
    for dim, (f0, f1, what, how) in SLICES.items():
        band = [p for p in pts if z0 + f0 * span <= p.z <= z0 + f1 * span]
        if len(band) < 12:
            print(f"    skip {dim:<20} only {len(band)} verts in band")
            continue
        if how == "width":
            val = 2 * max(math.hypot(p.x, p.y) for p in band)
        else:
            val = max(p.z for p in band) - min(p.z for p in band)
        out[dim] = round(val, 4)
        print(f"    {dim:<20} {val:8.3f} m   ({what}, {len(band)} verts)")

    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() \
        else os.path.dirname(bpy.data.filepath) or os.getcwd()
    path = os.path.join(here, OUT_JSON)
    with open(path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print(f"\n[measure] wrote {len(out)} overrides -> {path}")
    print("[measure] these are tagged MEAS and CANNOT overwrite a PUB value.")

    # --- split + lock as reference ---------------------------------------
    if SPLIT_LOOSE_PARTS and meshes:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        bpy.context.object.name = "NASA_IMPORT.Body"
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        print(f"[measure] split into "
              f"{len([o for o in c.objects if o.type=='MESH'])} loose parts")

    for o in c.objects:
        if o.type != 'MESH':
            continue
        if AS_WIREFRAME_REFERENCE:
            o.display_type, o.hide_render = 'WIRE', True
        if LOCK_TRANSFORMS:
            o.lock_location = o.lock_rotation = o.lock_scale = (True,) * 3

    print("\n[measure] next: re-run roman_build.py with USE_MEASURED = True")


if __name__ == "__main__":
    main()
