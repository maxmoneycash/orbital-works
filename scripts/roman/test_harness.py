"""
test_harness.py
Run roman_build.py without Blender.

WHY THIS EXISTS
---------------
Blender's `bpy` module only publishes wheels for CPython 3.13. On any other
interpreter you cannot import it, so the usual outcome is that a Blender
script gets shipped untested. This stubs enough of bpy / bmesh / mathutils
to execute roman_build.py end to end with real vertex data, so the geometry
maths and the QC pass are exercised for real.

WHAT THIS PROVES
    * the script runs start to finish with no exceptions
    * every primitive lands where the maths says it should
    * the observatory measures 12.70 m long and 6.20 m across the wings,
      with the body inside 4.40 m
    * the hexapod struts really are ~2.4 m long
    * the conic sag equation produces the curvature it claims
    * collection/parent wiring is consistent
    * QC catches injected errors (see test_qc_catches_regressions)

WHAT THIS DOES NOT PROVE
    * Blender API semantics. Stubs are my model of bpy, not bpy.
    * Modifier evaluation. SOLIDIFY is modelled as bbox-neutral, which
      is what offset=-1.0 on an open tube really does -- but the stub
      cannot know that, so the OBA check is circular HERE and only
      meaningful in real Blender. (It did fail there, at offset=+1.0 on
      capped cylinders: 4.086 x 5.042 m. build_web.py runs the real QC.)
    * Anything about materials, shading, or render output.

    Run in real Blender before trusting it.

    python3 test_harness.py
"""

import math
import sys
import types


# ===========================================================================
# mathutils
# ===========================================================================

class Vector:
    def __init__(self, v=(0.0, 0.0, 0.0)):
        self.v = [float(x) for x in (v.v if isinstance(v, Vector) else v)]

    def __getitem__(self, i):  return self.v[i]
    def __setitem__(self, i, x): self.v[i] = float(x)
    def __len__(self):  return len(self.v)
    def __iter__(self): return iter(self.v)
    def __repr__(self): return f"V({', '.join(f'{x:.3f}' for x in self.v)})"

    @property
    def x(self): return self.v[0]
    @x.setter
    def x(self, val): self.v[0] = float(val)

    @property
    def y(self): return self.v[1]
    @y.setter
    def y(self, val): self.v[1] = float(val)

    @property
    def z(self): return self.v[2]
    @z.setter
    def z(self, val): self.v[2] = float(val)

    def __add__(self, o): return Vector([a + b for a, b in zip(self.v, o)])
    def __sub__(self, o): return Vector([a - b for a, b in zip(self.v, o)])
    def __mul__(self, s): return Vector([a * s for a in self.v])
    __rmul__ = __mul__

    def __truediv__(self, s): return Vector([a / s for a in self.v])

    @property
    def length(self): return math.sqrt(sum(a * a for a in self.v))

    def normalized(self):
        L = self.length
        return Vector([a / L for a in self.v]) if L > 1e-12 else Vector()

    def to_track_quat(self, track='Z', up='Y'):
        return Quaternion(self)

    def copy(self): return Vector(self.v)


class Quaternion:
    def __init__(self, v=None): self.v = v

    def __iter__(self): return iter((1.0, 0.0, 0.0, 0.0))


class Matrix:
    def __init__(self, trans=(0, 0, 0)):
        self.t = Vector(trans)

    def inverted(self):
        return Matrix([-x for x in self.t])

    def __matmul__(self, other):
        if isinstance(other, Vector):
            return other + self.t
        return Matrix(self.t + other.t)


mathutils = types.ModuleType("mathutils")
mathutils.Vector = Vector
mathutils.Matrix = Matrix
mathutils.Quaternion = Quaternion
sys.modules["mathutils"] = mathutils


# ===========================================================================
# bpy data model
# ===========================================================================

class Mesh:
    def __init__(self, name):
        self.name = name
        self.users = 1
        self.vertices = []
        self.materials = []
        self.polygons = []

    def shade_smooth(self): pass


class MeshVert:
    def __init__(self, co): self.co = Vector(co)


class Modifier:
    def __init__(self, t):
        self.type = t
        self.thickness = 0.0
        self.offset = 0.0
        self.show_viewport = True
        self.deform_method = None
        self.angle = 0.0


