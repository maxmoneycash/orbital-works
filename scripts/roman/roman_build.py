"""
roman_build.py  --  v3
Nancy Grace Roman Space Telescope -- Blender scene builder.

Requires roman_dims.py in the same folder.

    Blender > Scripting > Open > roman_build.py > Run
    (or)  blender --python roman_build.py

WHAT CHANGED IN v3  (shape pass against NASA's V006 tour renders [S13])
--------------------------------------------------------------------
* Outer Barrel Assembly: a hexagonal shroud (corners on +-X, a flat under
  the sun shield) around a round bore, with four external frames, corner
  longerons, brackets, six baffle vanes and a front ring whose lower edge
  follows the hex down to a stepped keel. It stands on a short open truss
  bay -- corner longerons, ring beams, X-braces, isogrid shear panels --
  instead of six vertical stilts.
* Deployable Aperture Cover: a gabled scoop on a ridge boom and two eave
  booms, its side walls cut at a slant, instead of a truncated cone.
* Solar Array Sun Shield: a flat roof just proud of the shroud's sun-side
  flat, hinged at that flat's corners; chamfered, framed panels.
* LISS: in the roof plane over the bus. HGA: on a boom rising from the
  aft, sun-side edge of the bus, a ribbed dish above the roof.
* Bus: a hexagon nearly the barrel's width, corners on +-X, radiators,
  isogrid aft deck, thruster pods, star trackers, RF electronics, on a
  short adapter ring. WFI and CGI moved to the anti-sun corners of the bay
  (WFI -X, CGI +X), as NASA's part overlays place them.
* Detail that nobody picks on its own is built by MeshBuilder as one mesh
  per subsystem and material, so the web export stays light.
* Wings at NASA's spans: outer SASS columns are the published 2.1 m
  panels, and the LISS swings out from the bus's sun-side corners, so the
  deployed span is ~6.2 m. 4.40 m is the body's width (roman_dims
  TOTAL_WIDTH), and QC checks the body and the span separately.

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


# ===========================================================================
# MESH BUILDER  --  many primitives, one mesh
# ===========================================================================
#
# Plain-tuple vector maths on purpose: the stub harness models only a
# sliver of mathutils, and everything here has to run under it too.

def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _len(a): return math.sqrt(_dot(a, a))


def _unit(a):
    L = _len(a)
    return _mul(a, 1.0 / L) if L > 1e-12 else (0.0, 0.0, 0.0)


def _lerp(a, b, t): return _add(a, _mul(_sub(b, a), t))
def _t3(p): return (float(p[0]), float(p[1]), float(p[2]))


def _frame(d):
    """Two unit vectors perpendicular to unit `d` and to each other."""
    ref = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = _unit(_cross(d, ref))
    return u, _cross(d, u)


def _newell(pts):
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0, z0 = pts[i]
        x1, y1, z1 = pts[(i + 1) % n]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    return (nx, ny, nz)


def _polar(r, a, z=0.0): return (r * math.cos(a), r * math.sin(a), z)


class MeshBuilder:
    """Accumulates primitives as ONE mesh, in world coordinates.

    The web export is per object: forty struts built as forty objects are
    forty draw calls and forty rows in the explorer's part list. Detail
    nobody picks on its own -- truss members, brackets, isogrid ribs -- is
    built here and lands as one mesh per subsystem and material, while the
    parts the viewer names, folds and lights stay separate objects.

    Every face is oriented explicitly, by a direction its normal must face,
    so SOLIDIFY, backface culling and the viewer's inside/outside shading
    all agree. Nothing is left to recalc-normals guesswork.
    """

    def __init__(self):
        self.verts = []
        self.faces = []

    def v(self, p):
        self.verts.append(_t3(p))
        return len(self.verts) - 1

    def face(self, ids, want=None):
        ids = [i for k, i in enumerate(ids) if i != ids[k - 1]]
        if len(set(ids)) < 3 or len(set(ids)) != len(ids):
            return
        n = _newell([self.verts[i] for i in ids])
        if _len(n) < 1e-12:
            return
        if want is not None and _dot(n, want) < 0:
            ids.reverse()
        self.faces.append(tuple(ids))

    # ---- solids -----------------------------------------------------------
    def box(self, c, size, axes=((1, 0, 0), (0, 1, 0), (0, 0, 1))):
        """Oriented box: `size` measured along the three `axes`."""
        e = [_mul(_unit(a), s / 2.0) for a, s in zip(axes, size)]
        ids = {}
        for i in (0, 1):
            for j in (0, 1):
                for k in (0, 1):
                    p = c
                    for sgn, ax in zip((i, j, k), e):
                        p = _add(p, _mul(ax, 2 * sgn - 1))
                    ids[(i, j, k)] = self.v(p)
        quads = (((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)),
                 ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
                 ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
                 ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)),
                 ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)),
                 ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)))
        for q in quads:
            cen = _mul(_add(_add(self.verts[ids[q[0]]], self.verts[ids[q[1]]]),
                            _add(self.verts[ids[q[2]]], self.verts[ids[q[3]]])), 0.25)
            self.face([ids[x] for x in q], want=_sub(cen, c))

    def beam(self, p0, p1, w, t, up=(0.0, 0.0, 1.0)):
        """A w x t bar from p0 to p1; its t side runs along `up`."""
        p0, p1 = _t3(p0), _t3(p1)
        d = _sub(p1, p0)
        L = _len(d)
        if L < 1e-6:
            return
        d = _mul(d, 1.0 / L)
        side = _cross(d, up)
        if _len(side) < 1e-6:
            side = _frame(d)[0]
        side = _unit(side)
        self.box(_lerp(p0, p1, 0.5), (L, w, t), (d, side, _cross(side, d)))

    def rod(self, p0, p1, r, n=8, caps=True, r1=None):
        """Round bar -- or a frustum, given r1 -- from p0 to p1."""
        p0, p1 = _t3(p0), _t3(p1)
        d = _sub(p1, p0)
        L = _len(d)
        if L < 1e-6:
            return
        d = _mul(d, 1.0 / L)
        u, w = _frame(d)
        r1 = r if r1 is None else r1

        def ring(p, rr):
            return [self.v(_add(p, _add(_mul(u, rr * math.cos(2 * math.pi * k / n)),
                                        _mul(w, rr * math.sin(2 * math.pi * k / n)))))
                    for k in range(n)]
        a, b = ring(p0, r), ring(p1, r1)
        for k in range(n):
            k2 = (k + 1) % n
            ang = 2 * math.pi * (k + 0.5) / n
            radial = _add(_mul(u, math.cos(ang)), _mul(w, math.sin(ang)))
            self.face([a[k], a[k2], b[k2], b[k]], want=radial)
        if caps:
            self.face(a, want=_mul(d, -1.0))
            self.face(b, want=d)

    def lathe(self, prof, origin, axis, n=32, a0=0.0):
        """Solid of revolution. `prof` is a CLOSED loop of (r, s) points,
        counter-clockwise in the (r out, s along axis) half-plane, so each
        face's outward normal is known from its profile segment."""
        d = _unit(_t3(axis))
        u, w = _frame(d)
        origin = _t3(origin)
        rings = []
        for r, s in prof:
            c = _add(origin, _mul(d, s))
            if r < 1e-7:
                rings.append([self.v(c)] * n)          # a pole, not a ring
            else:
                rings.append([self.v(_add(c, _add(
                    _mul(u, r * math.cos(a0 + 2 * math.pi * k / n)),
                    _mul(w, r * math.sin(a0 + 2 * math.pi * k / n)))))
                    for k in range(n)])
        m = len(prof)
        for i in range(m):
            (r0, s0), (r1, s1) = prof[i], prof[(i + 1) % m]
            nr, ns = (s1 - s0), -(r1 - r0)            # outward, CCW loop
            ra, rb = rings[i], rings[(i + 1) % m]
            for k in range(n):
                k2 = (k + 1) % n
                ang = a0 + 2 * math.pi * (k + 0.5) / n
                radial = _add(_mul(u, math.cos(ang)), _mul(w, math.sin(ang)))
                self.face([ra[k], ra[k2], rb[k2], rb[k]],
                          want=_add(_mul(radial, nr), _mul(d, ns)))

    def prism(self, poly, origin, ex, ey, ez, depth):
        """Extrude a 2D polygon, drawn in the (ex, ey) plane at `origin`,
        by `depth` along ez. Concave outlines are fine."""
        area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] -
                   poly[(i + 1) % len(poly)][0] * poly[i][1]
                   for i in range(len(poly)))
        ccw = area > 0

        def at(x, y, h):
            return _add(_add(_add(_t3(origin), _mul(ex, x)), _mul(ey, y)), _mul(ez, h))
        bot = [self.v(at(x, y, 0.0)) for x, y in poly]
        top = [self.v(at(x, y, depth)) for x, y in poly]
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            dx, dy = poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]
            nx, ny = (dy, -dx) if ccw else (-dy, dx)
            self.face([bot[i], bot[j], top[j], top[i]],
                      want=_add(_mul(ex, nx), _mul(ey, ny)))
        self.face(bot, want=_mul(ez, -1.0))
        self.face(top, want=ez)

    def plate_with_hole(self, outer, inner, origin, ex, ey, ez, depth):
        """A flat plate, outline `outer` with hole `inner` (2D loops, both
        star-shaped about the origin), extruded along ez. The two loops are
        zipped together by angle, so no triangulator is needed."""
        def by_angle(loop):
            pts = sorted(((math.atan2(y, x) % (2 * math.pi), (x, y)) for x, y in loop))
            return [a for a, _ in pts], [p for _, p in pts]
        A, outer = by_angle(outer)
        B, inner = by_angle(inner)
        na, nb = len(outer), len(inner)
        tris = []
        Ae, Be = A + [A[0] + 2 * math.pi], B + [B[0] + 2 * math.pi]
        i = j = 0
        while i < na or j < nb:
            if j >= nb or (i < na and Ae[i + 1] <= Be[j + 1]):
                tris.append((("o", i % na), ("o", (i + 1) % na), ("i", j % nb)))
                i += 1
            else:
                tris.append((("o", i % na), ("i", (j + 1) % nb), ("i", j % nb)))
                j += 1

        def at(x, y, h):
            return _add(_add(_add(_t3(origin), _mul(ex, x)), _mul(ey, y)), _mul(ez, h))
        ids = {}
        for side, h in (("b", 0.0), ("t", depth)):
            ids[(side, "o")] = [self.v(at(x, y, h)) for x, y in outer]
            ids[(side, "i")] = [self.v(at(x, y, h)) for x, y in inner]
        for side, want in (("b", _mul(ez, -1.0)), ("t", ez)):
            for tri in tris:
                self.face([ids[(side, loop)][k] for loop, k in tri], want=want)
        for loop, pts, sgn in (("o", outer, 1.0), ("i", inner, -1.0)):
            m = len(pts)
            for k in range(m):
                k2 = (k + 1) % m
                mx = (pts[k][0] + pts[k2][0]) / 2
                my = (pts[k][1] + pts[k2][1]) / 2
                self.face([ids[("b", loop)][k], ids[("b", loop)][k2],
                           ids[("t", loop)][k2], ids[("t", loop)][k]],
                          want=_mul(_add(_mul(ex, mx), _mul(ey, my)), sgn))

    # ---- output -----------------------------------------------------------
    def build(self, name, target, parent=None, mat=None, uv=0.5, fit=None,
              bevel=False):
        """Make the object. `uv` box-projects UVs in metres x uv; `fit`
        maps two world axes onto 0..1 instead, for textures that tile per
        panel (the solar cells). Builder meshes skip the edge bevel unless
        asked: on thousands of small ribs it multiplies the vertex count
        for edges nobody can see."""
        bm = bmesh.new()
        bv = [bm.verts.new(p) for p in self.verts]
        for f in self.faces:
            try:
                bm.faces.new([bv[i] for i in f])
            except ValueError:
                pass                                   # duplicate face
        bm.normal_update()
        loops = getattr(bm, "loops", None)             # absent in the stub
        if loops is not None and (uv or fit):
            lay = loops.layers.uv.new("UVMap")
            for fc in bm.faces:
                nrm = fc.normal
                ax = max(range(3), key=lambda k: abs(nrm[k]))
                a, b = ((1, 2), (0, 2), (0, 1))[ax]
                for lp in fc.loops:
                    co = lp.vert.co
                    if fit:
                        (iu, u0, u1), (iv, v0, v1) = fit
                        lp[lay].uv = ((co[iu] - u0) / (u1 - u0),
                                      (co[iv] - v0) / (v1 - v0))
                    else:
                        lp[lay].uv = (co[a] * uv, co[b] * uv)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        if not bevel:
            o["no_bevel"] = 1
        return _finish(o, name, target, parent, mat)


