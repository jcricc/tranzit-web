#!/usr/bin/env python3
"""Compose a T6 map's world shell + static model instances into a glTF scene.

    python .tools/compose_scene.py [mp_hijacked]

The map name selects export/maps/mp/<map>.d3dbsp.* as input and the output
prefix (mp_hijacked writes hijacked.gltf, mp_nuketown_2020 writes
nuketown_2020.gltf) so several maps can sit in export/web side by side.
"""
import json, math, os, re, struct, sys
from urllib.parse import quote
from export_collision import brush_surface_placements_for_map, export_collision, map_prefix, place_brush_vertex, script_model_instances

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = f"{ROOT}/export/web"
MAP = sys.argv[1] if len(sys.argv) > 1 else "mp_hijacked"
PREFIX = map_prefix(MAP)
SRC = f"{ROOT}/export/maps/mp/{MAP}.d3dbsp"
TEXTURES = f"textures/{MAP}" if MAP.startswith("zm_") else "textures"

# ---------- binary buffer helpers ----------
class Buf:
    def __init__(self):
        self.data = bytearray()
    def f32(self, arr):
        self.data += struct.pack(f"<{len(arr)}f", *arr)
        return len(arr) * 4
    def u32(self, arr):
        self.data += struct.pack(f"<{len(arr)}I", *arr)
        return len(arr) * 4
    def view(self, byteOffset, byteLength, count, ctype, comps):
        comp_size = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}[comps]
        return {
            "buffer": 0, "byteOffset": byteOffset, "byteLength": byteLength,
            "componentType": ctype, "count": count, "type": comps,
            "min": None, "max": None,
        }

buf = Buf()
accessors = []
bufferViews = []
materials = []
textures = []
images = []
samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
tex_cache = {}
meshes = []

