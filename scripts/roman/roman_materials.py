"""
roman_materials.py
Realism pass. Upgrades the scene roman_build.py already made -- it does
not rebuild geometry, so run it after roman_build.py in the same session.

    Blender > Scripting > Open > roman_materials.py > Run

WHAT IT ADDRESSES, IN ORDER OF PAYOFF
-------------------------------------
1. Nothing to reflect. Every metal in the scene is metalness 1.0, and
   metal renders as WHAT IT REFLECTS. Against a near-black world it
   reflects nothing and reads as flat grey plastic. Fixed two ways: a
   procedural space world (stars + a faint planet-side gradient) so
   reflections are not pure black, and four large dim area lights acting
   as reflection cards. The cards matter more than the world.
2. Zero-radius edges. Raw primitives have perfectly sharp edges, which
   nothing physical has, and the eye reads as CG immediately. A 2 mm
   angle-limited bevel across the model, with hardened normals.
3. Smooth-by-angle. 96-vertex cylinders show their flats on the
   silhouette without it. 30 deg leaves box edges properly sharp.
4. Smooth MLI. This is what actually sells a spacecraft render and what
   the previous pass got most wrong -- real thermal blanketing is
   crinkled, quilted, seamed and mottled. Procedural shader below:
   two octaves of crinkle bump, quilting seams, roughness break-up, and
   colour variation across the sheet.
5. Uniform surfaces. Composite gets a weave and roughness variation;
   the solar array gets a real cell grid with busbar mortar.

VERSION HANDLING
    Principled BSDF socket names changed in Blender 4.0 ("Specular" ->
    "Specular IOR Level", "Clearcoat" -> "Coat Weight", and so on), and
    auto-smooth moved from a mesh flag to an operator in 4.1. Both are
    handled by name-candidate lookup rather than assuming a version.

HONEST LIMIT
    The node graphs here are the least tested thing in this project. The
    harness can check that every link references a socket that exists on
    the node type it is wired to, which catches typos, but it cannot
    tell you whether the result looks right. Render and look.
"""

import bpy
import math

# ---------------------------------------------------------------------------
BEVEL_WIDTH = 0.002        # 2 mm
BEVEL_SEGMENTS = 2
SMOOTH_ANGLE = math.radians(30)
ADD_REFLECTION_CARDS = True
BUILD_WORLD = True
UPGRADE_SHADERS = True
CYCLES_SAMPLES = 512
SKIP_COLLECTIONS = {"_REFERENCE", "_SCENE", "NASA_IMPORT"}
# ---------------------------------------------------------------------------


def _skip(o):
    return any(c.name in SKIP_COLLECTIONS for c in o.users_collection)


def _set(node, candidates, value):
    """Set the first socket name that exists. Absorbs the 4.0 renames."""
    for n in candidates:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


# ===========================================================================
# 1. ENVIRONMENT
# ===========================================================================