# ---------------------------------------------------------------------------
# hexagon helpers. Both hexagons (bus, shroud) have their CORNERS on +-X
# and a flat on the sun side (-Y), as V006 shows them [S13]. Face k runs
# from corner k to corner k+1 and faces angle 60k + 30 deg.
# ---------------------------------------------------------------------------

_SQ3 = math.sqrt(3.0)


def _hex_corner(R, k):
    a = math.radians(60 * k)
    return (R * math.cos(a), R * math.sin(a))


def _hex_corners(R):
    return [_hex_corner(R, k) for k in range(6)]


def _hex_r(R, th):
    """Centre-to-boundary distance of the hexagon at angle th."""
    th = th % (2 * math.pi)
    k = math.floor(th / (math.pi / 3) + 1e-9)
    return R * _SQ3 / 2 / math.cos(th - (k + 0.5) * math.pi / 3)


def _hex_face(k):
    """(outward normal, tangent) of hex face k, both in XY."""
    a = math.radians(60 * k + 30)
    return (math.cos(a), math.sin(a), 0.0), (-math.sin(a), math.cos(a), 0.0)


def _facet(deg):
    a = math.radians(deg)
    return (math.cos(a), math.sin(a), 0.0), (-math.sin(a), math.cos(a), 0.0)


def _subdivide(loop, step):
    """Insert points so no edge of a closed 2D loop is longer than step."""
    out = []
    for i, p in enumerate(loop):
        q = loop[(i + 1) % len(loop)]
        n = max(1, int(math.ceil(math.hypot(q[0] - p[0], q[1] - p[1]) / step)))
        out.extend((p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n)
                   for k in range(n))
    return out


def _isogrid(mb, poly, origin, e1, e2, nrm, spacing, rib_w, rib_h,
             hole_r=0.0, frame=True):
    """Triangular isogrid ribs clipped to a convex 2D polygon (CCW, in the
    e1/e2 plane at origin), optionally with a round hole about the origin.
    Ribs stand rib_h proud along `nrm`."""
    def P(x, y, h=0.0):
        return _add(_add(_add(_t3(origin), _mul(e1, x)), _mul(e2, y)), _mul(nrm, h))
    n = len(poly)
    for th in (0.0, math.pi / 3, 2 * math.pi / 3):
        d = (math.cos(th), math.sin(th))
        nn = (-d[1], d[0])
        offs = [p[0] * nn[0] + p[1] * nn[1] for p in poly]
        for kk in range(int(math.ceil(min(offs) / spacing)),
                        int(math.floor(max(offs) / spacing)) + 1):
            c = kk * spacing
            base = (nn[0] * c, nn[1] * c)
            t0, t1 = -1e9, 1e9
            for i in range(n):                        # Cyrus-Beck clip
                a, b = poly[i], poly[(i + 1) % n]
                inward = (-(b[1] - a[1]), b[0] - a[0])
                num = inward[0] * (base[0] - a[0]) + inward[1] * (base[1] - a[1])
                den = inward[0] * d[0] + inward[1] * d[1]
                if abs(den) < 1e-12:
                    if num < 0:
                        t0, t1 = 1, 0
                    continue
                t = -num / den
                if den > 0:
                    t0 = max(t0, t)
                else:
                    t1 = min(t1, t)
            if t1 - t0 < 0.04:
                continue
            spans = [(t0, t1)]
            if hole_r > 0 and abs(c) < hole_r:
                th_ = math.sqrt(hole_r * hole_r - c * c)
                spans = [(t0, min(t1, -th_)), (max(t0, th_), t1)]
            for s0, s1 in spans:
                if s1 - s0 < 0.04:
                    continue
                mb.beam(P(base[0] + d[0] * s0, base[1] + d[1] * s0, rib_h / 2),
                        P(base[0] + d[0] * s1, base[1] + d[1] * s1, rib_h / 2),
                        rib_w, rib_h, up=nrm)
    if frame:
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            mb.beam(P(a[0], a[1], rib_h / 2), P(b[0], b[1], rib_h / 2),
                    rib_w * 2.2, rib_h, up=nrm)


