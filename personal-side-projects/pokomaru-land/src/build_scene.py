"""ぽこまるランド 8秒試作: Blender シーン構築+レンダリング(完全無料・CPU)。

使い方:
  blender -b --python src/build_scene.py -- --config config/ep01_proto8s.json \
      --timing out/work/timing.json --out out/frames [--frames 1 192] [--step 1] \
      [--res-scale 1.0] [--engine CYCLES] [--samples 24] [--hold 1]

・キャラは球・楕円体だけで作る簡略モデル。色・シルエット・顔(大きい目+ハイライト、ピンクのほっぺ、
  あいた口)を3匹で揃える。
・アニメーションはフレーム毎に pose(t) が姿勢を計算する(キーフレームは使わない)。
・色は View Transform=Standard で出力し、パレット(config)の sRGB 値がそのまま画に出るようにする。
"""
import bpy, sys, json, math, random, time, os, argparse
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True)
ap.add_argument("--timing", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--frames", nargs=2, type=int)
ap.add_argument("--step", type=int, default=1)
ap.add_argument("--hold", type=int, default=1, help="N コマ打ち(N フレームに1回だけ描画し複製は ffmpeg 側)。1=全フレーム描画")
ap.add_argument("--res-scale", type=float, default=1.0)
ap.add_argument("--engine")
ap.add_argument("--samples", type=int)
ap.add_argument("--save-blend")
A = ap.parse_args(argv)

C = json.load(open(A.config, encoding="utf-8"))
T = json.load(open(A.timing, encoding="utf-8"))
P = C["palette"]
FPS, NF = C["fps"], T["frames"]
EV = T["events"]
ENV = T["mouth_env"]

# ---------------------------------------------------------------- 基本部品
def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hexcol(h):
    h = h.lstrip("#")
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)

def setin(node, names, val):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = val
            return