def build_world():
    """Procedural space. No HDRI file to ship, and more correct for L2
    than a studio HDRI would be."""
    w = bpy.data.worlds.get("RomanSpace") or bpy.data.worlds.new("RomanSpace")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    n, L = nt.nodes, nt.links

    out = n.new("ShaderNodeOutputWorld")
    bg = n.new("ShaderNodeBackground")
    L.new(bg.outputs["Background"], out.inputs["Surface"])

    coord = n.new("ShaderNodeTexCoord")

    # starfield: Voronoi F1 gives point-like cells, a tight ramp keeps
    # only the very centres, so stars read as points not blobs
    vor = n.new("ShaderNodeTexVoronoi")
    vor.feature = 'F1'
    _set(vor, ["Scale"], 220.0)
    L.new(coord.outputs["Generated"], vor.inputs["Vector"])

    stars = n.new("ShaderNodeValToRGB")
    stars.color_ramp.elements[0].position = 0.0
    stars.color_ramp.elements[0].color = (1, 1, 1, 1)
    stars.color_ramp.elements[1].position = 0.045
    stars.color_ramp.elements[1].color = (0, 0, 0, 1)
    L.new(vor.outputs["Distance"], stars.inputs["Fac"])

    # faint planet-side gradient so metal has a direction to reflect
    sep = n.new("ShaderNodeSeparateXYZ")
    L.new(coord.outputs["Generated"], sep.inputs["Vector"])
    grad = n.new("ShaderNodeValToRGB")
    grad.color_ramp.elements[0].position = 0.30
    grad.color_ramp.elements[0].color = (0.004, 0.006, 0.012, 1)
    grad.color_ramp.elements[1].position = 1.0
    grad.color_ramp.elements[1].color = (0.05, 0.09, 0.16, 1)
    L.new(sep.outputs["Z"], grad.inputs["Fac"])

    add = n.new("ShaderNodeMixRGB") if "ShaderNodeMixRGB" in dir(bpy.types) \
        else n.new("ShaderNodeMix")
    try:
        add.blend_type = 'ADD'
        _set(add, ["Fac", "Factor"], 1.0)
        L.new(grad.outputs["Color"], add.inputs[1])
        L.new(stars.outputs["Color"], add.inputs[2])
        L.new(add.outputs[0], bg.inputs["Color"])
    except Exception:
        L.new(grad.outputs["Color"], bg.inputs["Color"])
    _set(bg, ["Strength"], 1.0)
    print("[mat] procedural space world built")