def _inset(poly, d):
    """Offset a convex 2D polygon (either winding) inward by d."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1]
               for i in range(n))
    sg = 1.0 if area > 0 else -1.0
    lines = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ex, ey)
        nx, ny = -ey / L * sg, ex / L * sg
        lines.append(((a[0] + nx * d, a[1] + ny * d), (ex / L, ey / L)))
    out = []
    for i in range(n):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-9:
            out.append(p2)
            continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
        out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out
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
        verts=128, mat=M("ULE_Glass"))

    # AMS: 0.28 m ribbed composite box-panel structure  [PUB]
    cyl("AMS.Structure", float(D.AMS_DIA), float(D.AMS_THICK), ams_bot,
        c, n, verts=96, mat=M("Composite"))
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
        ams_top, c, n, verts=64, mat=M("Baffle_Black"))

    # ---- Forward Structure Assembly (FMS hoop + alignment drives) --------
    c = COLLS["TEL.ForwardStructureAssembly"]
    nf = empty("N.ForwardStructureAssembly", (0, 0, pm_z), c, root, 0.8)
    tube("FMS.Hoop", float(D.FMS_DIA), float(D.FMS_H), pm_z, 0.04, c, nf,
         verts=128, mat=M("Composite"))

    for i in range(int(D.FMS_ALIGN_DRIVES)):  # six actuators  [PUB]
        a = 2 * math.pi * i / int(D.FMS_ALIGN_DRIVES)
        cyl(f"FMS.AlignmentDrive.{i+1}", 0.09, 0.18, pm_z + float(D.FMS_H),
            c, nf, verts=16, mat=M("Structure_White"),
            xy=(float(D.SM_BASE_RADIUS) * math.cos(a),
                float(D.SM_BASE_RADIUS) * math.sin(a)))
    # heaters around the PM perimeter  [PUB]
    tube("FMS.PerimeterHeaters", float(D.FMS_DIA) * 0.985, 0.05, pm_z + 0.02,
         0.03, c, nf, verts=128, mat=M("Structure_White"))

    # ---- Secondary Mirror Assembly + hexapod -----------------------------
    # Strut length is PUBLISHED at ~2.4 m. Solve the rise; do not guess it.
    c = COLLS["TEL.SecondaryMirrorAssembly"]
    sm_z = float(D.SM_Z)
    ns = empty("N.SecondaryMirrorAssembly", (0, 0, sm_z), c, root, 0.5, 'SPHERE')

    base_z = pm_z + float(D.FMS_H)
    br, tr = float(D.SM_BASE_RADIUS), float(D.SM_TOP_RADIUS)
    # Three V-pairs, one on the sun side, as V006 F shows them [S13]: feet
    # spread wide on the hoop, heads drawn together at the secondary. The
    # tangential turn of each strut (foot half-angle - head half-angle) is
    # the skew the rise was SOLVED with in roman_dims; build with anything
    # else and the struts come out the wrong length (v2 did: 2.360 m
    # against a published 2.400 m).
    fh = math.radians(float(D.SM_PAIR_FOOT_HALF_DEG))
    hh = math.radians(float(D.SM_PAIR_HEAD_HALF_DEG))
    strut_top_z = base_z + float(D.SM_RISE)
    lengths = []
    ends = []
    for pc in D.SM_PAIR_CENTRES_DEG:
        for sgn in (-1, 1):
            ends.append((math.radians(pc) + sgn * fh, math.radians(pc) + sgn * hh))
    for i, (a_b, a_t) in enumerate(ends[:int(D.SM_STRUTS)]):
        p0 = (br * math.cos(a_b), br * math.sin(a_b), base_z)
        p1 = (tr * math.cos(a_t), tr * math.sin(a_t), strut_top_z)
        lengths.append((Vector(p1) - Vector(p0)).length)
        strut(f"SMA.Strut.{i+1}", p0, p1, float(D.SM_STRUT_DIA), c, ns,
              M("Composite"))
        # stray-light scrapers bonded under the strut blankets  [PUB]:
        # thin blades lying along each strut, on its outboard side
        mb = MeshBuilder()
        out = _unit((math.cos((a_b + a_t) / 2), math.sin((a_b + a_t) / 2), 0.0))
        q0 = _add(_lerp(p0, p1, 0.18), _mul(out, 0.035))
        q1 = _add(_lerp(p0, p1, 0.82), _mul(out, 0.035))
        mb.beam(q0, q1, 0.012, 0.06, up=out)
        mb.build(f"SMA.Scraper.{i+1}", c, ns, M("Baffle_Black"))

    print(f"[ota] hexapod strut lengths {min(lengths):.3f}-{max(lengths):.3f} m "
          f"(published ~{float(D.SM_STRUT_LEN):.2f} m)")

    conic_mirror("SMA.Mirror", float(D.SM_DIA), 1.60, -1.8, sm_z, c, ns,
                 M("Mirror"), flip=True)
    cyl("SMA.Housing", float(D.SM_DIA) * 1.25, 0.20, sm_z, c, ns,
        verts=64, mat=M("MLI_Silver"))
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
    fr = float(D.FOA_FOOT_RADIUS)
    for i in range(int(D.FOA_STRUTS)):
        a = 2 * math.pi * i / int(D.FOA_STRUTS)
        aa = a + (0.20 if i % 2 == 0 else -0.20)
        foot = (fr * math.cos(aa), fr * math.sin(aa), ic_top)
        head = (float(D.AMS_DIA) * 0.45 * math.cos(a),
                float(D.AMS_DIA) * 0.45 * math.sin(a), ams_bot)
        strut(f"FOA.Strut.{i+1}", foot, head,
              float(D.FOA_STRUT_DIA), c, ni, M("Composite"))
        # bearings at each strut end  [PUB] -- v2 put both at the foot
        for tag, p in (("lo", foot), ("hi", head)):
            cyl(f"FOA.Bearing.{i+1}.{tag}", 0.07, 0.05, p[2] - 0.025, c, ni,
                verts=16, mat=M("Structure_White"), xy=(p[0], p[1]))


# ===========================================================================
# SPACECRAFT + INSTRUMENTS  --  shaped against NASA's V006 renders [S13]
# ===========================================================================
#
# Shared stations. Blender frame: +Z boresight, -Y sun side, and "height"
# in the comments below means distance toward the Sun (h = -y).

X_AX, Y_AX, Z_AX = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)


def _g():
    """Numbers several builders share, read fresh from roman_dims."""
    R_oba = float(D.OBA_DIA) / 2
    R_bus = float(D.BUS_ACROSS_CORNERS) / 2
    g = dict(
        R_oba=R_oba, A_oba=R_oba * _SQ3 / 2,
        R_bus=R_bus, A_bus=R_bus * _SQ3 / 2,
        z_bus0=float(D.BUS_Z0), z_bus1=float(D.BUS_Z0) + float(D.BUS_H),
        z_stand0=float(D.OBA_Z0),
        z_barrel0=float(D.OBA_Z0) + float(D.STAND_H),
        z_front=float(D.OBA_Z0) + float(D.OBA_H),
        bore=float(D.OBA_BORE_DIA) / 2,
    )
    g["z_ring"] = g["z_front"] - float(D.OBA_RING_T)
    # sun shield centre-plane, above the shroud's sun-side flat, and the
    # lower sun shade's plane just over the bus, under the array's aft row
    g["roof_y"] = -(g["A_oba"] + float(D.SASS_STANDOFF))
    g["liss_y"] = -(g["A_bus"] + float(D.LISS_STANDOFF))
    return g


def build_lva(root):
    c = COLLS["OSS.LaunchVehicleAdapter"]
    z0 = float(D.LVA_Z0)
    n = empty("N.LaunchVehicleAdapter", (0, 0, z0), c, root)
    r, rf, h, w = (float(D.LVA_DIA_TOP) / 2, float(D.LVA_DIA_BOTTOM) / 2,
                   float(D.LVA_H), 0.07)
    mb = MeshBuilder()
    # a short separation ring with a flange, CCW in (r, s)
    mb.lathe([(r - w, 0.0), (rf, 0.0), (rf, 0.035), (r, 0.06), (r, h - 0.02),
              (r + 0.02, h - 0.02), (r + 0.02, h), (r - w, h)],
             (0, 0, z0), Z_AX, n=128)
    for k in range(36):                              # flange bolt bosses
        a = 2 * math.pi * (k + 0.5) / 36
        mb.box(_polar(rf - 0.035, a, z0 + 0.045), (0.03, 0.03, 0.02),
               ((math.cos(a), math.sin(a), 0), (-math.sin(a), math.cos(a), 0), Z_AX))
    mb.build("LVA.Adapter", c, n, M("Composite"))


def build_bus(root):
    G = _g()
    c = COLLS["OSS.PrimaryStructure"]
    z0, zt, R, A = G["z_bus0"], G["z_bus1"], G["R_bus"], G["A_bus"]
    z1 = z0 + float(D.BUS_BOX_H)                     # top of the closed box
    n = empty("N.Bus", (0, 0, z0), c, root)

    # The prism itself. Built rather than taken from a 6-vertex cylinder:
    # Blender's primitive starts its circle on +Y, which puts FLATS on +-X;
    # V006 B shows corners there.
    mb = MeshBuilder()
    mb.prism(_hex_corners(R), (0, 0, z0), X_AX, Y_AX, Z_AX, z1 - z0)
    mb.build("BUS.Hex", c, n, M("MLI_Silver"), bevel=True)

    # Radiators on the three anti-sun faces, with heat-pipe ribs.
    mb = MeshBuilder()
    zc = z0 + (z1 - z0) * 0.52
    for k in (0, 1, 2):                              # faces at 30, 90, 150 deg
        nrm, tan = _hex_face(k)
        base = _add(_mul(nrm, A + 0.015), (0, 0, zc))
        mb.box(base, (0.03, R * 0.80, (z1 - z0) * 0.70), (nrm, tan, Z_AX))
        for j in range(7):
            u = (j - 3) * R * 0.11
            mb.box(_add(_add(base, _mul(nrm, 0.02)), _mul(tan, u)),
                   (0.015, 0.035, (z1 - z0) * 0.66), (nrm, tan, Z_AX))
    mb.build("BUS.Radiator", c, n, M("Radiator"))

    # Frames, corner posts, bay seams, avionics boxes, LISS hinge arms.
    # Forward of the closed box the corner posts carry on as the open
    # instrument bay's frame, up to the top deck under the telescope.
    mb = MeshBuilder()
    for k in range(6):
        cx, cy = _hex_corner(R, k)
        radial = _unit((cx, cy, 0.0))
        mb.beam((cx, cy, z0), (cx, cy, zt), 0.08, 0.08, up=radial)
        nrm, tan = _hex_face(k)
        p0 = _hex_corner(R, k)
        p1 = _hex_corner(R, k + 1)
        for zz in (z0 + 0.04, z1 - 0.04, z0 + (z1 - z0) * 0.5, zt - 0.05):
            off = _mul(nrm, 0.02)
            mb.beam(_add((p0[0], p0[1], zz), off), _add((p1[0], p1[1], zz), off),
                    0.07, 0.05, up=nrm)
        # the bay's faces: a diagonal on each, the lower flanks excepted --
        # the WFI and CGI enclosures stand there
        if k in (1, 3, 4, 5):
            mb.rod(_add((p0[0], p0[1], z1), _mul(nrm, -0.05)),
                   _add((p1[0], p1[1], zt), _mul(nrm, -0.05)), 0.03, n=8)
    # boxes on the sun-side flanks (faces 210 and 330 deg); the TCE sits on
    # 330 deg, so its neighbours keep clear of it
    for k, zs in ((3, (0.40, 0.80, 1.15)), (5, (0.30, 1.20))):
        nrm, tan = _hex_face(k)
        for m, zz in enumerate(zs):
            u = (-0.35, 0.30, -0.10)[m % 3]
            mb.box(_add(_add(_mul(nrm, A + 0.07), _mul(tan, u)), (0, 0, z0 + zz)),
                   (0.14, 0.36, 0.28), (nrm, tan, Z_AX))
    # aft-deck avionics: the column of units V006 B shows below the boom
    for x, y, sx, sy in ((0.0, -0.35, 0.22, 0.20), (0.05, -0.62, 0.16, 0.22),
                         (-0.18, 0.18, 0.22, 0.30), (0.20, 0.30, 0.20, 0.26),
                         (0.02, 0.62, 0.16, 0.30), (-0.62, 0.55, 0.30, 0.26),
                         (0.66, 0.55, 0.30, 0.26)):
        mb.box((x, y, z0 - 0.06), (sx, sy, 0.12))
    mb.build("BUS.Detail", c, n, M("Structure_White"))

    # Isogrid: the aft deck's ring between hexagon and adapter, and the
    # open shear panels on the sun side of the bay above the bus.
    mb = MeshBuilder()
    Ri = R - 0.06
    _isogrid(mb, _hex_corners(Ri), (0, 0, z0), X_AX, Y_AX, (0, 0, -1.0),
             spacing=0.26, rib_w=0.022, rib_h=0.03,
             hole_r=float(D.LVA_DIA_BOTTOM) / 2 + 0.04)
    mb.lathe([(float(D.LVA_DIA_BOTTOM) / 2 + 0.02, -0.035),
              (float(D.LVA_DIA_BOTTOM) / 2 + 0.07, -0.035),
              (float(D.LVA_DIA_BOTTOM) / 2 + 0.07, 0.0),
              (float(D.LVA_DIA_BOTTOM) / 2 + 0.02, 0.0)],
             (0, 0, z0), Z_AX, n=96)
    Rs = (G["R_bus"] + G["R_oba"]) / 2 - 0.07
    zb0, zb1 = z1 + 0.08, G["z_barrel0"] - 0.10       # the whole open bay
    for k in (1, 3, 4, 5):                            # 90, 210, 270, 330 deg
        nrm, tan = _hex_face(k)
        half = Rs / 2 - 0.10
        org = (nrm[0] * (Rs * _SQ3 / 2 - 0.08), nrm[1] * (Rs * _SQ3 / 2 - 0.08), 0.0)
        _isogrid(mb, [(-half, zb0), (half, zb0), (half, zb1), (-half, zb1)],
                 org, tan, Z_AX, _mul(nrm, -1.0), spacing=0.20,
                 rib_w=0.018, rib_h=0.03)
    mb.build("BUS.Isogrid", c, n, M("Composite"))

    # Propulsion: thruster pods at the aft deck's corners and under the
    # bus's forward end, where V006 B and L show them.
    mb = MeshBuilder()

    def pod(base, main):
        main = _unit(main)
        u, w = _frame(main)
        mb.box(base, (0.18, 0.18, 0.12), (u, w, main))
        for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            d = _unit(_add(main, _add(_mul(u, 0.5 * a), _mul(w, 0.5 * b))))
            p0 = _add(_add(base, _mul(main, 0.05)), _add(_mul(u, 0.05 * a), _mul(w, 0.05 * b)))
            mb.rod(p0, _add(p0, _mul(d, 0.13)), 0.018, n=12, r1=0.048)
    for sx in (1, -1):
        pod((sx * 0.72, -1.36, z0 - 0.07), (sx * 0.12, -0.10, -1.0))
        pod((sx * 0.92, 1.30, z0 - 0.07), (sx * 0.12, 0.12, -1.0))
        pod((sx * 0.72, A + 0.07, z1 + 0.55), (0.0, 1.0, 0.25))
    mb.build("PROP.Thrusters", c, n, M("Structure_White"))

    # Attitude control: star trackers with their baffles, on the aft
    # sun-side corners, looking aft and outboard.
    for i, (k, zz, u, look) in enumerate((
            (3, 0.55, -0.30, (-0.72, -0.25, -0.62)),
            (3, 1.00, 0.30, (-0.30, 0.10, -0.95)),
            (5, 0.70, 0.30, (0.30, -0.15, -0.94)))):
        nrm, tan = _hex_face(k)
        base = _add(_add(_mul(nrm, A + 0.05), _mul(tan, u)), (0, 0, z0 + zz))
        d = _unit(look)
        mb = MeshBuilder()
        mb.box(base, (0.24, 0.24, 0.10), (nrm, tan, Z_AX))
        mb.lathe([(0.0, 0.0), (0.09, 0.0), (0.09, 0.22), (0.10, 0.22),
                  (0.17, 0.46), (0.155, 0.46), (0.085, 0.25), (0.0, 0.25)],
                 _add(base, _mul(d, 0.04)), d, n=24)
        mb.build(f"ACS.StarTracker.{i+1}", c, n, M("Structure_White"))

    # Telescope Control Electronics: 17 boards, on the spacecraft element [PUB]
    # TCE is a TELESCOPE subpart [S6] though physically mounted on the
    # spacecraft element [S3]. Filed under Telescope, built where it sits:
    # on the bus's sun-side +X flank, clear of the LISS arms.
    tc = COLLS["TEL.TelescopeControlElectronics"]
    nrm, tan = _hex_face(5)
    p = _add(_mul(nrm, A + 0.15), (0, 0, z0 + 0.75))
    box("TCE.Chassis", (0.30, 0.45, 0.55), p, tc, n, M("Structure_White"),
        rot=(0, 0, math.radians(330)))


def build_comms(root):
    """The HGA as V006 shows it [S13]: a boom rising from the aft, sun-side
    edge of the bus past the sun shield, a two-axis gimbal, and a 1.7 m
    ribbed dish above the roof with its bowl toward the Sun and Earth. The
    whole assembly is one deployable about the boom's root hinge."""
    G = _g()
    c = COLLS["COMMUNICATIONS"]
    pivot = (0.0, -(G["A_bus"] + 0.06), float(D.HGA_ROOT_Z))
    n = empty("N.Comms", pivot, c, root)
    tilt = math.radians(float(D.HGA_BOOM_TILT_DEG))
    L = float(D.HGA_BOOM_LEN)
    bdir = (0.0, -math.cos(tilt), math.sin(tilt))
    tip = _add(pivot, _mul(bdir, L))
    hga = []

    mb = MeshBuilder()             # built, not a primitive: exact in the harness
    mb.rod(pivot, tip, float(D.HGA_BOOM_DIA) / 2, n=20)
    hga.append(mb.build("HGA.Boom", c, n, M("Composite")))
    mb = MeshBuilder()                                # boom hardware
    for s in (0.30, 0.62, 0.90):
        p = _add(pivot, _mul(bdir, s * L))
        mb.rod(_sub(p, _mul(bdir, 0.04)), _add(p, _mul(bdir, 0.04)),
               float(D.HGA_BOOM_DIA) * 0.75, n=16)
    for sx in (1, -1):                                # root clevis
        mb.box(_add(pivot, (sx * 0.08, 0.02, 0.0)), (0.03, 0.16, 0.20))
    mb.rod(_add(pivot, (-0.12, 0, 0)), _add(pivot, (0.12, 0, 0)), 0.03, n=12)
    mb.box(_add(_add(pivot, _mul(bdir, 0.45 * L)), (0.09, 0, 0)), (0.10, 0.18, 0.12))
    hga.append(mb.build("HGA.BoomFittings", c, n, M("Structure_White")))

    gd = float(D.HGA_GIMBAL_DIA)
    mb = MeshBuilder()
    mb.rod(_sub(tip, _mul(bdir, 0.02)), _add(tip, _mul(bdir, 0.12)), gd / 2, n=24)
    hga.append(mb.build("HGA.GimbalAzimuth", c, n, M("Structure_White")))
    eg = _add(tip, (0.0, -0.20, 0.08))                # elevation axis along X
    mb = MeshBuilder()
    mb.rod(_add(eg, (-0.17, 0, 0)), _add(eg, (0.17, 0, 0)), gd * 0.36, n=24)
    for sx in (1, -1):
        mb.box(_add(eg, (sx * 0.15, 0.05, 0.0)), (0.03, 0.22, 0.16))
    mb.box(_add(eg, (0.0, -0.10, 0.0)), (0.22, 0.06, 0.22))
    hga.append(mb.build("HGA.GimbalElevation", c, n, M("Structure_White")))

    # dish: a closed paraboloidal shell, CCW profile (r, s) along the bowl
    # axis, so it cannot vanish under backface culling from behind
    axis = (0.0, -1.0, 0.0)
    R, dep, t = float(D.HGA_DISH_DIA) / 2, float(D.HGA_DISH_DEPTH), 0.025
    vtx = _add(eg, (0.0, -0.16, 0.0))
    NR = 24
    front = [(R * i / NR, dep * (i / NR) ** 2) for i in range(NR + 1)]
    back = [(r, s - t) for r, s in front]
    prof = back + list(reversed(front))               # CCW: out along the back, in along the bowl
    mb = MeshBuilder()
    mb.lathe(prof, vtx, axis, n=96)
    hga.append(mb.build("HGA.Dish", c, n, M("HGA_Carbon")))

    # ribs on the dish's back, a rim ring and the central hub
    mb = MeshBuilder()
    u, w = _frame(axis)
    nribs = int(D.HGA_DISH_RIBS)
    for k in range(nribs):
        a = 2 * math.pi * k / nribs
        e = _add(_mul(u, math.cos(a)), _mul(w, math.sin(a)))
        pts = []
        for j in range(7):
            rr = R * (0.12 + 0.87 * j / 6)
            s = dep * (rr / R) ** 2 - t
            slope = 2 * dep * rr / (R * R)
            nb = _unit(_sub(_mul(e, slope), axis))    # back-side normal
            pts.append((_add(_add(vtx, _mul(axis, s)), _mul(e, rr)), nb))
        for (p0, n0), (p1, n1) in zip(pts, pts[1:]):
            nm = _unit(_add(n0, n1))
            mb.beam(_add(p0, _mul(n0, 0.022)), _add(p1, _mul(n1, 0.022)),
                    0.016, 0.044, up=nm)
    mb.lathe([(R - 0.02, dep - 0.07), (R + 0.015, dep - 0.07),
              (R + 0.015, dep + 0.005), (R - 0.02, dep + 0.005)], vtx, axis, n=96)
    mb.lathe([(0.0, -t - 0.10), (0.16, -t - 0.10), (0.18, -t), (0.0, -t)],
             vtx, axis, n=32)
    hga.append(mb.build("HGA.DishRibs", c, n, M("HGA_Carbon")))

    f = float(D.HGA_DISH_DIA) ** 2 / (16 * dep)       # focal length
    feed_base = _add(vtx, _mul(axis, f - 0.12))
    for k in range(int(D.HGA_FEED_STRUTS)):
        a = math.pi / 4 + k * math.pi / 2
        rim = _add(_add(vtx, _mul(axis, dep * 0.96)),
                   _add(_mul(u, R * 0.93 * math.cos(a)), _mul(w, R * 0.93 * math.sin(a))))
        hga.append(strut(f"HGA.FeedStrut.{k+1}", rim, feed_base, 0.022, c, n,
                         M("HGA_Carbon")))
    mb = MeshBuilder()
    mb.lathe([(0.0, 0.0), (0.05, 0.0), (0.05, 0.08), (0.09, 0.16), (0.0, 0.16)],
             feed_base, axis, n=24)
    hga.append(mb.build("HGA.Feed", c, n, M("Structure_White")))

    for o in hga:
        _deployable(o, pivot, 'X', float(D.HGA_STOWED_DEG))

    # low-gain antennas: one on the aft deck, one on the bus's sun-side top
    for i, (base, d) in enumerate((((0.55, 1.05, G["z_bus0"]), (0, 0, -1.0)),
                                   ((0.45, -G["A_bus"], G["z_bus0"] + 0.12), (0, -1.0, 0)))):
        mb = MeshBuilder()
        mb.lathe([(0.0, 0.0), (float(D.LGA_DIA) / 2, 0.0),
                  (float(D.LGA_DIA) / 2 * 0.65, 0.20), (0.0, 0.21)],
                 base, d, n=24)
        mb.build(f"LGA.{i+1}", c, n, M("Structure_White"))

    # RF communications electronics on the aft deck, where V006 B's comms
    # overlay puts them
    mb = MeshBuilder()
    z0 = G["z_bus0"]
    for x, y, sx, sy in ((0.52, -0.80, 0.34, 0.40), (-0.62, -0.80, 0.16, 0.26),
                         (-0.32, -0.80, 0.16, 0.26), (-0.85, -0.22, 0.32, 0.30),
                         (-0.45, -0.22, 0.30, 0.32), (0.42, -0.22, 0.30, 0.30),
                         (0.84, -0.22, 0.28, 0.28)):
        mb.box((x, y, z0 - 0.07), (sx, sy, 0.14))
        mb.box((x, y - sy / 2 + 0.04, z0 - 0.16), (sx * 0.5, 0.04, 0.04))
    mb.build("COMMS.Electronics", c, n, M("MLI_Silver"))