class Obj:
    _registry = None

    def __init__(self, name, data=None, type_='MESH'):
        self._name = name
        self.data = data
        self.type = type_ if data is not None else 'EMPTY'
        self._location = Vector()
        self._scale = Vector((1, 1, 1))
        self.rotation_euler = Vector()
        self.rotation_mode = 'XYZ'
        self.rotation_quaternion = Quaternion()
        self.parent = None
        self.matrix_parent_inverse = Matrix()
        self.modifiers = []
        self.display_type = 'TEXTURED'
        self.hide_render = False
        self.lock_location = self.lock_rotation = self.lock_scale = (False,) * 3
        self.empty_display_type = 'PLAIN_AXES'
        self.empty_display_size = 1.0
        self.users_collection = []
        self.bound_box = [(0, 0, 0)] * 8
        self._props = {}

    # ID custom properties: obj["key"] = value, as bpy supports.
    def __setitem__(self, k, v): self._props[k] = v
    def __getitem__(self, k): return self._props[k]
    def __delitem__(self, k): del self._props[k]
    def get(self, k, d=None): return self._props.get(k, d)
    def __contains__(self, k): return k in self._props
    def keys(self): return self._props.keys()

    @property
    def name(self): return self._name

    @name.setter
    def name(self, n):
        reg = Obj._registry
        if reg is not None and reg.get(self._name) is self:
            dict.pop(reg, self._name, None)
            base, i = n, 1
            while n in reg:
                n = f"{base}.{i:03d}"; i += 1
            dict.__setitem__(reg, n, self)
        self._name = n

    @property
    def location(self): return self._location

    @location.setter
    def location(self, v): self._location = Vector(v)

    @property
    def scale(self): return self._scale

    @scale.setter
    def scale(self, v): self._scale = Vector(v)

    @property
    def matrix_world(self):
        # Blender: world = parent.matrix_world @ matrix_parent_inverse @ local.
        # The harness previously summed parent locations and ignored the
        # inverse, double-counting every offset. Blender does not.
        loc = Vector(self.location)
        if self.parent is not None:
            loc = loc + self.parent.matrix_world.t + self.matrix_parent_inverse.t
        return Matrix(loc)

    def evaluated_get(self, dg): return self
    def to_mesh(self): return self.data
    def to_mesh_clear(self): pass
    def shade_smooth(self): pass
    def select_set(self, v): pass


class _Children:
    def __init__(self, coll): self.c = coll
    def __iter__(self): return iter(self.c._children)
    def __len__(self): return len(self.c._children)
    def __contains__(self, x): return x in self.c._children

    def link(self, x):
        if isinstance(x, Collection) and x not in self.c._children:
            self.c._children.append(x)

    def unlink(self, x):
        if x in self.c._children:
            self.c._children.remove(x)


class Collection:
    def __init__(self, name):
        self.name = name
        self._objects = []
        self._children = []

    @property
    def children(self): return _Children(self)

    @property
    def objects(self): return _ObjList(self)

    @property
    def children_recursive(self):
        out = []
        for c in self._children:
            out.append(c)
            out.extend(c.children_recursive)
        return out


class _ObjList:
    def __init__(self, coll): self.c = coll
    def __iter__(self): return iter(self.c._objects)
    def __len__(self): return len(self.c._objects)
    def __contains__(self, o): return o in self.c._objects

    def link(self, o):
        if o not in self.c._objects:
            self.c._objects.append(o)
            if self.c not in o.users_collection:
                o.users_collection.append(self.c)

    def unlink(self, o):
        if o in self.c._objects:
            self.c._objects.remove(o)
        if self.c in o.users_collection:
            o.users_collection.remove(self.c)


class DataColl(dict):
    def __init__(self, factory): super().__init__(); self.f = factory

    def new(self, name, *a, **k):
        o = self.f(name, *a, **k)
        base, i = name, 1
        while name in self:
            name = f"{base}.{i:03d}"; i += 1
        o.name = name
        self[name] = o
        return o

    def remove(self, o, **k): self.pop(getattr(o, "name", o), None)
    def get(self, n, d=None): return dict.get(self, n, d)
    def __iter__(self): return iter(list(self.values()))


class Data:
    def __init__(self):
        self.objects = DataColl(lambda n, data=None: Obj(n, data))
        self.meshes = DataColl(lambda n: Mesh(n))
        self.materials = DataColl(lambda n: types.SimpleNamespace(
            name=n, use_nodes=False, node_tree=_NodeTree(), users=1))
        self.collections = DataColl(lambda n: Collection(n))
        self.cameras = DataColl(lambda n: types.SimpleNamespace(
            name=n, lens=50.0, clip_start=0.1, clip_end=100.0, users=1))
        self.lights = DataColl(lambda n, type='SUN': types.SimpleNamespace(
            name=n, type=type, energy=1.0, angle=0.0, size=1.0,
            color=(1, 1, 1), users=1))
        self.curves = DataColl(lambda n: types.SimpleNamespace(name=n, users=1))
        self.filepath = ""


