---
name: blender-hardsurface
description: 通过 BlenderMCP 套接字，在 Blender 中按本游戏的美术方向建模、打光并渲染硬表面航天器。当被要求用 Blender 建造飞船/空间站/资产、从 Claude 驱动 Blender、制作概念渲染或电影视频、或为本游戏导出模型时加载。涵盖放样与凹槽建模法、程序化贴图、深空打光，以及会悄悄产出黑帧的 Blender 5.x API 陷阱。
---

# 在 Blender 中制作硬表面航天器

这里的一切都是在端到端建造一艘 162 米勘测勤务船的过程中学到的。技巧比船本身更重要：**基本体堆叠有硬上限，再多的打光或取景也跨不过去。**

全部可运行的代码都在 `reference/` 中：`bmcp_client.py`（套接字）、`build_tender.py`（完整飞船——放样、凹槽、greeble、材质、灯光）、`cinematic.py`（贴图、行星、星空、镜头运动、镜头光效）。运行 `cat build_tender.py cinematic.py | python3 bmcp_client.py code` 即可在约两秒内从零重建整个场景。

## 连接

BlenderMCP 的插件在 `localhost:9876` 打开一个 JSON 套接字。MCP 工具在会话启动时加载，因此如果服务器是在会话中途注册的，它们不会出现在你的工具列表里——请直接与套接字对话。那是同一条通道：

```python
import json, socket
def send(cmd, params=None, timeout=900.0):
    s = socket.socket(); s.settimeout(timeout); s.connect(("localhost", 9876))
    s.sendall(json.dumps({"type": cmd, "params": params or {}}).encode())
    buf = b""
    while True:
        buf += s.recv(65536)
        try: return json.loads(buf.decode())
        except json.JSONDecodeError: continue

def run(code): return send("execute_code", {"code": code})
```

命令：`get_scene_info`、`get_object_info`、`execute_code`、`get_viewport_screenshot`。`execute_code` 才是关键的那个——下面的一切都是经由它发送的 `bpy`。

插件**无法在后台模式下启动它的服务器**。Blender 必须以 GUI 打开，侧边栏（`N`）→ BlenderMCP → *Connect to Claude*。套接字只在那个开关打开期间存在。如果你在 Blender 已在运行时安装插件，那个实例并没有它——请重启 Blender。

## 建模：放样、凹槽、层级

三种技巧，按影响力排序。

**1. 放样截面；绝不堆叠基本体。** 定义一个宽度、高度与倒角沿长度变化的轮廓，把它扫过各个站位，桥接成一片连续的蒙皮。带独立倒角宽度的八边形读作轧制板材；超椭圆读作模压穿梭机。扫动“方正度”可以让方正的船尾变成多面的船首，且无缝。

```python
def oct_ring(w, h, cx, cz):
    a, b = w * 0.5, h * 0.5
    return [( a, b - cz), ( a - cx,  b), (-(a - cx),  b), (-a,  b - cz),
            (-a, -(b - cz)), (-(a - cx), -b), ( a - cx, -b), ( a, -(b - cz))]

def loft(name, sections, mat, cuts=0):   # sections: (y, w, h, cx, cz, dz)
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z + dz)) for (x, z) in oct_ring(w, h, cx, cz)]
             for (y, w, h, cx, cz, dz) in sections]
    for A, B in zip(rings, rings[1:]):
        for i in range(8):
            j = (i + 1) % 8
            bm.faces.new((A[i], A[j], B[j], B[i]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts,
                                  use_grid_fill=True)
    ...
```

让轮廓**阶梯式，而非平滑收窄**——平行的中段、一个肩部、一个钝船首。阶梯正是眼睛用来丈量长度的东西。矛尖状船首读作战斗机；钝头读作勤务船。

**2. 把细节切进蒙皮。** 面板舱、沟槽、龙骨通道与机库，是对选中面做 `bmesh.ops.inset_region`，再沿面法线向内平移。粘在表面上的盒子永远看起来是粘上去的。

```python
sel = [f for f in bm.faces if pick(f)]
bmesh.ops.inset_region(bm, faces=sel, thickness=1.2, depth=0.0,
                       use_even_offset=True, use_boundary=True)
for f in sel:
    bmesh.ops.translate(bm, verts=list(f.verts), vec=f.normal.normalized() * -0.7)
    f.material_index = i_struct        # 凹槽中的另一种材质
```

**3. 细节层级，包括克制。** 三个层级：主质量体、中型面板舱、约**船体长度 1/60** 的精细 greeble。用 `inset_individual` + 顶出或沉入做 greeble，使其成为整合的几何体。关键在于：**留出干净的板面**。第一版把每个面都 greeble 过的尝试读作噪音；分区处理并放过背部，才让它读作细节。细节只有对着无细节的东西才成立。

船体用平直着色（flat-shade）。是板材，不是塑料。

## 贴图（程序化——无图像贴图）

两个节点完成了让涂装看起来是建造出来的大部分工作：

- **每块板的色调差异。** 在物体坐标上 `TexVoronoi`（scale ~0.16）、`RGBToBW`、重映射到 0.9–1.1、乘入基础色。真正的板材由从不完全一致的批次焊接而成，而那种不一致正是大部分观感。
- **边缘磨损。** `NewGeometry → Pointiness` 重映射到约 0.49–0.56，向裸露金属混合并驱动 Metallic 升高。在每个凸角免费获得，而且恰好是现实中油漆脱落的地方。仅 Cycles。

另外有用的：朝星面法线上的日晒褪色（`dot(Normal, sun_dir)`）与朝船尾的烟灰（物体空间 Y）——这正是一个有色实体变成一件用过的物体的关键。

## 照亮虚空