def mat(name, hexc, rough=0.75, sheen=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexcol(hexc)
    b.inputs["Roughness"].default_value = rough
    setin(b, ["Sheen Weight", "Sheen"], sheen)
    setin(b, ["Specular IOR Level", "Specular"], 0.25)
    return m

def emis(name, hexc, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = hexcol(hexc)
    e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m

def ell(name, loc, sc, m, parent=None, rot=(0, 0, 0), seg=40, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = sc
    o.rotation_euler = rot
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    if parent is not None:
        o.parent = parent
    return o

def cone(name, loc, r, h, m, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r, radius2=0, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    if parent is not None:
        o.parent = parent
    return o

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent is not None:
        o.parent = parent
    return o

def surf_y(cy, ry, cx, rx, cz, rz, x, z):
    """楕円体の前面(-Y 側)の y 座標。"""
    v = 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2
    return cy - ry * math.sqrt(max(v, 0.0))

# ---------------------------------------------------------------- シーン
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x = int(C["width"] * A.res_scale)
scene.render.resolution_y = int(C["height"] * A.res_scale)
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, NF
rc = C["render"]
scene.render.engine = A.engine or rc["engine"]
if scene.render.engine == "CYCLES":
    scene.cycles.device = "CPU"
    scene.cycles.samples = A.samples or rc["samples"]
    scene.cycles.use_denoising = rc["denoise"] and os.environ.get("NO_DENOISE") != "1"
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = int(os.environ.get("DBOUNCE", "2"))
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 0
    scene.cycles.volume_bounces = 0
    scene.cycles.transparent_max_bounces = 2
    scene.cycles.use_adaptive_sampling = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = rc["threads"]
    scene.render.use_persistent_data = True
else:
    scene.eevee.taa_render_samples = A.samples or 32
    scene.eevee.use_gtao = True
    scene.eevee.use_soft_shadows = True
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
scene.display_settings.display_device = "sRGB"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.film_transparent = False

# 空(地平線→天頂のグラデーション)
w = bpy.data.worlds.new("sky")
scene.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
ramp = nt.nodes.new("ShaderNodeValToRGB")
bg = nt.nodes.new("ShaderNodeBackground")
wo = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Generated"], sep.inputs[0])
nt.links.new(sep.outputs["Z"], ramp.inputs[0])
nt.links.new(ramp.outputs[0], bg.inputs["Color"])
ramp.color_ramp.elements[0].position = 0.40
ramp.color_ramp.elements[0].color = hexcol("#B4E3FF")
ramp.color_ramp.elements[1].position = 0.55
ramp.color_ramp.elements[1].color = hexcol("#52B2F4")
bg.inputs["Strength"].default_value = 1.0
# 見える空は青グラデ、照明に使う光は中立の白(青い環境光でキャラの色が濁らないように)
bg2 = nt.nodes.new("ShaderNodeBackground")
bg2.inputs["Color"].default_value = (1, 1, 1, 1)
bg2.inputs["Strength"].default_value = float(os.environ.get("AMBIENT", "0.65"))
lp = nt.nodes.new("ShaderNodeLightPath")
mx = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(lp.outputs["Is Camera Ray"], mx.inputs["Fac"])
nt.links.new(bg2.outputs[0], mx.inputs[1])
nt.links.new(bg.outputs[0], mx.inputs[2])
nt.links.new(mx.outputs[0], wo.inputs[0])

# 光: 手前上から柔らかい太陽+空の環境光
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = float(os.environ.get("SUN", "1.9"))
sun.angle = math.radians(25)
sun.color = (1.0, 0.98, 0.94)
so = bpy.data.objects.new("sun", sun)
scene.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(-32))

# 地面・丘・虹・雲
M = {}
M["grass"] = mat("grass", P["grass"], 0.95, 0.0)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 4, 0))
g = bpy.context.active_object
g.scale = (60, 40, 1)
g.data.materials.append(M["grass"])
for i, (x, y, sx, sy, sz, col) in enumerate([
        (-7, 15, 10, 6, 2.6, "#6CC83A"), (6, 18, 12, 6, 3.4, "#7FD43F"), (0, 24, 20, 8, 4.5, "#8ADB52")]):
    ell(f"hill{i}", (x, y, -0.7), (sx, sy, sz), mat(f"hill{i}", col, 0.95, 0.0), seg=48, rings=24)
random.seed(7)
trunk = mat("trunk", "#B98350", 0.9, 0.0)
leaf = mat("leaf", "#4FBF4A", 0.9, 0.0)
for i, (x, y) in enumerate([(-4.3, 10.5), (-2.6, 12.5), (4.2, 11.0), (2.8, 13.5), (-5.5, 13.5), (6.0, 14.5)]):
    ell(f"leaf{i}", (x, y, 1.9), (1.0, 1.0, 0.95), leaf)
    ell(f"trunk{i}", (x, y, 0.6), (0.17, 0.17, 0.65), trunk)
# 虹(発光で色を正確に)
for i, col in enumerate(["#FF5A5F", "#FF9F43", "#FFE14B", "#6BD36B", "#4FB6F7", "#6E7BFF"]):
    bpy.ops.mesh.primitive_torus_add(major_radius=7.6 - i * 0.45, minor_radius=0.25, major_segments=120,
                                     minor_segments=12, location=(0, 24, 0.5), rotation=(math.pi / 2, 0, 0))
    r = bpy.context.active_object
    r.name = f"rainbow{i}"
    r.scale = (1.0, 1.0, 0.35)
    r.data.materials.append(emis(f"rb{i}", col, 1.0))
cloudm = mat("cloud", "#FFFFFF", 1.0, 0.0)
for i, (x, y, z, s) in enumerate([(-3.2, 20, 4.2, 1.0), (3.4, 22, 5.0, 1.2), (0.8, 24, 6.2, 0.8)]):
    for j, (dx, dz, k) in enumerate([(0, 0, 1.0), (0.9 * s, -0.15, 0.8), (-0.9 * s, -0.2, 0.75), (0.4 * s, 0.4, 0.7)]):
        ell(f"cloud{i}_{j}", (x + dx, y, z + dz), (0.9 * s * k, 0.6 * s * k, 0.65 * s * k), cloudm)

# 花畑(1つの花メッシュを複製、花びらの色はオブジェクト色)
pet = bpy.data.materials.new("petal")
pet.use_nodes = True
pn = pet.node_tree
oi = pn.nodes.new("ShaderNodeObjectInfo")
pn.links.new(oi.outputs["Color"], pn.nodes["Principled BSDF"].inputs["Base Color"])
pn.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
ctr = mat("fcenter", "#FFD23A", 0.6, 0.0)
parts = []
for k in range(6):
    a = k * math.pi / 3
    parts.append(ell("p", (math.cos(a) * 0.5, math.sin(a) * 0.5, 0), (0.5, 0.5, 0.2), pet, seg=16, rings=8))
parts.append(ell("c", (0, 0, 0.08), (0.36, 0.36, 0.3), ctr, seg=16, rings=8))
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
fl = bpy.context.active_object
fl.name = "flower_tpl"
fl.data.materials.clear()
fl.data.materials.append(pet)
fl.data.materials.append(ctr)
for poly in fl.data.polygons:
    poly.material_index = 0
bpy.context.scene.collection.objects.unlink(fl)  # テンプレートは描画しない
flower_mesh = fl.data
random.seed(11)
cols = ["#FF8FC8", "#B28DFF", "#FFFFFF", "#FFE14B", "#FF9A3C", "#6FB8FF", "#FF6FA5"]
flowers = []
for i in range(520):
    x, y = random.uniform(-5.0, 5.0), random.uniform(-4.2, 9)
    if abs(x) < 1.2 and -1.2 < y < 1.0:
        continue
    o = bpy.data.objects.new(f"f{i}", flower_mesh)
    scene.collection.objects.link(o)
    s = random.uniform(0.09, 0.17)
    o.scale = (s, s, s)
    o.rotation_euler = (0, 0, random.uniform(0, 6.28))
    o.location = (x, y, 0.07 + s * 0.2)
    c = hexcol(random.choice(cols))
    o.color = c
    flowers.append(o)

# ヒーロー花(あかい おはな)
stem = ell("stem", (0, 0, 0.24), (0.04, 0.04, 0.24), mat("stem", "#3FA83F", 0.8, 0.0))
hero = empty("hero", (0.0, -1.15, 0.0))
stem.parent = hero
hf = bpy.data.objects.new("hero_head", flower_mesh)
scene.collection.objects.link(hf)
hf.color = hexcol(P["flower_red"])
hf.parent = hero
hf.location = (0, 0, 0.48)
hf.scale = (0.30, 0.30, 0.30)
hf.rotation_euler = (math.radians(70), 0, 0)  # 花を正面(カメラ側)へ向ける
sparkm = emis("spark", "#FFF06A", 3.0)
sparks = []
for i in range(12):
    s = empty(f"spark{i}")
    ell("a", (0, 0, 0), (1.0, 0.12, 0.28), sparkm, s, seg=12, rings=6)
    ell("b", (0, 0, 0), (0.28, 0.12, 1.0), sparkm, s, seg=12, rings=6)
    s.scale = (0.001,) * 3
    sparks.append(s)

# ---------------------------------------------------------------- キャラクター
def eyes(root, ex, ez, hy, head, esc, iris_hex, ydir=-1):
    """目: こい色の球+虹彩+白いハイライト2つ。左右の枢軸を返す。"""
    cx, cy, cz, rx, ry, rz = head
    piv = []
    for sx in (-1, 1):
        x = cx + sx * ex
        y = surf_y(cy, ry, cx, rx, cz, rz, x, ez) + 0.03
        p = empty("eye_piv", (x, y, ez), root)
        ell("eye", (0, 0, 0), (esc * 0.82, esc * 0.55, esc * 1.12), M["eye_dark"], p, seg=28, rings=14)
        ell("iris", (0, -esc * 0.30, -esc * 0.30), (esc * 0.62, esc * 0.35, esc * 0.66), mat("iris", iris_hex, 0.5, 0.0), p, seg=24, rings=12)
        ell("hl1", (esc * 0.28 * sx * -1 * -1 * 0 + esc * 0.22, -esc * 0.42, esc * 0.45), (esc * 0.26, esc * 0.14, esc * 0.30), M["white_e"], p, seg=16, rings=8)
        ell("hl2", (-esc * 0.30, -esc * 0.40, -esc * 0.55), (esc * 0.12, esc * 0.08, esc * 0.12), M["white_e"], p, seg=12, rings=6)
        piv.append(p)
    return piv

def face(root, head, ex, ez, esc, iris_hex, my, mz, mw, cheek_dx, cheek_z, cheek_s):
    cx, cy, cz, rx, ry, rz = head
    ep = eyes(root, ex, ez, 0, head, esc, iris_hex)
    y = surf_y(cy, ry, cx, rx, cz, rz, cx, mz) - 0.0
    mouth = empty("mouth", (cx, y + 0.005, mz), root)
    mm = ell("mouth_shape", (0, 0, 0), (mw, 0.06, mw * 0.7), M["mouth"], mouth, seg=28, rings=14)
    ell("tongue", (0, -0.03, -0.32), (0.62, 0.55, 0.45), M["tongue"], mm, seg=20, rings=10)
    for sx in (-1, 1):
        x = cx + sx * cheek_dx
        yy = surf_y(cy, ry, cx, rx, cz, rz, x, cheek_z)
        ell("cheek", (x, yy + 0.02, cheek_z), (cheek_s, 0.06, cheek_s * 0.72), M["cheek"], root, seg=20, rings=10)
    return ep, mouth

M["white_e"] = emis("white_e", "#FFFFFF", 1.4)
M["eye_dark"] = mat("eye_dark", P["eye_dark"], 0.2, 0.0)
M["mouth"] = mat("mouth", P["mouth"], 0.5, 0.0)
M["tongue"] = mat("tongue", P["tongue"], 0.5, 0.0)
M["cheek"] = mat("cheek", P["cheek"], 0.85, 0.0)

CH = {}

def build_pokomaru():
    r = empty("pokomaru", (0.0, 0.0, 0.0))
    body = mat("pk_body", P["pokomaru_body"], 0.8, 0.45)
    belly = mat("pk_belly", P["pokomaru_belly"], 0.85, 0.4)
    horn = mat("pk_horn", P["pokomaru_horn"], 0.6, 0.0)
    head = (0, 0, 1.38, 0.86, 0.74, 0.76)
    ell("body", (0, 0.02, 0.74), (0.80, 0.70, 0.76), body, r)
    ell("head", (0, 0, 1.38), (0.86, 0.74, 0.76), body, r, seg=48, rings=24)
    ell("belly", (0, -0.40, 0.66), (0.50, 0.30, 0.52), belly, r)
    for i, (x, z, rot, s) in enumerate([(-0.47, 2.14, -0.32, 0.95), (0.0, 2.28, 0.0, 1.2), (0.47, 2.14, 0.32, 0.95)]):
        cone(f"horn{i}", (x, 0.0, z), 0.17 * s, 0.50 * s, horn, r, rot=(0, rot, 0))
    for sx in (-1, 1):
        ell("foot", (sx * 0.42, -0.18, 0.12), (0.30, 0.38, 0.13), body, r)
    arms = []
    for sx in (-1, 1):
        p = empty("arm_piv", (sx * 0.74, -0.05, 0.98), r)
        ell("arm", (0, 0, -0.26), (0.20, 0.20, 0.38), body, p)
        arms.append(p)
    ep, mouth = face(r, head, ex=0.37, ez=1.50, esc=0.20, iris_hex=P["eye_brown"], my=0, mz=1.07, mw=0.24,
                     cheek_dx=0.60, cheek_z=1.22, cheek_s=0.15)
    CH["pokomaru"] = dict(root=r, arms=arms, eyes=ep, mouth=mouth, mouth_open=1.0, base=(0.0, 0.0), enter="pokomaru", ph=0.0, head_z=1.38)

def build_pipi():
    r = empty("pipi", (-1.12, 0.35, 0.0))
    body = mat("pp_body", P["pipi_body"], 0.8, 0.45)
    wing = mat("pp_wing", P["pipi_wing"], 0.8, 0.4)
    crest = mat("pp_crest", P["pipi_crest"], 0.6, 0.0)
    beak = mat("pp_beak", P["pipi_beak"], 0.5, 0.0)
    head = (0, 0, 1.12, 0.66, 0.58, 0.58)
    ell("body", (0, 0.02, 0.58), (0.62, 0.56, 0.60), body, r)
    ell("head", (0, 0, 1.12), (0.66, 0.58, 0.58), body, r, seg=48, rings=24)
    ell("belly", (0, -0.30, 0.52), (0.38, 0.24, 0.40), mat("pp_belly", "#FFE9A0", 0.85, 0.4), r)
    for i, (x, rot, s) in enumerate([(-0.17, -0.45, 0.8), (0.0, 0.0, 1.0), (0.17, 0.45, 0.8)]):
        ell(f"crest{i}", (x, 0.0, 1.72 + 0.04 * s), (0.10 * s, 0.10 * s, 0.22 * s), crest, r, rot=(0, rot, 0), seg=16, rings=8)
    for sx in (-1, 1):
        ell("foot", (sx * 0.26, -0.16, 0.06), (0.22, 0.28, 0.07), crest, r)
    arms = []
    for sx in (-1, 1):
        p = empty("wing_piv", (sx * 0.58, 0.0, 0.78), r)
        ell("wing", (0, 0.0, -0.18), (0.14, 0.34, 0.36), wing, p)
        arms.append(p)
    ep, mouth = face(r, head, ex=0.30, ez=1.22, esc=0.165, iris_hex=P["eye_brown"], my=0, mz=0.92, mw=0.17,
                     cheek_dx=0.47, cheek_z=1.02, cheek_s=0.12)
    yb = surf_y(0, 0.58, 0, 0.66, 1.12, 0.58, 0, 1.08)
    ell("beak", (0, yb - 0.02, 1.07), (0.13, 0.10, 0.06), beak, r, seg=20, rings=10)
    CH["pipi"] = dict(root=r, arms=arms, eyes=ep, mouth=mouth, mouth_open=0.7, base=(-1.12, 0.35), enter="pipi", ph=1.3, head_z=1.12)

def build_fuwari():
    r = empty("fuwari", (1.18, 0.30, 0.0))
    fur = mat("fw_fur", P["fuwari_fur"], 0.85, 0.45)
    inner = mat("fw_inner", P["fuwari_inner"], 0.8, 0.2)
    white = mat("fw_white", P["fuwari_white"], 0.9, 0.4)
    head = (0, 0, 1.16, 0.64, 0.56, 0.56)
    ell("body", (0, 0.02, 0.62), (0.60, 0.52, 0.62), fur, r)
    ell("head", (0, 0, 1.16), (0.64, 0.56, 0.56), fur, r, seg=48, rings=24)
    ell("belly", (0, -0.30, 0.55), (0.40, 0.24, 0.42), white, r)
    ell("muzzle", (0, -0.45, 1.00), (0.24, 0.14, 0.16), white, r, seg=24, rings=12)
    ell("nose", (0, -0.58, 1.09), (0.06, 0.04, 0.045), mat("fw_nose", P["nose"], 0.5, 0.0), r, seg=16, rings=8)
    ears = []
    for sx in (-1, 1):
        p = empty("ear_piv", (sx * 0.30, 0.0, 1.58), r)
        ell("ear", (0, 0, 0.52), (0.16, 0.085, 0.58), fur, p)
        ell("ear_in", (0, -0.045, 0.52), (0.095, 0.06, 0.46), inner, p)
        p.rotation_euler = (0, sx * -0.18, 0)
        ears.append(p)
    for sx in (-1, 1):
        ell("foot", (sx * 0.28, -0.16, 0.10), (0.24, 0.30, 0.11), fur, r)
    arms = []
    for sx in (-1, 1):
        p = empty("arm_piv", (sx * 0.56, -0.02, 0.84), r)
        ell("arm", (0, 0, -0.22), (0.15, 0.15, 0.33), fur, p)
        arms.append(p)
    ep, mouth = face(r, head, ex=0.30, ez=1.24, esc=0.17, iris_hex=P["eye_blue"], my=0, mz=0.90, mw=0.16,
                     cheek_dx=0.48, cheek_z=1.02, cheek_s=0.13)
    CH["fuwari"] = dict(root=r, arms=arms, eyes=ep, mouth=mouth, mouth_open=0.6, base=(1.18, 0.30), enter="fuwari", ph=2.1, head_z=1.16, ears=ears)

build_pokomaru()
build_pipi()
build_fuwari()

# カメラ
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 50
cam_d.sensor_fit = "VERTICAL"
cam_d.sensor_height = 36
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
tgt = empty("cam_target", (0, 0, 1.95))
tr = cam.constraints.new("TRACK_TO")
tr.target = tgt
tr.track_axis = "TRACK_NEGATIVE_Z"
tr.up_axis = "UP_Y"

# ---------------------------------------------------------------- アニメーション
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))