def build_oba(root):
    """The Outer Barrel Assembly as V006 shows it [S13]: a hexagonal shroud,
    corners at +-X and a flat under the sun shield, around a round bore; four
    external frames; a front ring whose lower edge follows the hex down to a
    stepped keel; all on a short open truss bay -- the 'elephant stand' [S2]
    -- that meets the bus's top deck."""
    G = _g()
    c = COLLS["TEL.OuterBarrelAssembly"]
    n = empty("N.OuterBarrelAssembly", (0, 0, G["z_stand0"]), c, root, 1.0)
    R, A, rb = G["R_oba"], G["A_oba"], G["bore"]
    zs0, zb0, zr, zf = G["z_stand0"], G["z_barrel0"], G["z_ring"], G["z_front"]

    # ---- the stand: six corner longerons + the truss that braces them ----
    for k in range(int(D.STAND_LEGS)):
        a = math.radians(60 * k)
        strut(f"OBA.StandLeg.{k+1}",
              _polar(G["R_bus"] - 0.07, a, zs0), _polar(R - 0.07, a, zb0),
              float(D.STAND_LEG_DIA), c, n, M("Composite"))
    mb = MeshBuilder()
    lo, hi = zs0 + 0.07, zb0 - 0.07
    for k in range(6):
        a0, a1 = math.radians(60 * k), math.radians(60 * (k + 1))
        b0, b1 = _polar(G["R_bus"] - 0.07, a0, lo), _polar(G["R_bus"] - 0.07, a1, lo)
        t0, t1 = _polar(R - 0.07, a0, hi), _polar(R - 0.07, a1, hi)
        mb.rod(b0, b1, 0.04, n=10)
        mb.rod(t0, t1, 0.04, n=10)
        if k in (1, 3, 4, 5):     # the lower-flank faces carry the WFI and CGI
            mb.rod(b0, t1, 0.035, n=10)
            mb.rod(b1, t0, 0.035, n=10)
            mid = _lerp(_lerp(b0, t1, 0.5), _lerp(b1, t0, 0.5), 0.5)
            mb.box(mid, (0.10, 0.10, 0.10))
        for p in (b0, t0):
            mb.box(p, (0.13, 0.13, 0.12))
    # keel struts: the front ring's keel braced back to the barrel's belly
    keel_y = float(D.OBA_KEEL_DEPTH) - 0.50
    for sx in (1, -1):
        mb.rod((sx * 0.25, keel_y, zr - 0.05),
               (sx * 0.55, A + 0.05, zb0 + (zr - zb0) * 0.55), 0.035, n=10)
    mb.build("OBA.Truss", c, n, M("Composite"))

    # ---- the shroud: hexagon outside, round bore inside, one closed solid.
    # Sampled at matching angles so the hex corners are exact vertices.
    mb = MeshBuilder()
    N = 96
    ang = [2 * math.pi * j / N for j in range(N)]
    o0 = [mb.v(_polar(_hex_r(R, a), a, zb0)) for a in ang]
    o1 = [mb.v(_polar(_hex_r(R, a), a, zr)) for a in ang]
    i0 = [mb.v(_polar(rb, a, zb0)) for a in ang]
    i1 = [mb.v(_polar(rb, a, zr)) for a in ang]
    for j in range(N):
        k = (j + 1) % N
        radial = _polar(1.0, 2 * math.pi * (j + 0.5) / N)
        mb.face([o0[j], o0[k], o1[k], o1[j]], want=radial)
        mb.face([i0[j], i0[k], i1[k], i1[j]], want=_mul(radial, -1.0))
        mb.face([o0[j], o0[k], i0[k], i0[j]], want=(0, 0, -1.0))
        mb.face([o1[j], o1[k], i1[k], i1[j]], want=(0, 0, 1.0))
    mb.build("OBA.Barrel", c, n, M("MLI_Barrel"))

    # ---- front ring: the visor's footprint above, the hex below, a keel.
    W0 = float(D.DAC_DIA_BASE) / 2 + 0.04
    E0, A0 = float(D.DAC_EAVE_H) + 0.03, float(D.DAC_APEX_H) + 0.05
    hb = -float(D.DAC_WALL_BOTTOM)
    kd = float(D.OBA_KEEL_DEPTH)
    bot = -(A + 0.07)                                  # just below the hex's belly
    # keel: a wide step, then a narrow tongue (V006 F, camera-fitted)
    half = [(0.0, A0), (W0, E0), (W0, hb), (R / 2 + 0.30, bot), (0.93, bot),
            (0.93, -(kd - 0.40)), (0.24, -(kd - 0.40)), (0.24, -kd)]
    outline = half + [(-x, h) for x, h in reversed(half) if x > 0]
    outline = [(x, -h) for x, h in outline]           # height -> Blender y
    outline = _subdivide(outline, 0.16)
    hole = [(rb * math.cos(2 * math.pi * j / 128), rb * math.sin(2 * math.pi * j / 128))
            for j in range(128)]
    mb = MeshBuilder()
    mb.plate_with_hole(outline, hole, (0, 0, zr), X_AX, Y_AX, Z_AX, zf - zr)
    mb.build("OBA.FrontRing", c, n, M("MLI_Barrel"))

    # ---- external frames and corner longerons -------------------------------
    mb = MeshBuilder()
    Lb = zr - zb0
    for fr in tuple(D.OBA_FRAME_STATIONS) + (1.0,):
        zc = zb0 + 0.05 + fr * (Lb - 0.10)
        for k in range(6):
            nrm, tan = _hex_face(k)
            p0, p1 = _hex_corner(R, k), _hex_corner(R, k + 1)
            e = _unit((p1[0] - p0[0], p1[1] - p0[1], 0.0))
            off = _mul(nrm, 0.03)
            mb.beam(_add(_sub((p0[0], p0[1], zc), _mul(e, 0.03)), off),
                    _add(_add((p1[0], p1[1], zc), _mul(e, 0.03)), off),
                    0.10, 0.06, up=nrm)
    for k in range(6):
        cx, cy = _hex_corner(R, k)
        mb.beam((cx, cy, zb0), (cx, cy, zr), 0.09, 0.09, up=_unit((cx, cy, 0.0)))
    mb.build("OBA.Frames", c, n, M("MLI_Silver"))

    # ---- brackets and fittings: frame/corner nodes, keel fittings ----------
    mb = MeshBuilder()
    for fr in D.OBA_FRAME_STATIONS:
        zc = zb0 + 0.05 + fr * (Lb - 0.10)
        for k in range(6):
            cx, cy = _hex_corner(R, k)
            rad = _unit((cx, cy, 0.0))
            tan = (-rad[1], rad[0], 0.0)
            mb.box(_add((cx, cy, zc), _mul(rad, 0.06)), (0.10, 0.14, 0.16),
                   (rad, tan, Z_AX))
            mb.rod(_add((cx, cy, zc - 0.10), _mul(rad, 0.09)),
                   _add((cx, cy, zc + 0.10), _mul(rad, 0.09)), 0.025, n=8)
        for k in range(6):                            # mid-face clips
            nrm, tan = _hex_face(k)
            mb.box(_add(_mul(nrm, A + 0.07), (0, 0, zc)), (0.05, 0.22, 0.12),
                   (nrm, tan, Z_AX))
    for x in (-0.62, -0.30, 0.30, 0.62):             # keel fittings, aft side
        mb.box((x, kd - 0.55, zr - 0.07), (0.16, 0.20, 0.14))
        mb.rod((x, kd - 0.55, zr - 0.14), (x, kd - 0.55, zr - 0.30), 0.03, n=10)
    for sx in (1, -1):
        mb.box((sx * 0.12, kd - 0.14, zr - 0.08), (0.14, 0.18, 0.16))
        mb.box((sx * 1.05, A + 0.12, zr - 0.08), (0.20, 0.16, 0.16))   # corner tabs
    mb.build("OBA.Brackets", c, n, M("Structure_White"))

    # Aft closeout: an annulus at the primary's rim, from just outside the
    # forward metering hoop to the bore wall, so the bore reads closed
    # behind the mirror, as V006 F does, instead of open onto the bay.
    mb = MeshBuilder()
    zc = float(D.PM_Z) - 0.06
    ring = lambda r, n: [(r * math.cos(2 * math.pi * j / n), r * math.sin(2 * math.pi * j / n))
                         for j in range(n)]
    mb.plate_with_hole(ring(rb + 0.02, 128), ring(float(D.FMS_DIA) / 2 + 0.03, 128),
                       (0, 0, zc), X_AX, Y_AX, Z_AX, 0.03)
    mb.build("OBA.AftCloseout", c, n, M("Baffle_Black"))

    # Annular vanes, not discs: a solid disc here would block the beam.
    nv = int(D.OBA_VANES)
    for i in range(nv):
        tube(f"OBA.Baffle.{i+1}", 2 * rb, 0.02, zr - 0.14 - i * 0.24,
             float(D.OBA_VANE_W), c, n, verts=128, mat=M("Baffle_Black"))