def add_reflection_cards():
    """Large, dim area lights. Metal needs varied reflections to read as
    metal; this is the practical substitute for an HDRI."""
    c = bpy.data.collections.get("_SCENE") or bpy.data.collections.new("_SCENE")
    if c.name not in {x.name for x in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(c)

    cards = [
        # name,          location,        size, energy, colour
        ("Card.KeySide",  (-16, -9, 9),    16, 90,  (1.00, 0.96, 0.90)),
        ("Card.Rim",      (14, 11, 12),    14, 55,  (0.72, 0.82, 1.00)),
        ("Card.Bounce",   (6, -14, -2),    18, 30,  (0.45, 0.55, 0.75)),
        ("Card.TopFill",  (0, 4, 20),      12, 25,  (0.85, 0.88, 0.95)),
    ]
    target = (0.0, 0.0, 5.7)
    made = 0
    for name, loc, size, energy, col in cards:
        if bpy.data.objects.get(name):
            continue
        d = bpy.data.lights.new(name, type='AREA')
        d.shape = 'SQUARE'
        d.size = size
        d.energy = energy
        d.color = col
        o = bpy.data.objects.new(name, d)
        c.objects.link(o)
        o.location = loc
        v = (target[0] - loc[0], target[1] - loc[1], target[2] - loc[2])
        from mathutils import Vector
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector(v).to_track_quat('-Z', 'Y')
        made += 1
    print(f"[mat] added {made} reflection card(s)")


# ===========================================================================
# 2 + 3. BEVEL AND SMOOTH SHADING
# ===========================================================================

def shade_and_bevel():
    meshes = [o for o in bpy.data.objects
              if o.type == 'MESH' and not _skip(o)]
    smoothed = beveled = 0
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        for x in bpy.data.objects:
            x.select_set(False)
        o.select_set(True)

        # --- smooth by angle; the API moved in 4.1 ---
        done = False
        if hasattr(bpy.ops.object, "shade_auto_smooth"):
            try:
                bpy.ops.object.shade_auto_smooth(angle=SMOOTH_ANGLE)
                done = True
            except (RuntimeError, TypeError):
                pass
        if not done:
            try:
                bpy.ops.object.shade_smooth()
                if hasattr(o.data, "use_auto_smooth"):
                    o.data.use_auto_smooth = True
                    o.data.auto_smooth_angle = SMOOTH_ANGLE
                done = True
            except RuntimeError:
                pass
        smoothed += 1 if done else 0

        # --- bevel ---
        if any(m.type == 'BEVEL' for m in o.modifiers):
            continue
        try:
            bpy.ops.object.modifier_add(type='BEVEL')
            b = o.modifiers[-1]
            b.width = BEVEL_WIDTH
            b.segments = BEVEL_SEGMENTS
            b.limit_method = 'ANGLE'
            b.angle_limit = math.radians(35)
            b.use_clamp_overlap = True
            b.miter_outer = 'MITER_ARC'
            try:
                b.harden_normals = True
            except AttributeError:
                pass
            beveled += 1
        except RuntimeError as e:
            print(f"[mat] bevel failed on {o.name}: {e}")
    print(f"[mat] smoothed {smoothed}, beveled {beveled} of {len(meshes)}")


# ===========================================================================
# 4 + 5. SHADERS
# ===========================================================================

def _fresh(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, nt.nodes, nt.links, bsdf


def _coords(n, L, scale=1.0):
    c = n.new("ShaderNodeTexCoord")
    m = n.new("ShaderNodeMapping")
    _set(m, ["Scale"], (scale, scale, scale))
    L.new(c.outputs["Object"], m.inputs["Vector"])
    return m


def shader_mli(mat, gold=True):
    """Crinkled, quilted, seamed thermal blanket. The single highest-value
    material in the scene -- previous pass had it as smooth gold."""
    nt, n, L, bsdf = _fresh(mat)
    uv = _coords(n, L, 1.0)

    # fine crinkle
    fine = n.new("ShaderNodeTexNoise")
    _set(fine, ["Scale"], 70.0)
    _set(fine, ["Detail"], 8.0)
    _set(fine, ["Roughness"], 0.62)
    L.new(uv.outputs["Vector"], fine.inputs["Vector"])
    b1 = n.new("ShaderNodeBump")
    _set(b1, ["Strength"], 0.30)
    _set(b1, ["Distance"], 0.012)
    L.new(fine.outputs["Fac"], b1.inputs["Height"])

    # broad wrinkle, chained through the fine bump's normal
    broad = n.new("ShaderNodeTexNoise")
    _set(broad, ["Scale"], 7.0)
    _set(broad, ["Detail"], 4.0)
    L.new(uv.outputs["Vector"], broad.inputs["Vector"])
    b2 = n.new("ShaderNodeBump")
    _set(b2, ["Strength"], 0.22)
    _set(b2, ["Distance"], 0.05)
    L.new(broad.outputs["Fac"], b2.inputs["Height"])
    L.new(b1.outputs["Normal"], b2.inputs["Normal"])

    # quilting seams
    wave = n.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    _set(wave, ["Scale"], 13.0)
    _set(wave, ["Distortion"], 3.0)
    L.new(uv.outputs["Vector"], wave.inputs["Vector"])
    seam = n.new("ShaderNodeValToRGB")
    seam.color_ramp.elements[0].position = 0.44
    seam.color_ramp.elements[1].position = 0.56
    L.new(wave.outputs["Fac"], seam.inputs["Fac"])
    b3 = n.new("ShaderNodeBump")
    _set(b3, ["Strength"], 0.18)
    _set(b3, ["Distance"], 0.03)
    L.new(seam.outputs["Color"], b3.inputs["Height"])
    L.new(b2.outputs["Normal"], b3.inputs["Normal"])
    L.new(b3.outputs["Normal"], bsdf.inputs["Normal"])

    # colour variation across the sheet
    tint = n.new("ShaderNodeTexNoise")
    _set(tint, ["Scale"], 3.2)
    _set(tint, ["Detail"], 2.0)
    L.new(uv.outputs["Vector"], tint.inputs["Vector"])
    ramp = n.new("ShaderNodeValToRGB")
    if gold:
        ramp.color_ramp.elements[0].color = (0.52, 0.31, 0.07, 1)
        ramp.color_ramp.elements[1].color = (0.88, 0.66, 0.26, 1)
    else:
        ramp.color_ramp.elements[0].color = (0.62, 0.64, 0.66, 1)
        ramp.color_ramp.elements[1].color = (0.90, 0.91, 0.93, 1)
    L.new(tint.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    # roughness break-up -- uniform roughness is a dead giveaway
    rn = n.new("ShaderNodeTexNoise")
    _set(rn, ["Scale"], 26.0)
    _set(rn, ["Detail"], 3.0)
    L.new(uv.outputs["Vector"], rn.inputs["Vector"])
    rr = n.new("ShaderNodeMapRange")
    _set(rr, ["From Min"], 0.0)
    _set(rr, ["From Max"], 1.0)
    _set(rr, ["To Min"], 0.20)
    _set(rr, ["To Max"], 0.46)
    L.new(rn.outputs["Fac"], rr.inputs["Value"])
    L.new(rr.outputs["Result"], bsdf.inputs["Roughness"])

    _set(bsdf, ["Metallic"], 1.0)
    _set(bsdf, ["Anisotropic"], 0.55)
    return mat


def shader_solar_array(mat):
    """Cell grid with busbar mortar, under a glass coat."""
    nt, n, L, bsdf = _fresh(mat)
    uv = _coords(n, L, 1.0)
    brick = n.new("ShaderNodeTexBrick")
    _set(brick, ["Scale"], 9.0)
    _set(brick, ["Color1"], (0.30, 0.10, 0.06, 1))
    _set(brick, ["Color2"], (0.26, 0.09, 0.05, 1))
    _set(brick, ["Mortar"], (0.62, 0.63, 0.66, 1))
    _set(brick, ["Mortar Size"], 0.012)
    _set(brick, ["Bias"], 0.0)
    L.new(uv.outputs["Vector"], brick.inputs["Vector"])
    L.new(brick.outputs["Color"], bsdf.inputs["Base Color"])

    bump = n.new("ShaderNodeBump")
    _set(bump, ["Strength"], 0.12)
    L.new(brick.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    _set(bsdf, ["Metallic"], 0.30)
    _set(bsdf, ["Roughness"], 0.20)
    _set(bsdf, ["Coat Weight", "Clearcoat"], 0.7)
    _set(bsdf, ["Coat Roughness", "Clearcoat Roughness"], 0.10)
    return mat


def shader_composite(mat, base=(0.045, 0.045, 0.05)):
    """Carbon composite: fine weave plus roughness variation."""
    nt, n, L, bsdf = _fresh(mat)
    uv = _coords(n, L, 1.0)
    weave = n.new("ShaderNodeTexWave")
    weave.wave_type = 'BANDS'
    weave.bands_direction = 'DIAGONAL'
    _set(weave, ["Scale"], 160.0)
    _set(weave, ["Distortion"], 1.2)
    L.new(uv.outputs["Vector"], weave.inputs["Vector"])
    bump = n.new("ShaderNodeBump")
    _set(bump, ["Strength"], 0.09)
    _set(bump, ["Distance"], 0.004)
    L.new(weave.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    rn = n.new("ShaderNodeTexNoise")
    _set(rn, ["Scale"], 40.0)
    L.new(uv.outputs["Vector"], rn.inputs["Vector"])
    rr = n.new("ShaderNodeMapRange")
    _set(rr, ["To Min"], 0.42)
    _set(rr, ["To Max"], 0.62)
    L.new(rn.outputs["Fac"], rr.inputs["Value"])
    L.new(rr.outputs["Result"], bsdf.inputs["Roughness"])

    _set(bsdf, ["Base Color"], (*base, 1.0))
    _set(bsdf, ["Metallic"], 0.05)
    return mat


def shader_mirror(mat):
    """Near-perfect metal with a whisper of roughness variation. A
    perfectly uniform roughness reads as CG even on a real mirror."""
    nt, n, L, bsdf = _fresh(mat)
    uv = _coords(n, L, 1.0)
    rn = n.new("ShaderNodeTexNoise")
    _set(rn, ["Scale"], 90.0)
    _set(rn, ["Detail"], 2.0)
    L.new(uv.outputs["Vector"], rn.inputs["Vector"])
    rr = n.new("ShaderNodeMapRange")
    _set(rr, ["To Min"], 0.008)
    _set(rr, ["To Max"], 0.028)
    L.new(rn.outputs["Fac"], rr.inputs["Value"])
    L.new(rr.outputs["Result"], bsdf.inputs["Roughness"])
    _set(bsdf, ["Base Color"], (0.95, 0.93, 0.88, 1.0))
    _set(bsdf, ["Metallic"], 1.0)
    return mat


def shader_painted(mat, base, rough):
    nt, n, L, bsdf = _fresh(mat)
    uv = _coords(n, L, 1.0)
    rn = n.new("ShaderNodeTexNoise")
    _set(rn, ["Scale"], 32.0)
    _set(rn, ["Detail"], 4.0)
    L.new(uv.outputs["Vector"], rn.inputs["Vector"])
    rr = n.new("ShaderNodeMapRange")
    _set(rr, ["To Min"], max(rough - 0.10, 0.02))
    _set(rr, ["To Max"], min(rough + 0.10, 1.0))
    L.new(rn.outputs["Fac"], rr.inputs["Value"])
    L.new(rr.outputs["Result"], bsdf.inputs["Roughness"])
    bump = n.new("ShaderNodeBump")
    _set(bump, ["Strength"], 0.05)
    L.new(rn.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    _set(bsdf, ["Base Color"], (*base, 1.0))
    return mat


ROUTES = {
    "MLI_Gold":        lambda m: shader_mli(m, gold=True),
    "MLI_Silver":      lambda m: shader_mli(m, gold=False),
    "SolarArray":      shader_solar_array,
    "Composite":       lambda m: shader_composite(m),
    "Mirror":          shader_mirror,
    "ULE_Glass":       lambda m: shader_painted(m, (0.86, 0.87, 0.88), 0.28),
    "Baffle_Black":    lambda m: shader_painted(m, (0.011, 0.011, 0.013), 0.92),
    "Structure_White": lambda m: shader_painted(m, (0.80, 0.80, 0.82), 0.42),
    "Radiator":        lambda m: shader_painted(m, (0.88, 0.89, 0.90), 0.16),
}


def upgrade_shaders():
    done = 0
    for name, fn in ROUTES.items():
        m = bpy.data.materials.get(name)
        if not m:
            print(f"[mat] no material named {name}; skipped")
            continue
        fn(m)
        done += 1
    print(f"[mat] upgraded {done}/{len(ROUTES)} materials")


# ===========================================================================

def render_settings():
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    try:
        s.cycles.samples = CYCLES_SAMPLES
        s.cycles.use_denoising = True
        s.cycles.max_bounces = 12
        s.cycles.glossy_bounces = 8
    except AttributeError:
        pass
    s.render.film_transparent = False   # want the starfield behind it
    try:
        s.view_settings.view_transform = 'AgX'   # 4.0+; 'Filmic' before
    except (AttributeError, TypeError):
        try:
            s.view_settings.view_transform = 'Filmic'
        except Exception:
            pass
    s.view_settings.look = 'None'
    print(f"[mat] Cycles, {CYCLES_SAMPLES} samples")


def main():
    if not bpy.data.collections.get("OBSERVATORY"):
        raise RuntimeError("No OBSERVATORY collection. Run roman_build.py first.")
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')

    if BUILD_WORLD:
        build_world()
    if ADD_REFLECTION_CARDS:
        add_reflection_cards()
    shade_and_bevel()
    if UPGRADE_SHADERS:
        upgrade_shaders()
    render_settings()

    print("\n[mat] done. Render a frame and LOOK at it before doing "
          "anything else -- none of this is verified by the test suite.")
    print("[mat] if you export to web after this, note that procedural")
    print("      textures do NOT survive glTF. They must be baked first.")


if __name__ == "__main__":
    main()
