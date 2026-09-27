"""
test_materials.py
Validate the shader graphs in roman_materials.py without Blender.

THE ONE THING THIS ACTUALLY CATCHES
-----------------------------------
Socket names. Blender shader nodes have fixed input/output names, and
Blender 4.0 renamed several on Principled BSDF ("Specular" -> "Specular
IOR Level", "Clearcoat" -> "Coat Weight"). Getting one wrong fails
SILENTLY -- `if name in node.inputs` is False, the value is never set,
and the render just looks subtly wrong with no error anywhere.

So: SOCKETS below is a hand-transcribed schema of the real socket names
for every node type roman_materials uses. The stub enforces it. Any
_set() whose entire candidate list misses, and any links.new() pointing
at a socket that does not exist, is reported.

WHAT IT CANNOT TELL YOU
    Whether the result looks like a spacecraft. Node graphs are visual
    output; only a render answers that. The schema is also my
    transcription of Blender's API, not Blender's API.

    python3 test_materials.py
"""

import sys
import types
import test_harness  # installs the bpy / mathutils stubs

import bpy

# ===========================================================================
# Real Blender socket names, transcribed by hand. Blender 4.x, with the
# pre-4.0 aliases kept where roman_materials offers them as candidates.
# ===========================================================================

SOCKETS = {
    "ShaderNodeOutputMaterial": (
        ["Surface", "Volume", "Displacement"], []),
    "ShaderNodeOutputWorld": (
        ["Surface", "Volume"], []),
    "ShaderNodeBackground": (
        ["Color", "Strength"], ["Background"]),
    "ShaderNodeBsdfPrincipled": ([
        "Base Color", "Metallic", "Roughness", "IOR", "Alpha", "Normal",
        "Weight", "Subsurface Weight", "Subsurface Radius", "Subsurface Scale",
        "Specular IOR Level", "Specular Tint", "Anisotropic",
        "Anisotropic Rotation", "Tangent", "Transmission Weight",
        "Coat Weight", "Coat Roughness", "Coat IOR", "Coat Tint",
        "Coat Normal", "Sheen Weight", "Sheen Roughness", "Sheen Tint",
        "Emission Color", "Emission Strength",
        # pre-4.0 names, still valid on 3.x
        "Specular", "Clearcoat", "Clearcoat Roughness", "Transmission",
        "Emission", "Sheen", "Subsurface",
    ], ["BSDF"]),
    "ShaderNodeTexCoord": (
        [], ["Generated", "Normal", "UV", "Object", "Camera", "Window",
             "Reflection"]),
    "ShaderNodeMapping": (
        ["Vector", "Location", "Rotation", "Scale"], ["Vector"]),
    "ShaderNodeTexNoise": (
        ["Vector", "W", "Scale", "Detail", "Roughness", "Lacunarity",
         "Distortion"], ["Fac", "Color"]),
    "ShaderNodeTexVoronoi": (
        ["Vector", "W", "Scale", "Detail", "Roughness", "Lacunarity",
         "Smoothness", "Exponent", "Randomness"],
        ["Distance", "Color", "Position", "W", "Radius"]),
    "ShaderNodeTexWave": (
        ["Vector", "Scale", "Distortion", "Detail", "Detail Scale",
         "Detail Roughness", "Phase Offset"], ["Fac", "Color"]),
    "ShaderNodeTexBrick": (
        ["Vector", "Color1", "Color2", "Mortar", "Scale", "Mortar Size",
         "Mortar Smooth", "Bias", "Brick Width", "Row Height"],
        ["Color", "Fac"]),
    "ShaderNodeBump": (
        ["Strength", "Distance", "Height", "Normal"], ["Normal"]),
    "ShaderNodeValToRGB": (
        ["Fac"], ["Color", "Alpha"]),
    "ShaderNodeMapRange": (
        ["Value", "From Min", "From Max", "To Min", "To Max", "Steps",
         "Vector"], ["Result", "Vector"]),
    "ShaderNodeSeparateXYZ": (
        ["Vector"], ["X", "Y", "Z"]),
    "ShaderNodeMixRGB": (
        ["Fac", "Color1", "Color2"], ["Color"]),
    "ShaderNodeMix": (
        ["Factor", "A", "B"], ["Result"]),
}

PROBLEMS = []


class Sock:
    def __init__(self, name, node):
        self.name, self.node = name, node
        self.default_value = None