def build_dac(root):
    """The Deployable Aperture Cover as a gabled scoop [S6][S13].

    Soft membrane on three booms: one along the ridge, one along each eave.
    The section is a straight gable -- two roof panels, two side walls --
    and the mouth is cut on a slant: the walls from the end of their short
    lower edge up to the eave corners, the roof on to the ridge's tip. Each
    side's cut edge therefore runs
    skirt -> eave corner -> ridge tip, the kinked edge V006 L shows, and
    the eave booms end at the kink. The web viewer stows
    the cover by scaling its pivot along the axis about the base, which
    turns this into a short collar with the same slanted mouth.
    """
    G = _g()
    c = COLLS["TEL.DeployableApertureCover"]
    z0 = float(D.DAC_Z0)
    z1 = z0 + float(D.DAC_H_DEPLOYED if DEPLOYED else D.DAC_H_STOWED)
    k_len = (z1 - z0) / float(D.DAC_H_DEPLOYED)
    n = empty("N.DeployableApertureCover", (0, 0, z0), c, root, 1.0)
    W = float(D.DAC_DIA_BASE) / 2
    E, A = float(D.DAC_EAVE_H), float(D.DAC_APEX_H)
    hb = -float(D.DAC_WALL_BOTTOM)
    zk = z0 + float(D.DAC_SKIRT_LEN) * k_len

    ze = z0 + float(D.DAC_EAVE_REACH) * k_len          # eave corners

    def z_cut(h):                                     # the slanted mouth
        if h <= E:                                    # walls: skirt -> eave
            return zk + (h - hb) * (ze - zk) / (E - hb)
        return ze + (h - E) * (z1 - ze) / (A - E)     # roof: eave -> ridge tip

    # section, right half then left, as (x, h): wall bottom -> eave -> ridge
    MW, MR, NZ = 6, 6, 16
    half = [(W, hb + (E - hb) * r / MW) for r in range(MW)]
    half += [(W * (1 - q / MR), E + (A - E) * q / MR) for q in range(MR)]
    sec = [(x, h) for x, h in half] + [(0.0, A)] + [(-x, h) for x, h in reversed(half)]
    # outward hint per section edge: walls face +-X, roof faces up and out
    mb = MeshBuilder()
    grid = []
    for x, h in sec:
        ze_i = z_cut(h) if h > hb + 1e-9 else zk
        col = []
        # the wall bottom's line runs z0 -> zk; every other line z0 -> its cut
        for t in range(NZ + 1):
            col.append(mb.v((x, -h, z0 + (ze_i - z0) * t / NZ)))
        grid.append(col)
    for i in range(len(sec) - 1):
        (xa, ha), (xb, hb_) = sec[i], sec[i + 1]
        mx = (xa + xb) / 2
        if abs(xa - xb) < 1e-9:
            want = (1.0 if mx > 0 else -1.0, 0.0, 0.0)
        else:
            want = (0.45 if mx > 0 else -0.45, -0.9, 0.0)
        for t in range(NZ):
            mb.face([grid[i][t], grid[i + 1][t], grid[i + 1][t + 1], grid[i][t + 1]],
                    want=want)
    dac = mb.build("DAC.Membrane", c, n, M("Visor"))
    _wall(dac, 0.012)                                 # membrane, not structure

    # booms: the ridge's runs to the tip, the eaves' to the mouth
    zt = z1 - 0.05
    booms = [((0.0, -(A - 0.07), z0), (0.0, -(A - 0.07), zt))]
    for sx in (1, -1):
        booms.append(((sx * (W - 0.07), -(E - 0.03), z0),
                      (sx * (W - 0.07), -(E - 0.03), ze - 0.06)))
    for i, (p0, p1) in enumerate(booms[:int(D.DAC_BOOMS)]):
        strut(f"DAC.SupportBoom.{i+1}", p0, p1, float(D.DAC_BOOM_DIA), c, n,
              M("Composite"))

    # rim tubes on the mouth and the lower edges, boom-end fittings, base
    # attachment brackets and the wall-foot hinges V006 F shows
    mb = MeshBuilder()
    r_rim, ins = 0.022, 0.03
    for sx in (1, -1):
        xw = sx * (W - ins)
        mb.rod((xw, -hb, z0 + 0.02), (xw, -hb, zk), r_rim)
        mb.rod((xw, -hb, zk), (xw, -E, ze - ins), r_rim)
        mb.rod((xw, -E, ze - ins), (0.0, -(A - 0.02), z1 - ins), r_rim)
        mb.rod((xw, -hb, z0 + 0.03), (xw, -E, z0 + 0.03), r_rim)
        mb.rod((xw, -E, z0 + 0.03), (0.0, -A, z0 + 0.03), r_rim)
        mb.box((sx * (W - 0.10), -(hb + 0.08), z0 + 0.06), (0.14, 0.16, 0.10))
        mb.rod((sx * (W - 0.06), -(hb + 0.10), z0 + 0.02),
               (sx * (W - 0.06), -(hb + 0.10), z0 + 0.20), 0.05, n=12)
    for p0, p1 in booms:
        mb.lathe([(0.0, 0.0), (0.085, 0.0), (0.085, 0.045), (0.0, 0.045)],
                 _sub(p1, (0, 0, 0.02)), Z_AX, n=20)
        mb.box(_add(p0, (0, 0, 0.07)), (0.18, 0.18, 0.12))
    mb.build("DAC.Frame", c, n, M("Structure_White"))