class _Socket:
    def __init__(self): self.default_value = None


class _Node:
    def __init__(self): self.inputs = _Inputs()


class _Inputs(dict):
    def __contains__(self, k): return True
    def __getitem__(self, k):
        if k not in self.keys():
            dict.__setitem__(self, k, _Socket())
        return dict.__getitem__(self, k)


class _NodeTree:
    def __init__(self): self.nodes = _Nodes()


class _Nodes(dict):
    def get(self, n, d=None):
        if n not in self:
            dict.__setitem__(self, n, _Node())
        return dict.__getitem__(self, n)


# ===========================================================================
# primitive generation -- real vertices, so bbox measurement is meaningful
# ===========================================================================

def _mk_obj(name, verts):
    me = bpy.data.meshes.new(name)
    me.vertices = [MeshVert(v) for v in verts]
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    bpy.context._active = o
    return o


def _rot_apply(verts, rot):
    rx, ry, rz = (float(r) for r in rot)
    out = []
    for x, y, z in verts:
        y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
        x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
        x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
        out.append((x, y, z))
    return out


class _MeshOps:
    @staticmethod
    def primitive_cylinder_add(vertices=32, radius=1.0, depth=2.0,
                               location=(0, 0, 0), rotation=(0, 0, 0), **k):
        vs = []
        for s in (-depth / 2, depth / 2):
            for i in range(vertices):
                a = 2 * math.pi * i / vertices
                vs.append((radius * math.cos(a), radius * math.sin(a), s))
        o = _mk_obj("Cylinder", vs)
        o.location = Vector(location)
        o._rot = tuple(float(r) for r in rotation)
        return {'FINISHED'}

    @staticmethod
    def primitive_cone_add(vertices=32, radius1=1.0, radius2=0.0, depth=2.0,
                           location=(0, 0, 0), rotation=(0, 0, 0), **k):
        vs = []
        for r, s in ((radius1, -depth / 2), (radius2, depth / 2)):
            for i in range(max(vertices, 3)):
                a = 2 * math.pi * i / max(vertices, 3)
                vs.append((r * math.cos(a), r * math.sin(a), s))
        o = _mk_obj("Cone", vs)
        o.location = Vector(location)
        o._rot = tuple(float(r) for r in rotation)
        return {'FINISHED'}

    @staticmethod
    def primitive_cube_add(size=2.0, location=(0, 0, 0), rotation=(0, 0, 0), **k):
        h = size / 2
        vs = [(x * h, y * h, z * h)
              for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        o = _mk_obj("Cube", vs)
        o.location = Vector(location)
        o._rot = tuple(float(r) for r in rotation)
        return {'FINISHED'}

    @staticmethod
    def primitive_circle_add(**k): return _MeshOps.primitive_cylinder_add(depth=0, **k)

    @staticmethod
    def primitive_uv_sphere_add(radius=1.0, location=(0, 0, 0), **k):
        vs = [(radius * math.cos(a) * math.sin(b),
               radius * math.sin(a) * math.sin(b), radius * math.cos(b))
              for a in [i * math.pi / 8 for i in range(16)]
              for b in [j * math.pi / 8 for j in range(9)]]
        o = _mk_obj("Sphere", vs)
        o.location = Vector(location)
        return {'FINISHED'}

    @staticmethod
    def select_all(**k): return {'FINISHED'}
    @staticmethod
    def separate(**k): return {'FINISHED'}


class _ObjectOps:
    @staticmethod
    def mode_set(mode='OBJECT', **k): return {'FINISHED'}
    @staticmethod
    def select_all(**k): return {'FINISHED'}
    @staticmethod
    def delete(**k): return {'FINISHED'}
    @staticmethod
    def join(**k): return {'FINISHED'}
    @staticmethod
    def shade_smooth(**k): return {'FINISHED'}

    @staticmethod
    def modifier_add(type='SUBSURF', **k):
        o = bpy.context.object
        if o is not None:
            o.modifiers.append(Modifier(type))
        return {'FINISHED'}


class _Ops:
    mesh = _MeshOps
    object = _ObjectOps
    import_scene = types.SimpleNamespace(gltf=lambda **k: {'FINISHED'})


class _ViewLayer:
    def __init__(self): self.objects = types.SimpleNamespace(active=None)
    def update(self): pass


class _Scene:
    def __init__(self):
        self.collection = Collection("Scene Collection")
        self.unit_settings = types.SimpleNamespace(
            system='METRIC', scale_length=1.0, length_unit='METERS')
        self.render = types.SimpleNamespace(
            engine='EEVEE', resolution_x=1920, resolution_y=1080,
            film_transparent=False)
        self.cycles = types.SimpleNamespace(samples=128, use_denoising=False)
        self.world = types.SimpleNamespace(use_nodes=False, node_tree=_NodeTree())
        self.camera = None


class _Context:
    def __init__(self):
        self.scene = _Scene()
        self.view_layer = _ViewLayer()
        self.screen = None
        self.mode = 'OBJECT'
        self._active = None

    @property
    def object(self): return self._active

    def evaluated_depsgraph_get(self): return object()


bpy = types.ModuleType("bpy")
bpy.data = Data()
Obj._registry = bpy.data.objects
bpy.context = _Context()
bpy.ops = _Ops()
bpy.types = types.SimpleNamespace(Object=Obj)
sys.modules["bpy"] = bpy

# keep view_layer.objects.active writes flowing to context.object
_orig_vl = bpy.context.view_layer


class _ActiveProxy:
    def __init__(self, ctx): self.ctx = ctx
    @property
    def active(self): return self.ctx._active
    @active.setter
    def active(self, o): self.ctx._active = o


bpy.context.view_layer.objects = _ActiveProxy(bpy.context)


# ===========================================================================
# bmesh
# ===========================================================================

class _BMVert:
    def __init__(self, co): self.co = Vector(co)


class _BMVerts(list):
    def new(self, co):
        v = _BMVert(co)
        self.append(v)
        return v


class _BMFaces(list):
    def new(self, verts):
        self.append(list(verts))
        return list(verts)


class _BMesh:
    def __init__(self):
        self.verts = _BMVerts()
        self.faces = _BMFaces()

    def normal_update(self): pass
    def free(self): pass

    def to_mesh(self, me):
        me.vertices = [MeshVert(v.co) for v in self.verts]
        me.polygons = list(self.faces)


bmesh = types.ModuleType("bmesh")
bmesh.new = lambda: _BMesh()
sys.modules["bmesh"] = bmesh


# ===========================================================================
# real bbox, overriding the stub's simplification
# ===========================================================================

def real_bbox(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    found = False
    for o in objs:
        if o.type != 'MESH' or o.hide_render or not o.data:
            continue
        vs = o.data.vertices
        if not vs:
            continue
        found = True
        wl = o.matrix_world.t
        sc = o.scale
        rot = getattr(o, "_rot", (0.0, 0.0, 0.0))
        scaled = [(v.co[0] * sc[0], v.co[1] * sc[1], v.co[2] * sc[2])
                  for v in vs]
        for x, y, z in _rot_apply(scaled, rot):   # T * R * S, as Blender does
            for i, w in enumerate((x + wl[0], y + wl[1], z + wl[2])):
                lo[i] = min(lo[i], w)
                hi[i] = max(hi[i], w)
    return (Vector(lo), Vector(hi)) if found else (None, None)


# ===========================================================================
# TESTS
# ===========================================================================

def run():
    import roman_dims
    import roman_build as RB

    # wire the harness bbox into the module under test
    RB._evaluated_bbox = real_bbox

    print("### executing roman_build.main() under harness\n")
    RB.main()

    print("\n### harness assertions\n")
    fails = 0

    def check(label, cond, detail=""):
        nonlocal fails
        if not cond:
            fails += 1
        print(f"  {'PASS' if cond else 'FAIL'}  {label}  {detail}")

    lo, hi = real_bbox(RB._collect("OBSERVATORY"))
    d = hi - lo
    check("observatory Z length == 12.70", abs(d.z - 12.70) < 0.02,
          f"got {d.z:.3f}")
    check("wing span across the sun shield (X) == 6.20", abs(d.x - 6.20) < 0.05,
          f"got {d.x:.3f}")
    wings = set(RB._collect("SOLAR_ARRAY_SUN_SHIELD")) | set(RB._collect("OSS.LowerInstrumentSunShade"))
    bl, bh = real_bbox([o for o in RB._collect("OBSERVATORY") if o not in wings])
    check("body width (X) <= 4.40", (bh - bl).x <= 4.42, f"got {(bh - bl).x:.3f}")
    check("base seated at Z=0", abs(lo.z) < 0.02, f"got {lo.z:.3f}")

    struts = [o for o in bpy.data.objects if o.name.startswith("SMA.Strut.")]
    check("6 hexapod struts built", len(struts) == 6, f"got {len(struts)}")
    lens = []
    for s in struts:
        l, h = real_bbox([s])
        lens.append((h - l).length)
    check("hexapod struts ~2.4 m (published)",
          all(abs(L - 2.40) < 0.12 for L in lens),
          f"range {min(lens):.3f}-{max(lens):.3f}")

    check("3 PM bipods -> 6 legs",
          len([o for o in bpy.data.objects if o.name.startswith("PM.Bipod")]) == 6)
    check("6 FMS alignment drives",
          len([o for o in bpy.data.objects
               if o.name.startswith("FMS.AlignmentDrive")]) == 6)
    check("6 FOA struts to instrument carrier",
          len([o for o in bpy.data.objects if o.name.startswith("FOA.Strut")]) == 6)
    check("18 H4RG detectors",
          len([o for o in bpy.data.objects if o.name.startswith("WFI.H4RG")]) == 18)
    check("AOM has FM1, FM2, tertiary",
          all(bpy.data.objects.get(f"AOM.{n}")
              for n in ("FM1", "FM2", "Tertiary")))
    check("TOMA has M3, M4, M5",
          all(bpy.data.objects.get(f"TOMA.{n}") for n in ("M3", "M4", "M5")))

    # conic sag: verify the equation, not just that it ran
    pm = bpy.data.objects.get("PM.Surface")
    check("PM surface generated", pm is not None)
    if pm:
        l, h = real_bbox([pm])
        check("PM diameter == 2.40", abs(max((h - l).x, (h - l).y) - 2.40) < 0.02,
              f"got {max((h-l).x, (h-l).y):.3f}")
        sag = (h - l).z
        R, K = float(roman_dims.PM_ROC), float(roman_dims.PM_CONIC)
        r = 1.20
        want = r * r / (R * (1 + math.sqrt(1 - (1 + K) * r * r / (R * R))))
        r_in = float(roman_dims.PM_BAFFLE_DIA) / 2
        want -= r_in * r_in / (R * (1 + math.sqrt(1 - (1 + K) * r_in * r_in / (R * R))))
        check("PM sag matches conic equation", abs(sag - want) < 0.002,
              f"mesh {sag:.4f} vs closed-form {want:.4f}")

    # every mesh must live in exactly one collection
    orphans = [o.name for o in bpy.data.objects if len(o.users_collection) != 1]
    check("no orphaned / double-linked objects", not orphans,
          f"{orphans[:3]}" if orphans else "")

    # nothing should poke outside the published envelope: 12.7 m long, the
    # body inside 4.4 m, only the wings out to their 6.2 m span
    wings = set(RB._collect("SOLAR_ARRAY_SUN_SHIELD")) | set(RB._collect("OSS.LowerInstrumentSunShade"))
    over = []
    for o in RB._collect("OBSERVATORY"):
        if o.type != 'MESH' or o.hide_render:
            continue
        l, h = real_bbox([o])
        if l is None:
            continue
        half = 3.12 if o in wings else 2.22
        if h.z > 12.72 or l.z < -0.02 or max(abs(l.x), abs(h.x)) > half:
            over.append(o.name)
    check("nothing breaches the 12.7 m x 4.4 m body / 6.2 m wing envelope", not over,
          f"{over[:3]}" if over else "")

    print(f"\n### {fails} harness assertion(s) failed\n")
    return fails


def test_qc_catches_regressions():
    """Prove QC is not tautological: corrupt a dimension, expect a FAIL."""
    print("### regression: does QC actually catch a bad dimension?\n")
    import importlib
    import roman_dims
    importlib.reload(roman_dims)
    import roman_build as RB
    importlib.reload(RB)
    RB._evaluated_bbox = real_bbox
    # 6 cm narrow: small enough that check_budget still passes (the 3.90 m
    # bus must fit under the barrel, so v2's 3.10 m now fails before QC
    # runs), large enough that QC's 2 cm tolerance must catch it.
    roman_dims.OBA_DIA = roman_dims.PUB(3.94, "DELIBERATELY WRONG")
    RB.RUN_QC = False
    RB.main()
    ok = RB.qc()
    print(f"\n  QC returned {ok} -- expected False")
    print(f"  {'PASS' if not ok else 'FAIL'}  QC detects an injected error\n")
    return 0 if not ok else 1


if __name__ == "__main__":
    n = run()
    n += test_qc_catches_regressions()
    sys.exit(1 if n else 0)