class SockSet:
    """Enforces the schema: only real socket names resolve."""

    def __init__(self, node, names):
        self.node, self.names = node, list(names)
        self._made = {}

    def __contains__(self, k):
        if isinstance(k, int):
            return k < len(self.names)
        return k in self.names

    def __getitem__(self, k):
        if isinstance(k, int):
            if k >= len(self.names):
                PROBLEMS.append(
                    f"{self.node.bl_idname}: socket index {k} out of range")
                k = 0
            k = self.names[k] if self.names else "_none"
        if k not in self.names:
            PROBLEMS.append(f"{self.node.bl_idname}: no socket named {k!r}")
        return self._made.setdefault(k, Sock(k, self.node))

    def __len__(self): return len(self.names)


class Elem:
    def __init__(self, pos):
        self.position, self.color = pos, (0, 0, 0, 1)


class Ramp:
    def __init__(self): self.elements = [Elem(0.0), Elem(1.0)]


class Node:
    def __init__(self, bl_idname):
        self.bl_idname = bl_idname
        if bl_idname not in SOCKETS:
            PROBLEMS.append(f"unknown node type {bl_idname!r}")
            ins, outs = [], []
        else:
            ins, outs = SOCKETS[bl_idname]
        self.inputs = SockSet(self, ins)
        self.outputs = SockSet(self, outs)
        self.color_ramp = Ramp()

    def __setattr__(self, k, v):
        object.__setattr__(self, k, v)


class Nodes(list):
    def new(self, bl_idname):
        n = Node(bl_idname)
        self.append(n)
        return n

    def clear(self): del self[:]
    def get(self, name, d=None): return d


class Links(list):
    def new(self, a, b):
        for s, kind in ((a, "output"), (b, "input")):
            if not isinstance(s, Sock):
                PROBLEMS.append(f"link {kind} is not a socket: {s!r}")
                continue
            valid = (s.node.outputs.names if kind == "output"
                     else s.node.inputs.names)
            if s.name not in valid:
                PROBLEMS.append(
                    f"link to {s.node.bl_idname}.{kind}s[{s.name!r}] "
                    f"— not a real socket")
        self.append((a, b))
        return (a, b)


class Tree:
    def __init__(self):
        self.nodes = Nodes()
        self.links = Links()


def _install():
    # materials / worlds carrying real node trees
    for store, extra in ((bpy.data.materials, {}), ):
        store.f = lambda n: types.SimpleNamespace(
            name=n, use_nodes=False, node_tree=Tree(), users=1)
    bpy.data.worlds = test_harness.DataColl(
        lambda n: types.SimpleNamespace(
            name=n, use_nodes=False, node_tree=Tree(), users=1))
    bpy.types.ShaderNodeMixRGB = object
    bpy.context.scene.view_settings = types.SimpleNamespace(
        view_transform='Standard', look='None')
    bpy.context.scene.cursor = types.SimpleNamespace(
        location=test_harness.Vector())


def run():
    import io, contextlib
    _install()
    import roman_build as RB
    RB._evaluated_bbox = test_harness.real_bbox
    with contextlib.redirect_stdout(io.StringIO()):
        RB.main()

    import roman_materials as RM

    # instrument _set so a fully-missed candidate list is loud, not silent
    misses = []
    orig = RM._set

    def traced(node, candidates, value):
        ok = orig(node, candidates, value)
        if not ok:
            misses.append((getattr(node, "bl_idname", "?"), list(candidates)))
        return ok
    RM._set = traced

    print("### running roman_materials.main() under the schema stub\n")
    RM.main()

    print("\n### node graph validation\n")
    fails = 0

    if PROBLEMS:
        fails += len(PROBLEMS)
        for p in sorted(set(PROBLEMS)):
            print(f"  FAIL  {p}")
    else:
        print("  PASS  every link points at a socket that exists")
        print("  PASS  every node type is a real Blender node")

    if misses:
        fails += len(misses)
        for t, c in misses:
            print(f"  FAIL  {t}: none of {c} is a real socket")
    else:
        print("  PASS  every _set() resolved to a real socket")

    # each material must end up with a graph, not an empty tree
    for name in RM.ROUTES:
        m = bpy.data.materials.get(name)
        nodes = len(m.node_tree.nodes) if m else 0
        links = len(m.node_tree.links) if m else 0
        ok = nodes >= 2 and links >= 1
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<18} "
              f"{nodes:>2} nodes, {links:>2} links")

    w = bpy.data.worlds.get("RomanSpace")
    ok = w is not None and len(w.node_tree.nodes) >= 4
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  world graph "
          f"{len(w.node_tree.nodes) if w else 0} nodes")

    cards = [o for o in bpy.data.objects if o.name.startswith("Card.")]
    ok = len(cards) == 4
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  reflection cards  {len(cards)}/4")

    print(f"\n### {fails} problem(s)\n")
    return fails


if __name__ == "__main__":
    sys.exit(1 if run() else 0)