def build_sass(root):
    """Six panels, three columns by two rows [S6][S7][S9], as a flat roof
    just proud of the shroud's sun-side flat [S13]. The centre column is
    that flat's width and fixed to it; each outer column is hinged at the
    flat's corner and folds down onto the sloping upper facet for launch."""
    G = _g()
    c = COLLS["SOLAR_ARRAY_SUN_SHIELD"]
    n = empty("N.SolarArraySunShield", (0, 0, float(D.SASS_Z0)), c, root, 1.0)
    cw = float(D.SASS_COL_W)
    ow = float(D.SASS_OUTER_W)
    rh = float(D.SASS_H) / int(D.SASS_ROWS)
    t = float(D.SASS_PANEL_T)
    gap = 0.03
    plane_y = G["roof_y"]
    fold = float(D.SASS_FOLD_DEG)
    ch = float(D.SASS_CHAMFER)
    det = MeshBuilder()

    for j in range(int(D.SASS_ROWS)):
        za = float(D.SASS_Z0) + j * rh + gap / 2
        zb = za + rh - gap
        zc = (za + zb) / 2
        box(f"SASS.Centre.{j+1}", (cw - gap, t, rh - gap), (0, plane_y, zc),
            c, n, M("SolarArray"))
        # the centre panels' underside frame and junction boxes
        yb = plane_y + t / 2 + 0.025
        for x0, x1, z_a, z_b in ((-cw / 2 + 0.03, cw / 2 - 0.03, za + 0.03, za + 0.03),
                                 (-cw / 2 + 0.03, cw / 2 - 0.03, zb - 0.03, zb - 0.03),
                                 (-cw / 2 + 0.03, -cw / 2 + 0.03, za + 0.03, zb - 0.03),
                                 (cw / 2 - 0.03, cw / 2 - 0.03, za + 0.03, zb - 0.03),
                                 (0.0, 0.0, za + 0.03, zb - 0.03)):
            det.beam((x0, yb, z_a), (x1, yb, z_b), 0.04, 0.05, up=(0, 1, 0))
        for x in (-0.55, 0.55):
            det.box((x, yb + 0.02, zc + 0.6), (0.20, 0.08, 0.14))
        # Standoff struts from the centre panels down to the barrel's flat.
        for sx in (-1, 1):
            strut(f"SASS.Standoff.{j+1}{'A' if sx < 0 else 'B'}",
                  (sx * cw * 0.28, plane_y + t / 2, zc), (sx * cw * 0.28, -G["A_oba"], zc),
                  0.05, c, n, M("Composite"))
        for sx in (1, -1):
            hinge_x = sx * cw / 2
            x_in, x_out = hinge_x + sx * gap / 2, hinge_x + sx * (gap / 2 + ow - gap)
            # outline in (x, z): chamfer the outboard corner at the array's ends
            cut_aft, cut_fore = (j == 0), (j == int(D.SASS_ROWS) - 1)
            poly = [(x_in, za)]
            if cut_aft:
                poly += [(x_out - sx * ch, za), (x_out, za + ch)]
            else:
                poly += [(x_out, za)]
            if cut_fore:
                poly += [(x_out, zb - ch), (x_out - sx * ch, zb)]
            else:
                poly += [(x_out, zb)]
            poly += [(x_in, zb)]
            mb = MeshBuilder()
            mb.prism(poly, (0, plane_y - t / 2, 0), X_AX, Z_AX, Y_AX, t)
            # its own underside rails, so they fold with it
            yr = plane_y + t / 2 + 0.02
            rp = _inset(poly, 0.035)                  # rails stay inside the edge
            for a, b in zip(rp, rp[1:] + rp[:1]):
                mb.beam((a[0], yr, a[1]), (b[0], yr, b[1]), 0.035, 0.04, up=(0, 1, 0))
            mb.beam(((x_in + x_out) / 2, yr, za + 0.05), ((x_in + x_out) / 2, yr, zb - 0.05),
                    0.035, 0.04, up=(0, 1, 0))
            lo_x, hi_x = min(x_in, x_out), max(x_in, x_out)
            panel = mb.build(f"SASS.Outer.{'PX' if sx > 0 else 'NX'}.{j+1}", c, n,
                             M("SolarArray"), fit=((0, lo_x, hi_x), (2, za, zb)),
                             bevel=True)
            ang = sx * math.radians(fold) if SASS_STOWED else 0.0
            if ang:
                panel.rotation_euler = (0, 0, ang)
            _deployable(panel, (hinge_x, plane_y, zc), 'Z', sx * fold)
            cyl(f"SASS.Hinge.{'PX' if sx > 0 else 'NX'}.{j+1}",
                0.05, rh * 0.9, zc - rh * 0.45, c, n,
                verts=12, mat=M("Structure_White"), xy=(hinge_x, plane_y))
            for zz in (za + 0.3, zc, zb - 0.3):       # hinge brackets
                det.box((hinge_x, plane_y + 0.06, zz), (0.10, 0.10, 0.10))
    # The array rides on the barrel's frames, as V006 L/R show: an A-frame
    # bracket up from each frame station at both top corners of the shroud.
    Lb = G["z_ring"] - G["z_barrel0"]
    yb, yt = -G["A_oba"], plane_y + t / 2 + 0.02
    for fr in D.OBA_FRAME_STATIONS:
        zc = G["z_barrel0"] + 0.05 + fr * (Lb - 0.10)
        if not float(D.SASS_Z0) < zc < float(D.SASS_Z0) + float(D.SASS_H):
            continue
        for sx in (1, -1):
            x0 = sx * (G["R_oba"] / 2 - 0.05)
            det.beam((x0, yb, zc - 0.16), (x0 - sx * 0.10, yt, zc), 0.06, 0.05, up=(1, 0, 0))
            det.beam((x0, yb, zc + 0.16), (x0 - sx * 0.10, yt, zc), 0.06, 0.05, up=(1, 0, 0))
            det.box((x0 - sx * 0.10, yt - 0.03, zc), (0.16, 0.06, 0.20))
    det.build("SASS.Detail", c, n, M("Structure_White"))