一盏硬主光（`SUN`，`angle ≈ 0.9°`）、一盏大型弱区域光作星云/行星反照补光（色调偏向主光的补色）、以及一盏冷色轮廓光，让任何东西都不至于融进背景。阴影永远不是黑的。

**把相机放在主光一侧。** 从阴影侧拍摄的英雄角度完全由补光支撑，读作洗白——这曾浪费两次渲染。

星星：用 `Voronoi`，不要用阈值化噪波。噪波无法分离密度与大小——提高频率缩小星点会得到成千上万颗；加宽亮带又得到漫天飞雪。用 Voronoi，**单元尺度决定数量，距离阈值决定大小**，而每单元随机值丢弃大部分并改变亮度：

- 球面上的单元数 ≈ `4π·scale²`，而一帧只看到其中不到 1%，因此 `scale=30` 在画面里大约只有*十五个*单元。用 `scale ≈ 110`。
- 角半径 = `threshold / scale`；两者一起移动。

## 渲染与相机

从场景包围盒推导相机，绝不要手工放置——手放的相机最后会跑到飞船内部：

```python
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
ctr = (lo + hi) / 2; rad = max((p - ctr).length for p in pts)
cam.location = ctr + direction * (rad / math.tan(cam.data.angle / 2) * 1.05)
cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
```

镜头用的合成器：`Glare` Fog Glow（晕光）→ `Glare` Streaks（变形）→ `Lensdist` dispersion（色差）。使用 AgX；不要碰 `renderer.toneMapping` 之类的等价物。

草稿 64 采样 / 1280×720（约 2 s），成品 96–400 / 1920×1080（M 系列 GPU 上约 4–8 s）。迭代很便宜——持续渲染并*观察*。

## 真正耗时的陷阱

- **相机在几何体内会让渲染时间贵 80 倍。** 同一场景 166 s 对比 2 s，源于近场弹射。一帧突然变慢意味着先检查相机，再动采样数。
- **背景几何体必须仅相机可见。** 一个 2600 单位的自发光大气壳在每次着色点重要性采样时都成了区域光：**145 s → 4.3 s**，只需把 `visible_diffuse/glossy/transmission/volume_scatter/shadow = False`。行星与天空盒始终要这么做。
- **`o.scale = size` 后再加倒角修改器会变成枕头。** 倒角在局部空间工作，因此单位立方体上 0.4 m 的倒角是 40% 的圆角，然后又被拉伸。先 `bpy.ops.object.transform_apply(scale=True)`。
- **`matrix_parent_inverse = parent.matrix_world.inverted()` 会抵消父级。** 那正是“保持变换”惯用法。如果你想要子级定位在父级空间中并继承其旋转，请把父级逆矩阵留为恒等。症状：旋转父级毫无作用。
- **绕错误轴的旋转会悄悄变成看不见的东西。** 法线为 +X 的面板绕 X 旋转时朝向不变。请用世界法线对照视图向量来测量，而不是靠推理。
- **`To Min > To Max` 且钳制的 Map Range 会塌缩到零。** 它钳制到一个反转区间。改用 `SUBTRACT` 节点来反转。
- **RGBA 模式下的 Mix 节点可能悄悄丢弃一个分支。** 它携带多个名为 "Factor" 的插座；按名字设置可能命中一个未使用的。要组合世界贡献，请用两个 `Background` 节点接一个 `Add Shader`——那才是它的本来面目。
- **图像预览会降采样。** 4 像素的星星在 1920×1080 预览里会平均消失。先 1:1 裁切并数值统计亮像素，再断定什么东西没渲染出来。

## Blender 5.x API 变化（4.x 代码在这上面全部失败）

- `Scene.node_tree` 已消失 → `Scene.compositing_node_group`，而且 `CompositorNodeComposite` 不再存在；组的输出*就是*结果。
- **合成组必须包含一个 `CompositorNodeRLayers`。** 从 Group Input 喂给它，就没有任何东西依赖渲染，于是 Blender 完全跳过渲染，在 0.1 s 内写出一帧**透明黑帧**。异常快的渲染就是此 Bug。
- `Action.fcurves` 已消失（插槽化动作）。请在插入关键帧*之前*通过 `context.preferences.edit.keyframe_new_interpolation_type` 设置插值。
- Glare/Lensdist 设置从属性移到了**插座**上，且枚举接受显示名：`"Fog Glow"`、`"Streaks"`、`"High"`——不是 `FOG_GLOW`。
- 旧插件仍安装到 `~/Library/Application Support/Blender/<ver>/scripts/addons/`。

## 导出到本游戏

游戏**程序化**构建船壳（`src/gfx/greeble.js`、`src/ship/hull.js`），不携带任何构建时资产——树里没有 `GLTFLoader`。因此：

- 惯用路径是把放样/凹槽方法移植进 greeble 套件，而不是加载网格。
- 如果确实要导出：`bpy.ops.export_scene.gltf(export_format='GLB', use_selection=True, export_apply=True, export_yup=True)` 到 `public/models/`。程序化节点材质**不会**存活——导出平涂基础色，让游戏的 `dress()` 做日晒/烟灰/板材。
- 以米建模；游戏是 1 单位 = 1 公里，因此在新根上缩放 0.001（且绝不要对 greeble 套件构建的任何东西调用 `setScalar`）。
- **导出前按材质合并。** 一个 Blender 物体变成一个 glTF 节点、一次绘制调用——这艘船松散导出在 11 种材质下是 78 次调用。先按材质组 `bpy.ops.object.join()`，让网格以约 11 次绘制到达。`survey.mjs` 会报告绘制调用；添加任何东西后检查它。
- `KHR_materials_emissive_strength` 确实能挺过往返，因此导航灯、舷窗玻璃与合唱团自发光保持其创作的强度。