def ease_out_back(x, s=1.9):
    x = clamp(x)
    return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2

def pose(t):
    f = int(round(t * FPS))
    env = ENV[min(max(f, 0), len(ENV) - 1)]
    cheer = clamp((t - EV["cheer_start"]) / 0.25)
    flower_t = EV["flower_pop"]
    for name, c in CH.items():
        r = c["root"]
        e = ease_out_back((t - EV["enter_times"][c["enter"]]) / 0.45)
        ph = c["ph"]
        bpm = 1.6 + 0.0 * ph
        b = abs(math.sin(math.pi * (t * bpm) + ph)) if t > 0.9 else 0.0
        if t > EV["cheer_start"]:
            b = abs(math.sin(math.pi * (t - EV["cheer_start"]) * 2.4)) * 1.7
        sq = 1.0 - 0.07 * (1 - b) * (1 if t > 0.9 else 0)
        sxy = 1.0 + 0.035 * (1 - b) * (1 if t > 0.9 else 0)
        s = max(e, 0.0001)
        r.scale = (s * sxy, s * sxy, s * sq)
        r.location = (c["base"][0], c["base"][1], 0.28 * b)
        r.rotation_euler = (0, 0, 0.05 * math.sin(t * 2.2 + ph))
        # 腕(ぴぴはつばさ)
        wave = 0.0
        if t < 4.0:
            wave = 1.3 + 0.55 * math.sin(2 * math.pi * 2.6 * t + ph)
        elif t < EV["cheer_start"]:
            wave = 0.35 + 0.1 * math.sin(2 * math.pi * 1.5 * t + ph)
        up = 2.5 + 0.25 * math.sin(2 * math.pi * 3 * t + ph) if t >= EV["cheer_start"] else None
        a_r = up if up is not None else wave
        a_l = up if up is not None else (0.35 if name != "pokomaru" else 0.35)
        if name == "pokomaru" and t < 4.0:
            a_l = 0.35
        if name == "pipi" and t < 4.0:
            a_l = 1.3 + 0.55 * math.sin(2 * math.pi * 2.6 * t + ph + 1.6)
        # 右腕(画面右, +x)は -y 回転で外側/上へ、左腕は +y 回転
        c["arms"][1].rotation_euler = (0, -a_r, 0)
        c["arms"][0].rotation_euler = (0, a_l, 0)
        # まばたき
        blink_phase = (t + ph * 0.7) % 2.6
        bl = 0.1 if blink_phase < 0.12 else 1.0
        for p in c["eyes"]:
            p.scale = (1, 1, bl)
        # 口
        if name == "pokomaru":
            op = 0.12 + 0.95 * env
            if t > EV["cheer_start"]:
                op = 0.9
        else:
            op = 0.14
            if t > EV["cheer_start"]:
                op = 0.75
            elif t >= flower_t:
                op = 0.14 + 0.35 * abs(math.sin(t * 9 + ph))
        c["mouth"].scale = (1, 1, clamp(op, 0.08, 1.1))
        if "ears" in c:
            wig = (0.10 if t < flower_t else 0.28) * math.sin(2 * math.pi * 2.0 * t + ph)
            for i, p in enumerate(c["ears"]):
                sx = -1 if i == 0 else 1
                p.rotation_euler = (0.08 * math.sin(2 * math.pi * 1.5 * t + ph + i), sx * -0.18 + wig * (-sx), 0)
    # ヒーロー花
    dt = t - flower_t
    hs = ease_out_back(dt / 0.55) if dt > 0 else 0.0001
    hero.scale = (max(hs, 0.0001),) * 3
    hero.rotation_euler = (0, 0.05 * math.sin(t * 3), 0.0)
    # キラキラ
    for i, sp in enumerate(sparks):
        d = dt - 0.05 * (i % 4)
        if 0 < d < 1.0:
            ang = i * (2 * math.pi / len(sparks)) + 0.4
            rad = 0.55 + 1.5 * (1 - (1 - clamp(d / 0.9)) ** 3)
            sz = 0.17 * math.sin(math.pi * clamp(d / 1.0)) + 0.001
            sp.location = (math.cos(ang) * rad * 0.9, -1.45, 0.75 + math.sin(ang) * rad * 0.9)
            sp.scale = (sz,) * 3
        else:
            sp.scale = (0.0001,) * 3
    # カメラ: ゆっくり寄る
    k = clamp(t / C["duration_sec"])
    cam.location = (0.0, -11.0 + 1.0 * k, 2.4)

def on_frame(sc, *_):
    pose((sc.frame_current - 1) / FPS)

bpy.app.handlers.frame_change_pre.append(on_frame)

# ---------------------------------------------------------------- レンダリング
os.makedirs(A.out, exist_ok=True)
if A.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A.save_blend))
f0, f1 = (A.frames or (1, NF))
log = []
t_all = time.time()
for f in range(f0, f1 + 1, A.step):
    if (f - 1) % A.hold != 0:
        continue
    path = os.path.join(A.out, f"f{f:04d}.png")
    if os.path.exists(path):
        continue
    scene.frame_set(f)
    scene.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    log.append({"frame": f, "sec": round(dt, 2)})
    print(f"RENDERED frame {f} in {dt:.1f}s", flush=True)
json.dump({"engine": scene.render.engine, "samples": getattr(scene.cycles, "samples", None),
           "res": [scene.render.resolution_x, scene.render.resolution_y], "frames": log,
           "total_sec": round(time.time() - t_all, 1)},
          open(os.path.join(A.out, "..", f"render_log_{f0}_{f1}_{A.step}.json"), "w"), indent=1)
print("DONE total", round(time.time() - t_all, 1))