def build_liss(root):
    """Two 2.1 m panels [S6][S8] in the sun shield's plane over the bus
    [S13], hinged at the bus's sun-side corners and swung out to the
    array's span, as V006 draws them; for launch they fold down onto the
    bus's sloping upper facets."""
    G = _g()
    c = COLLS["OSS.LowerInstrumentSunShade"]
    z0 = float(D.LISS_Z0)
    n = empty("N.LowerInstrumentSunShade", (0, 0, z0), c, root, 0.6)
    lw, lh, lt = float(D.LISS_PANEL_W), float(D.LISS_PANEL_H), float(D.LISS_PANEL_T)
    y = G["liss_y"]
    ch = float(D.LISS_CHAMFER)
    for i, sx in enumerate((1, -1)):
        x_in = sx * (G["R_bus"] / 2 + 0.03)
        pivot_x = sx * G["R_bus"] / 2
        stowed = sx * float(D.LISS_OPEN_DEG)          # down onto the upper facet
        x_out = x_in + sx * lw
        poly = [(x_in, z0), (x_out - sx * ch, z0), (x_out, z0 + ch),
                (x_out, z0 + lh), (x_in, z0 + lh)]
        mb = MeshBuilder()
        mb.prism(poly, (0, y - lt / 2, 0), X_AX, Z_AX, Y_AX, lt)
        yr = y + lt / 2 + 0.02
        rp = _inset(poly, 0.035)
        for a, b in zip(rp, rp[1:] + rp[:1]):
            mb.beam((a[0], yr, a[1]), (b[0], yr, b[1]), 0.04, 0.04, up=(0, 1, 0))
        for f in (0.33, 0.66):
            xm = x_in + (x_out - x_in) * f
            mb.beam((xm, yr, z0 + 0.05), (xm, yr, z0 + lh - 0.05), 0.03, 0.035, up=(0, 1, 0))
        zc = z0 + lh / 2
        liss = mb.build(f"LISS.Panel.{i+1}", c, n, M("MLI_Silver"), bevel=True)
        _deployable(liss, (pivot_x, y, zc), 'Z', stowed)
        cyl(f"LISS.Hinge.{i+1}", 0.07, lh * 0.92, z0 + lh * 0.04, c, n,
            verts=12, mat=M("Composite"), xy=(pivot_x - sx * 0.005, y + 0.035))