def add_accessor_f32(flat, comps, minmax=True):
    off = len(buf.data)
    n = buf.f32(flat)
    acc = {"bufferView": len(bufferViews), "componentType": 5126, "count": len(flat)//{"VEC3":3,"VEC2":2}[comps], "type": comps}
    bv = {"buffer": 0, "byteOffset": off, "byteLength": n}
    if minmax:
        c = {"VEC3":3,"VEC2":2}[comps]
        mn = [min(flat[i::c]) for i in range(c)]
        mx = [max(flat[i::c]) for i in range(c)]
        acc["min"], acc["max"] = mn, mx
    bufferViews.append(bv)
    accessors.append(acc)
    return len(accessors) - 1

def add_accessor_u32(flat):
    off = len(buf.data)
    n = buf.u32(flat)
    bufferViews.append({"buffer": 0, "byteOffset": off, "byteLength": n})
    accessors.append({"bufferView": len(bufferViews)-1, "componentType": 5125, "count": len(flat), "type": "SCALAR"})
    return len(accessors) - 1

def add_texture(png_name):
    if png_name in tex_cache:
        return tex_cache[png_name]
    images.append({"uri": TEXTURES + "/" + quote(png_name)})
    textures.append({"sampler": 0, "source": len(images)-1})
    tex_cache[png_name] = len(textures)-1
    return tex_cache[png_name]

def base_material(name):
    """The base layer of a composite BSP material name, without the wpc/ prefix."""
    m = re.match(r"\*[^(]*\(([^:)]+)", name)
    base = m.group(1) if m else name.split(":")[0]
    return re.sub(r"^[a-z]+/", "", base.lower())

def is_glass_material(name):
    """Glass that should read as glass. Garage doors, lit sign boxes and the
    opaque gloss panels carry glass in their names but are solid in the game."""
    base = base_material(name)
    if "glass" not in base or "fiberglass" in base:
        return False
    return not any(word in base for word in ("metal", "sign", "opaque", "block", "backlit"))

def add_material(mat_name, tex_png):
    key = (mat_name, tex_png)
    for i, m in enumerate(materials):
        if m.get("_key") == key:
            return i
    mat = {
        "_key": key, "name": mat_name[:60],
        "pbrMetallicRoughness": {"baseColorFactor": [1,1,1,1], "metallicFactor": 0.0, "roughnessFactor": 0.9},
        "doubleSided": True,
    }
    # Glass is authored with its own translucent shaders; here it becomes a
    # tinted blend so windows and roofs read as glass instead of grey sheets.
    if is_glass_material(mat_name):
        mat["alphaMode"] = "BLEND"
        mat["pbrMetallicRoughness"]["baseColorFactor"] = [0.78, 0.86, 0.92, 0.38]
        mat["pbrMetallicRoughness"]["roughnessFactor"] = 0.2
    # A colour map that is actually a normal map (the dump names them *_n /
    # *_nml) would paint the surface blue; leave it untextured instead.
    normal_map_as_color = bool(tex_png) and re.search(r"_(n|nml|nrm)\.png$", tex_png) is not None
    if tex_png and not normal_map_as_color and os.path.exists(f"{OUT}/{TEXTURES}/{tex_png}"):
        mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": add_texture(tex_png)}
    materials.append(mat)
    return len(materials)-1

def add_mesh(name, prims):
    """prims: list of (positions, uvs, normals, indices, mat_idx)"""
    P = []
    for pos, uv, nrm, idx, mi in prims:
        vertex_count = len(pos) // 3
        assert len(pos) % 3 == 0, f"{name}: malformed position data"
        assert len(uv) == vertex_count * 2, f"{name}: UV count does not match positions"
        assert len(nrm) == vertex_count * 3, f"{name}: normal count does not match positions"
        assert not idx or max(idx) < vertex_count, f"{name}: index exceeds vertex count"
        P.append({
            "attributes": {
                "POSITION": add_accessor_f32(pos, "VEC3"),
                "TEXCOORD_0": add_accessor_f32(uv, "VEC2"),
                "NORMAL": add_accessor_f32(nrm, "VEC3"),
            },
            "indices": add_accessor_u32(idx),
            "material": mi,
            "mode": 4,
        })
    meshes.append({"name": name[:60], "primitives": P})
    return len(meshes)-1

# ---------- world shell ----------
print(f"loading world shell for {MAP}...")
d = json.load(open(f"{SRC}.gfxworld.json"))
raw0 = open(f"{SRC}.gfxworld.vd0","rb").read()
idx = struct.unpack(f"<{d['indexCount']}H", open(f"{SRC}.gfxworld.idx","rb").read())
S = d["surfaces"]; M = d["materials"]

vcache = {}      # byte offset -> (vert tuple)
world_by_mat = {}  # (cell, mat key) -> list of faces

# The world is written as one mesh per cell rather than one mesh. bake:map
# quantizes positions to a 14-bit grid over each mesh's own bounds; a single
# mesh spanning Nuketown's 75k-unit desert vista put that grid at 4.6 units,
# which sank carpets into floors and shifted walls. Playable ground gets
# 1024-unit cells (a sixteenth of an inch); the vista beyond gets 8192-unit
# cells so it does not turn into hundreds of draw calls.
WORLD_CELL = 1024
VISTA_CELL = 8192
NEAR_EXTENT = 3072

def world_cell(x, z):
    size = WORLD_CELL if max(abs(x), abs(z)) < NEAR_EXTENT else VISTA_CELL
    return (size, math.floor(x / size), math.floor(z / size))

# Render-only exclusions. "distant" is the far scenery shell. Caulk and
# shadowcaster surfaces only exist to cast shadows; the game never draws them,
# and their placeholder textures would show as walls and floors here.
def is_render_material(material):
    name = material["name"].lower()
    color = (material.get("colorMap") or "").lower()
    # glass_clear_wall is the invisible boundary glass around the playable
    # area; it keeps its collision but never draws.
    if base_material(material["name"]).startswith("glass_clear_wall"):
        return False
    return not ("distant" in name or "caulk" in name or "shadowcaster" in name or color == ",shadow")

# Brush model surfaces (glass panes, the carpet, roof panels) are authored
# around their entity's origin; see export_collision.brush_surface_placements.
brush_placements = brush_surface_placements_for_map(ROOT, MAP, d)
print(f"brush model surfaces: {len(brush_placements)}, hidden: {sum(1 for p in brush_placements.values() if p['hidden'])}")

for si, s in enumerate(S):
    placement = brush_placements.get(si)
    if placement and placement["hidden"]:
        continue
    mname = M[s["m"]]["name"]
    if not is_render_material(M[s["m"]]):
        continue
    tex = M[s["m"]]["colorMap"]
    tex_png = (tex + ".png") if tex else None
    mi = add_material(mname, tex_png)
    for t in range(0, s["tc"]*3, 3):
        tri = idx[s["bi"]+t : s["bi"]+t+3]
        pts = []
        for i in tri:
            off = s["o0"] + i*36
            key = (off, si) if placement else off
            e = vcache.get(key)
            if e is None:
                x, y, z = struct.unpack_from("<3f", raw0, off)
                if placement:
                    x, y, z = place_brush_vertex(placement, (x, y, z))
                u, v = struct.unpack_from("<2e", raw0, off+20)   # f16 texcoords
                e = ((x, z, -y), (u, v))                          # game z-up -> glTF y-up; UV already top-left
                vcache[key] = e
            pts.append(e)
        # A face belongs to the cell its first vertex falls in.
        cell = world_cell(pts[0][0][0], pts[0][0][2])
        world_by_mat.setdefault((cell, mi), []).append(pts)

# flat normals + primitive build
def build_prim(faces):
    pos, uv, nrm, ind = [], [], [], []
    vmap = {}
    for pts in faces:
        (ax,ay,az),(bx,by,bz),(cx,cy,cz) = (p[0] for p in pts)
        ux,uy,uz = bx-ax, by-ay, bz-az
        vx,vy,vz = cx-ax, cy-ay, cz-az
        nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        l = (nx*nx+ny*ny+nz*nz) ** 0.5 or 1.0
        nx,ny,nz = nx/l, ny/l, nz/l
        base = len(pos) // 3
        for (p, t) in pts:
            pos += [p[0], p[1], p[2]]
            uv += [t[0], t[1]]
            nrm += [nx, ny, nz]
        ind += [base, base+1, base+2]
    return pos, uv, nrm, ind

world_nodes = []
cells = sorted({cell for cell, _ in world_by_mat})
for cell in cells:
    prims = []
    for (face_cell, mi), faces in world_by_mat.items():
        if face_cell != cell:
            continue
        pos, uv, nrm, ind = build_prim(faces)
        prims.append((pos, uv, nrm, ind, mi))
    name = f"world_shell_{cell[0]}_{cell[1]}_{cell[2]}"
    world_nodes.append({"mesh": add_mesh(name, prims), "name": name})
print(f"world: {len(cells)} cells, {len(world_by_mat)} primitives, {sum(len(f) for f in world_by_mat.values())} tris")

# ---------- static models ----------
print("loading models...")
model_meshes = {}   # model name -> mesh idx
obj_dir = f"{ROOT}/export/model_export"

def parse_obj(path):
    V, VT, VN = [], [], []
    groups = {}   # mtl -> list of (a,b,c) index triples (1-based tuples)
    cur = None
    for line in open(path, errors="ignore"):
        if line.startswith("v "):
            V.append(tuple(float(x) for x in line.split()[1:4]))
        elif line.startswith("vt "):
            t = line.split()[1:3]
            VT.append(tuple(float(x) for x in t))
        elif line.startswith("vn "):
            VN.append(tuple(float(x) for x in line.split()[1:4]))
        elif line.startswith("usemtl "):
            cur = line.split(None, 1)[1].strip()
            groups.setdefault(cur, [])
        elif line.startswith("f "):
            vs = []
            for tok in line.split()[1:]:
                seg = tok.split("/")
                vi = int(seg[0]); vi = vi-1 if vi > 0 else len(V)+vi
                ti = int(seg[1])-1 if len(seg) > 1 and seg[1] else 0
                ni = int(seg[2])-1 if len(seg) > 2 and seg[2] else 0
                vs.append((vi, ti, ni))
            for k in range(1, len(vs)-1):
                groups[cur].append((vs[0], vs[k], vs[k+1]))
    return V, VT, VN, groups

def read_mtl_map(name):
    mtl_map = {}
    mtl_path = f"{obj_dir}/{name}.mtl"
    if os.path.exists(mtl_path):
        cur = None
        for line in open(mtl_path, errors="ignore"):
            if line.startswith("newmtl "):
                cur = line.split(None, 1)[1].strip()
            elif line.startswith("map_Kd ") and cur:
                raw = line.split(None, 1)[1].strip()
                base = os.path.basename(raw)
                if base.lower().endswith(".dds"):
                    mtl_map[cur] = base[:-4] + ".png"
    return mtl_map

def model_prims(name, V, VT, VN, groups, mtl_map, keep=None):
    """One primitive per material; `keep(mtl, face_index)` filters faces."""
    prims = []
    for mtl, faces in groups.items():
        if keep is not None:
            faces = [f for k, f in enumerate(faces) if keep(mtl, k)]
        if not faces:
            continue
        tex_png = mtl_map.get(mtl)
        mi = add_material(f"{name}:{mtl}", tex_png)
        pos, uv, nrm, ind = [], [], [], []
        vmap = {}
        for (a, b, c) in faces:
            base = len(pos) // 3
            for (vi, ti, ni) in (a, b, c):
                x, y, z = V[vi]
                pos += [x, y, z]
                if VT: u, v = VT[ti]; uv += [u, 1.0-v]
                else: uv += [0, 0]
                if VN and ni < len(VN): nx, ny, nz = VN[ni]; nrm += [nx, ny, nz]
                else: nrm += [0, 1, 0]
            ind += [base, base+1, base+2]
        prims.append((pos, uv, nrm, ind, mi))
    return prims

def model_to_mesh(name):
    V, VT, VN, groups = parse_obj(f"{obj_dir}/{name}_lod0.obj")
    prims = model_prims(name, V, VT, VN, groups, read_mtl_map(name))
    if not prims:
        return None
    return add_mesh(name, prims)

# ---------- destructible mannequins ----------
# The game knocks the head and arms off Nuketown's mannequins. Each is one
# rigid model, but the head, hair and arms are separate shells in the mesh,
# so they split into their own meshes and the runtime can send them flying
# (see export/web/destructibles.js). Shells are told apart by where they sit:
# the head is everything in the top quarter, an arm is a shell of the skin
# material hanging mid-height. Male arms are part of the jacket shell and
# stay on.
DESTRUCTIBLE_MODEL = re.compile(r"^dest_nt_nuked_.*_d0$")

def mesh_shells(V, groups):
    """Label every face by the connected shell it belongs to."""
    parent = list(range(len(V)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    by_position = {}
    for i, v in enumerate(V):
        key = (round(v[0], 3), round(v[1], 3), round(v[2], 3))
        first = by_position.setdefault(key, i)
        if first != i:
            union(first, i)
    for faces in groups.values():
        for (a, b, c) in faces:
            union(a[0], b[0]); union(a[0], c[0])
    shells = {}
    face_shell = {}
    for mtl, faces in groups.items():
        for k, (a, b, c) in enumerate(faces):
            root = find(a[0])
            face_shell[(mtl, k)] = root
            shell = shells.setdefault(root, {"faces": 0, "mtl": mtl, "min": [1e9]*3, "max": [-1e9]*3})
            shell["faces"] += 1
            for (vi, _, _) in (a, b, c):
                for axis in range(3):
                    shell["min"][axis] = min(shell["min"][axis], V[vi][axis])
                    shell["max"][axis] = max(shell["max"][axis], V[vi][axis])
    return shells, face_shell

def mannequin_part_labels(V, groups):
    """(mtl, face_index) -> body | head | arm_left | arm_right."""
    shells, face_shell = mesh_shells(V, groups)
    if not shells:
        return None
    height = max(sh["max"][1] for sh in shells.values())
    labels = {}
    heads = [root for root, sh in shells.items() if sh["min"][1] >= 0.75 * height]
    for root in heads:
        labels[root] = "head"
    # The arms share the skin material of the largest head shell.
    head_mtl = shells[max(heads, key=lambda r: shells[r]["faces"])]["mtl"] if heads else None
    arms = []
    for root, sh in shells.items():
        if root in labels or sh["mtl"] != head_mtl:
            continue
        span = sh["max"][1] - sh["min"][1]
        if 10 <= span <= 35 and sh["min"][1] >= 0.3 * height and sh["faces"] >= 400:
            arms.append(root)
    # Game left is +y, which the OBJ export writes as -z.
    arms.sort(key=lambda r: (shells[r]["min"][2] + shells[r]["max"][2]) / 2)
    for i, root in enumerate(arms[:2]):
        labels[root] = "arm_left" if i == 0 else "arm_right"
    if "head" not in labels.values() and not arms:
        return None
    return {key: labels.get(root, "body") for key, root in face_shell.items()}

def model_to_parts(name):
    """label -> mesh index for a destructible model, or None to place it whole."""
    V, VT, VN, groups = parse_obj(f"{obj_dir}/{name}_lod0.obj")
    labels = mannequin_part_labels(V, groups)
    if not labels:
        return None
    mtl_map = read_mtl_map(name)
    parts = {}
    for label in ("body", "head", "arm_left", "arm_right"):
        prims = model_prims(name, V, VT, VN, groups, mtl_map, keep=lambda mtl, k, label=label: labels.get((mtl, k)) == label)
        if prims:
            parts[label] = add_mesh(f"{name}_{label}", prims)
    return parts

# Static models from the render world plus the placed script_model entities
# (vehicles, mannequins, flags, clocks); see export_collision.script_model_instances.
script_models = script_model_instances(ROOT, MAP)
sm = list(d["staticModels"]) + script_models
print(f"script_model entities placed: {len(script_models)}")

nodes = list(world_nodes)
missing = set()
destructible_parts = {}
destructible_count = 0
for inst in sm:
    name = inst["model"]
    if DESTRUCTIBLE_MODEL.match(name) and os.path.exists(f"{obj_dir}/{name}_lod0.obj"):
        if name not in destructible_parts:
            destructible_parts[name] = model_to_parts(name)
        if destructible_parts[name]:
            model_meshes.setdefault(name, None)
    if name not in model_meshes:
        if not os.path.exists(f"{obj_dir}/{name}_lod0.obj"):
            missing.add(name); model_meshes[name] = None
        else:
            model_meshes[name] = model_to_mesh(name)
    mi = model_meshes[name]
    parts = destructible_parts.get(name)
    if mi is None and not parts:
        continue
    o = inst["origin"]; scale = inst["scale"]
    # game z-up -> glTF y-up: R(x,y,z)=(x,z,-y); conjugate placement: T = R*M*R^-1
    # => linear columns [R*A0, R*A2, -R*A1], translation R*O
    def rot(v): return [v[0], v[2], -v[1]]
    cols = [rot(inst["axis0"]), rot(inst["axis2"]), [-c for c in rot(inst["axis1"])], rot(o)]
    mat = []
    for k in range(3):
        mat += [c * scale for c in cols[k]] + [0.0]
    mat += cols[3] + [1.0]
    if parts:
        for label, part_mesh in parts.items():
            nodes.append({"mesh": part_mesh, "matrix": mat, "name": f"dm_{destructible_count}_{label}"})
        destructible_count += 1
        continue
    nodes.append({"mesh": mi, "matrix": mat, "name": f"i_{name}"[:60]})

print(f"instances: {len(sm)}, unique models: {len(model_meshes)}, missing obj: {len(missing)}, destructibles: {destructible_count}")

# ---------- write gltf ----------
gltf = {
    "asset": {"version": "2.0", "generator": f"{PREFIX}-compose"},
    "scene": 0,
    "scenes": [{"nodes": list(range(len(nodes)))}],
    "nodes": nodes,
    "meshes": meshes,
    "materials": [{k: v for k, v in m.items() if k != "_key"} for m in materials],
    "textures": textures,
    "images": images,
    "samplers": samplers,
    "accessors": accessors,
    "bufferViews": bufferViews,
    "buffers": [{"uri": f"{PREFIX}.bin", "byteLength": len(buf.data)}],
}
os.makedirs(OUT, exist_ok=True)
with open(f"{OUT}/{PREFIX}.gltf", "w") as f:
    json.dump(gltf, f, separators=(",", ":"))
with open(f"{OUT}/{PREFIX}.bin", "wb") as f:
    f.write(buf.data)
print(f"written: {PREFIX}.gltf ({os.path.getsize(f'{OUT}/{PREFIX}.gltf')//1024} KB), {PREFIX}.bin ({len(buf.data)//1024//1024} MB)")
print(f"materials: {len(materials)}, textures used: {len(textures)}, meshes: {len(meshes)}")

# Keep navigation/collision source separate from the render scene.  The
# exporter writes an untextured glTF, entity hints, and a documented sidecar;
# no render meshes/materials are changed by this call.
export_collision(ROOT, OUT, MAP)