def build_spacecraft(root):
    build_lva(root)
    build_bus(root)
    build_comms(root)
    build_oba(root)
    build_dac(root)
    build_sass(root)
    build_liss(root)


def build_instruments(root):
    G = _g()
    c = COLLS["INSTRUMENT_CARRIER"]
    n = empty("N.InstrumentCarrier", (0, 0, float(D.IC_Z0)), c, root)
    cyl("IC.Deck", float(D.IC_DIA), float(D.IC_H), float(D.IC_Z0), c, n,
        verts=96, mat=M("Composite"))
    ic_top = float(D.IC_Z0) + float(D.IC_H)
    mb = MeshBuilder()                                # units on the deck's sun half
    for deg, r, sz in ((205, 1.22, (0.34, 0.26, 0.30)), (232, 1.15, (0.28, 0.24, 0.22)),
                       (270, 1.20, (0.44, 0.30, 0.34)), (308, 1.15, (0.28, 0.24, 0.26)),
                       (335, 1.22, (0.34, 0.26, 0.30)), (270, 0.62, (0.30, 0.30, 0.18))):
        a = math.radians(deg)
        rad, tan = (math.cos(a), math.sin(a), 0.0), (-math.sin(a), math.cos(a), 0.0)
        mb.box(_polar(r, a, ic_top + sz[2] / 2), sz, (rad, tan, Z_AX))
    mb.build("IC.Boxes", c, n, M("MLI_Silver"))

    # ---- Wide Field Instrument: the anti-sun -X corner of the bay [S13] ---
    c = COLLS["WIDE_FIELD_INSTRUMENT"]
    n = empty("N.WideFieldInstrument",
              (*D.WFI_OFFSET, float(D.WFI_Z0)), c, root, 0.4)
    ws = tuple(D.WFI_SIZE)
    zb = float(D.INSTR_BOX_Z0)
    box("WFI.Body", ws, (D.WFI_OFFSET[0], D.WFI_OFFSET[1], zb + ws[2] / 2),
        c, n, M("MLI_Silver"),
        rot=(0, 0, math.radians(float(D.WFI_FACET_DEG))))
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
    # radiator on the outer face, and the stepped forward housing V006 R
    # shows running along the barrel's lower flank
    nrm, tan = _facet(float(D.WFI_FACET_DEG))
    rc = math.hypot(*D.WFI_OFFSET) + ws[0] / 2
    mb = MeshBuilder()
    mb.box(_add(_mul(nrm, rc + 0.02), (0, 0, zb + ws[2] / 2)),
           (0.04, ws[1] * 0.92, ws[2] * 0.90), (nrm, tan, Z_AX))
    for j in range(6):
        u = (j - 2.5) * ws[1] * 0.15
        mb.box(_add(_add(_mul(nrm, rc + 0.045), _mul(tan, u)), (0, 0, zb + ws[2] / 2)),
               (0.012, 0.03, ws[2] * 0.84), (nrm, tan, Z_AX))
    zf0 = zb + ws[2]
    mb.box(_add(_mul(nrm, G["A_oba"] + 0.07), (0, 0, zf0 + 0.45)),
           (0.14, ws[1] * 0.80, 0.90), (nrm, tan, Z_AX))
    mb.build("WFI.Radiator", c, n, M("Radiator"))

    # ---- Coronagraph: the anti-sun +X corner, mirroring the WFI [S13] -----
    c = COLLS["CORONAGRAPH_INSTRUMENT"]
    n = empty("N.CoronagraphInstrument",
              (*D.CGI_OFFSET, float(D.CGI_Z0)), c, root, 0.4)
    cs = tuple(D.CGI_SIZE)
    zb = float(D.INSTR_BOX_Z0)
    box("CGI.Body", cs, (D.CGI_OFFSET[0], D.CGI_OFFSET[1], zb + cs[2] / 2),
        c, n, M("MLI_Silver"),
        rot=(0, 0, math.radians(float(D.CGI_FACET_DEG))))
    nrm, tan = _facet(float(D.CGI_FACET_DEG))
    rc = math.hypot(*D.CGI_OFFSET) + cs[0] / 2
    mb = MeshBuilder()
    mb.box(_add(_mul(nrm, rc + 0.02), (0, 0, zb + cs[2] * 0.55)),
           (0.04, cs[1] * 0.85, cs[2] * 0.70), (nrm, tan, Z_AX))
    mb.box(_add(_add(_mul(nrm, 1.05), _mul(tan, 0.45)),
                (0, 0, float(D.CGI_Z0) + 0.12)),
           (0.30, 0.30, 0.24), (nrm, tan, Z_AX))
    mb.build("CGI.Detail", c, n, M("Radiator"))
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
    "total_width_m":    (4.40,  "[S1] NASA Roman FAQ; the body's width"),
    # 2.0 m centre column (the 4 m hex shroud's flat) + two 2.1 m panels
    "wing_span_m":      (6.20,  "[S2][S14] 2.0 + 2 x 2.1 m, deployed flat"),
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
    # Across the wings (X); the body alone stays inside 4.40 m. See
    # roman_dims TOTAL_WIDTH.
    check("wing span (X)", d.x, "wing_span_m")
    wings = set(_collect("SOLAR_ARRAY_SUN_SHIELD")) | set(_collect("OSS.LowerInstrumentSunShade"))
    bl, bh = _evaluated_bbox([o for o in _collect("OBSERVATORY") if o not in wings])
    want, src = PUBLISHED_ANCHORS["total_width_m"]
    ok = (bh - bl).x <= want + QC_TOLERANCE
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {'body width (X), at most':<34} "
          f"{(bh - bl).x:>7.3f}  want {want:>7.3f}   {src}")

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
