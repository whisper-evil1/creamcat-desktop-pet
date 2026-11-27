# -*- coding: utf-8 -*-
"""把 assets/pets/<id>/source 里的 AI 图集切成该宠物的动作帧，输出到 assets/pets/<id>/frames。

用法：
    py -3 build_assets.py                # 构建全部宠物包
    py -3 build_assets.py naitang        # 只构建指定宠物（可多个）

流程：抠白底 -> 姿态清理 -> 序列统一缩放 -> 逐帧写 alpha 真值帧 + display 展平帧 -> 写 manifest.json

关键规则（都是踩过坑总结的）：
1. 封闭白底要单独补刀：伞下三角白区被伞面/绳索包围，边缘 flood fill 够不到，必须按连通域清掉。
2. 多帧必须用序列中位 bbox 统一缩放，否则伞/翅膀张开时角色会一帧大帧小。
3. 降落伞的绳子不能靠"平移切割伞面"来变长（会留下平直断层），只能对伞与角色之间那一段做局部纵向拉伸。
4. 跑步要用真正的侧面前进素材：严格侧面、尾巴在身后、不挡腿。
5. 新宠物没画降落伞图集时，用 assets/shared/canopy.png 伞面 + 程序合成（张开 = 伞面等比放大）。
6. 单帧动作（idle/sleep/drop/greet）在 manifest 里声明后，G2 反伪动画门禁会豁免。
"""
import json
import os
import sys
from collections import deque

from PIL import Image, ImageChops, ImageDraw, ImageFilter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.abspath(__file__))
PETS_DIR = os.path.join(ROOT, "assets", "pets")
SHARED = os.path.join(ROOT, "assets", "shared")
REGISTRY = os.path.join(ROOT, "pets.json")

KEY = (0, 255, 1)
CANVAS = 360
HEIGHT = 250

# 每个动作在 manifest 里的播放参数与门禁声明
ACTION_SPEC = {
    "idle": {"fps": 1, "loop": True},
    "walk": {"fps": 8, "loop": True, "bob_only": True},
    "walk_left": {"fps": 8, "loop": True, "bob_only": True},
    "fly": {"fps": 10, "loop": True},
    "fly_left": {"fps": 10, "loop": True},
    "parachute": {"fps": 8, "loop": False, "hold_last": True},
    "drag": {"fps": 6, "loop": True},
    "drop": {"fps": 6, "loop": False},
    "sleep": {"fps": 1, "loop": True},
    "greet": {"fps": 1, "loop": False},
    "interact": {"fps": 6, "loop": False},
}


# ---------------- 基础图像工具 ----------------

def is_near_white(c):
    return c[0] > 236 and c[1] > 236 and c[2] > 236 and max(c) - min(c) < 20


def fill_enclosed_white(work, top_ratio=0.55, min_area=20):
    """把上半球形道具内部的封闭白底换成键色；不碰下方角色白毛。"""
    px = work.load()
    w, h = work.size
    limit = int(h * top_ratio)
    seen = set()
    for y in range(limit):
        for x in range(w):
            if (x, y) in seen or not is_near_white(px[x, y]):
                continue
            q = deque([(x, y)])
            seen.add((x, y))
            comp = []
            while q:
                a, b = q.popleft()
                comp.append((a, b))
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    na, nb = a + da, b + db
                    if (0 <= na < w and 0 <= nb < limit and (na, nb) not in seen
                            and is_near_white(px[na, nb])):
                        seen.add((na, nb))
                        q.append((na, nb))
            if len(comp) >= min_area:
                for a, b in comp:
                    px[a, b] = KEY


def cutout(cell, thresh=42, white_top=0.0):
    """边缘 flood-fill 键控 -> alpha；white_top>0 时补刀封闭白底。"""
    work = cell.convert("RGB")
    w, h = work.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for s in seeds:
        ImageDraw.floodfill(work, s, KEY, thresh=thresh)
    if white_top:
        fill_enclosed_white(work, white_top)
    src = cell.convert("RGBA")
    sp, wp = src.load(), work.load()
    is_key = lambda c: (abs(c[0] - KEY[0]) < 12 and abs(c[1] - KEY[1]) < 12
                        and abs(c[2] - KEY[2]) < 12)
    mask = Image.new("L", cell.size, 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            sr, sg, sb, sa = sp[x, y]
            mp[x, y] = 0 if (is_key(wp[x, y]) or sa < 110) else 255
    # 腐蚀 2px 去掉羽化彩边
    eroded = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MinFilter(3))
    out = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    ep, op = eroded.load(), out.load()
    for y in range(h):
        for x in range(w):
            if ep[x, y]:
                sr, sg, sb, _ = sp[x, y]
                op[x, y] = (sr, sg, sb, 255)
    return out


def key_shadow(img, v_max=0.955, sat_max=0.11):
    """抠掉 AI 图里烤进来的浅灰投影；被误删的内部阴影再用"孔洞回填"补回来。"""
    w, h = img.size
    px = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 10:
                continue
            mx = max(r, g, b)
            sat = (mx - min(r, g, b)) / max(1, mx)
            if mx / 255.0 <= v_max and sat <= sat_max:
                px[x, y] = (r, g, b, 0)     # 先当投影删掉，RGB 留着待回填
    # 从四边泛洪，凡是"从边界能走到的透明区"才是真外部；走不到的是内部孔洞
    outside = set()
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if px[x, y][3] < 10 and (x, y) not in outside:
                outside.add((x, y)); q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if px[x, y][3] < 10 and (x, y) not in outside:
                outside.add((x, y)); q.append((x, y))
    while q:
        a, b = q.popleft()
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            na, nb = a + da, b + db
            if 0 <= na < w and 0 <= nb < h and (na, nb) not in outside:
                if px[na, nb][3] < 10:
                    outside.add((na, nb)); q.append((na, nb))
    for y in range(h):
        for x in range(w):
            if px[x, y][3] < 10 and (x, y) not in outside:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 255)
    return img


def alpha_bbox(img):
    return img.getchannel("A").point(lambda v: 255 if v > 100 else 0).getbbox()


def clean_pad(img, chroma=12, vmin=190, min_area=150, aspect=2.2, low=0.45,
              fringe_vmin=215, fringe_chroma=8, fringe_band=0.12):
    """清掉 AI 原图自带的地面投影残影（脚边那一摊近白/近灰的"影子"）。

    只碰两种像素，避免啃到白色毛发：
    1) 与透明区相邻、颜色接近中性白、形状扁平且位于画面下部的连通块（整块影子）；
    2) 紧贴透明边、位于底部窄带里的中性白像素（影子被切碎后的细边）。
    暖白/奶白毛发饱和度明显更高，不会被误删。
    """
    w, h = img.size
    px = img.load()
    bb = alpha_bbox(img)
    if bb is None:
        return img
    ylow = int(bb[1] + (bb[3] - bb[1]) * low)
    yfringe = int(bb[1] + (bb[3] - bb[1]) * (1 - fringe_band))
    neutral = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 20 and min(r, g, b) >= vmin and (max(r, g, b) - min(r, g, b)) <= chroma:
                neutral[y][x] = True
    trans = [[px[x, y][3] < 20 for x in range(w)] for y in range(h)]
    kill = Image.new("L", (w, h), 0)
    kp = kill.load()
    seen = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if not neutral[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            comp = []
            touch = False
            while q:
                a_, b_ = q.popleft()
                comp.append((a_, b_))
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    na, nb = a_ + da, b_ + db
                    if 0 <= na < w and 0 <= nb < h:
                        if trans[nb][na]:
                            touch = True
                        elif neutral[nb][na] and not seen[nb][na]:
                            seen[nb][na] = True
                            q.append((na, nb))
            if not touch or len(comp) < min_area:
                continue
            xs = [p[0] for p in comp]
            ys = [p[1] for p in comp]
            cw, ch = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
            if ch > 0 and cw / ch >= aspect and min(ys) >= ylow:
                for a_, b_ in comp:
                    kp[a_, b_] = 255
    # 细边：底部窄带里紧贴透明区的中性白
    for y in range(yfringe, h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 20 or min(r, g, b) < fringe_vmin:
                continue
            if (max(r, g, b) - min(r, g, b)) > fringe_chroma:
                continue
            near = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                na, nb = x + dx, y + dy
                if 0 <= na < w and 0 <= nb < h and trans[nb][na]:
                    near = True
                    break
            if near:
                kp[x, y] = 255
    out = img.copy()
    out.putalpha(ImageChops.subtract(img.getchannel("A"),
                                     kill.filter(ImageFilter.GaussianBlur(0.7))))
    return out


def content_area(img, bbox=None):
    """不透明像素数量：用来判断两只姿态"看起来谁更大"（面积比 = 视觉体量比）。"""
    a = img.getchannel("A").point(lambda v: 255 if v > 100 else 0)
    if bbox:
        a = a.crop(bbox)
    return sum(1 for v in a.getdata() if v)


def normalize_scaled(img, bbox=None, scale=1.0, canvas_w=CANVAS):
    """按给定缩放系数落到画布底部居中（系数优先，宽度放不下时才收）。"""
    bbox = bbox or alpha_bbox(img)
    if bbox is None:
        raise RuntimeError("empty frame after cutout")
    x0, y0, x1, y1 = bbox
    sub = img.crop(bbox)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    if bw * scale > canvas_w - 6:
        scale = (canvas_w - 6) / bw
    nw, nh = max(1, int(bw * scale)), max(1, int(bh * scale))
    sub = sub.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_w, canvas_w), (0, 0, 0, 0))
    canvas.paste(sub, ((canvas_w - nw) // 2, canvas_w - nh), sub)
    return canvas


def normalize(img, bbox=None, target_h=HEIGHT, canvas_w=CANVAS):
    """按给定 bbox 缩放；bbox=None 时用自身。同序列帧必须传同一个 bbox。

    高度优先按 target_h，但如果宽度放不下画布（比如趴睡、躺平），就改为按宽度缩放，
    否则左右会被裁掉。
    """
    bbox = bbox or alpha_bbox(img)
    if bbox is None:
        raise RuntimeError("empty frame after cutout")
    x0, y0, x1, y1 = bbox
    sub = img.crop(bbox)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    scale = target_h / bh
    if bw * scale > canvas_w - 6:
        scale = (canvas_w - 6) / bw
    nw, nh = max(1, int(bw * scale)), max(1, int(bh * scale))
    sub = sub.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_w, canvas_w), (0, 0, 0, 0))
    canvas.paste(sub, ((canvas_w - nw) // 2, canvas_w - nh), sub)
    return canvas


def erase_ellipse(img, cx, cy, rx, ry, feather=14):
    """用羽化椭圆把指定区域擦成透明（去掉 AI 多画的尾巴/静态云朵等）。"""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    out = img.copy()
    keep = Image.composite(Image.new("L", (w, h), 0), img.getchannel("A"), mask)
    out.putalpha(keep)
    return out


def sequence_bbox(frames):
    """取序列 bbox 的中位尺寸，合并成统一参考 bbox（底部对齐）。"""
    bs = [alpha_bbox(f) for f in frames]
    bs = [b for b in bs if b]
    mw = sorted(b[2] - b[0] for b in bs)[len(bs) // 2]
    mh = sorted(b[3] - b[1] for b in bs)[len(bs) // 2]
    bottom = max(b[3] for b in bs)
    cx = sum((b[0] + b[2]) / 2 for b in bs) / len(bs)
    return (int(cx - mw / 2), int(bottom - mh), int(cx + mw / 2), int(bottom))


def flatten(img):
    """显示图：透明区填纯键色、alpha 一律 255，消除边缘彩边。"""
    flat = Image.new("RGBA", img.size, KEY + (255,))
    sp, dp = img.load(), flat.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if sp[x, y][3] > 127:
                dp[x, y] = sp[x, y][:3] + (255,)
    return flat


def grid(path, rows, cols, inset=3):
    """按行列切格。inset 往内缩几像素：AI 图集的格线常是浅灰细线，
    会把每格白色背景围起来导致 flood fill 抠不进去。"""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * w // cols, r * h // rows
            x1, y1 = (c + 1) * w // cols, (r + 1) * h // rows
            yield im.crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))


def lengthen_strings(img, band, stretch=40):
    """局部垂直拉伸伞下沿与角色之间的区间来加长吊绳（不平移、不切割，绝不断层）。"""
    y1, y2 = band
    w, h = img.size
    out = Image.new("RGBA", (w, h + stretch), (0, 0, 0, 0))
    out.paste(img.crop((0, 0, w, y1)), (0, 0))
    middle = img.crop((0, y1, w, y2)).resize((w, y2 - y1 + stretch), Image.LANCZOS)
    out.paste(middle, (0, y1))
    out.paste(img.crop((0, y2, w, h)), (0, y2 + stretch))
    return out


# ---------------- 降落伞：程序合成 ----------------

def load_canopy():
    path = os.path.join(SHARED, "canopy.png")
    if not os.path.exists(path):
        return None
    return Image.open(path).convert("RGBA")


def canopy_contour(canopy):
    """每列最低的不透明像素 y，用来把吊绳挂在伞沿的真实位置。"""
    a = canopy.getchannel("A")
    w, h = canopy.size
    px = a.load()
    out = []
    for x in range(w):
        low = h - 1
        for y in range(h - 1, -1, -1):
            if px[x, y] > 120:
                low = y
                break
        out.append(low)
    return out


def rope_anchors(canopy, contour, bands=((0.10, 0.28), (0.28, 0.44), (0.44, 0.56),
                                         (0.56, 0.72), (0.72, 0.90))):
    """在伞沿上取 5 个挂绳点：每个横带里找伞沿最低的那一列（扇形褶的谷）。

    不能直接按固定比例取列——伞面最外侧那一列的最低点落在伞的"腰部"，
    从那里拉绳会像从伞侧面横着支出来一根铁丝。
    """
    w = canopy.width
    pts = []
    for lo, hi in bands:
        x0, x1 = int(w * lo), max(int(w * lo) + 1, int(w * hi))
        best = max(range(x0, x1), key=lambda x: contour[x])
        pts.append(best)
    return pts


def _rope(draw, p0, p1, width=2, fill=(168, 130, 96, 238)):
    """画一根带轻微外鼓的吊绳。

    直线画出来像铁丝，真实的绳子受力后向外弓一点点，弓 3% 就够。
    """
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    n = (dx * dx + dy * dy) ** 0.5
    if n < 1:
        return
    # 控制点：中点沿垂直于绳子的方向外推；方向固定朝"远离中心"
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    sag = n * 0.035
    side = 1.0 if x0 < CANVAS / 2 else -1.0
    nx, ny = -dy / n, dx / n
    if nx * side < 0:
        nx, ny = -nx, -ny
    cx_, cy_ = mx + nx * sag, my + ny * sag
    pts = []
    for i in range(9):
        t = i / 8.0
        xt = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx_ + t * t * x1
        yt = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy_ + t * t * y1
        pts.append((xt, yt))
    draw.line(pts, fill=fill, width=width, joint="curve")


def compose_parachute(idle, canopy, scales=(0.52, 0.72, 0.90, 1.00),
                      body_h=168, chute_span=128, base_ratio=1.33):
    """用共享伞面 + 宠物站立帧合成降落伞。

    版式照星狐那套手绘伞实测出来的规律：**伞顶位置固定、伞往下张开、吊绳随之变短**
    （星狐 4 帧里"伞顶到头顶"的总跨度基本恒定）。所以不能用"伞沿钉死、伞往上长"，
    那样第一帧会像扣在脑袋上的一顶帽子。
    chute_span = 伞顶到头顶的固定跨度；base_ratio = 伞面宽 / 身体宽（星狐实测 1.33）。
    """
    pb = alpha_bbox(idle)
    if pb is None:
        raise RuntimeError("idle frame is empty")
    body = idle.crop(pb)
    scale = body_h / max(1, pb[3] - pb[1])
    body = body.resize((max(1, int(body.width * scale)), body_h), Image.LANCZOS)
    bx = (CANVAS - body.width) // 2
    by = CANVAS - body_h                      # 头顶（身体包围盒上沿）
    head_top = by

    contour = canopy_contour(canopy)
    anchors = rope_anchors(canopy, contour)
    aspect = canopy.height / canopy.width

    # 伞面尺寸跟着身体宽度走，同时保证放大后伞顶不被 360 画布切掉
    base_w = max(1, int(body.width * base_ratio))
    ctop = max(2, head_top - chute_span)      # 伞顶钉死在这里，各帧不动
    max_h = max(40, head_top + 4 - ctop)
    if base_w * aspect * max(scales) > max_h:
        base_w = max(1, int(max_h / (aspect * max(scales))))

    frames = []
    for s in scales:
        canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        cw = max(2, int(base_w * s))
        ch = max(2, int(canopy.height * cw / canopy.width))
        c = canopy.resize((cw, ch), Image.LANCZOS)
        cx = (CANVAS - cw) // 2
        cy = ctop
        canvas.alpha_composite(c, (cx, cy))

        draw = ImageDraw.Draw(canvas)
        apex = (CANVAS // 2, head_top + 8)     # 头顶上的唯一挂点
        k = cw / canopy.width                  # 轮廓坐标 -> 画布坐标
        for sx in anchors:
            ax = cx + sx * k
            ay = cy + contour[sx] * k
            _rope(draw, (ax, ay), apex)
        # 挂点打一个小结，避免五根线在空中突然收口
        draw.ellipse([apex[0] - 3, apex[1] - 2, apex[0] + 3, apex[1] + 2],
                     fill=(150, 112, 78, 245))

        canvas.alpha_composite(body, (bx, by))
        frames.append(canvas)
    return frames


# ---------------- 构建单个宠物包 ----------------

def build_pet(entry):
    pid = entry["id"]
    name = entry.get("name", pid)
    src = os.path.join(PETS_DIR, pid, "source")
    out = os.path.join(PETS_DIR, pid, "frames")
    if not os.path.isdir(src):
        print("SKIP %s（没有 source 目录）" % pid)
        return 0
    os.makedirs(out, exist_ok=True)
    spec = entry["build"]
    erase_map = spec.get("erase", {})
    actions = {}

    def save(state, idx, img):
        d = os.path.join(out, state)
        dd = os.path.join(out, "display", state)
        os.makedirs(d, exist_ok=True)
        os.makedirs(dd, exist_ok=True)
        img.save(os.path.join(d, "frame_%02d.png" % idx))
        flatten(img).save(os.path.join(dd, "frame_%02d.png" % idx))
        actions[state] = actions.get(state, 0) + 1

    def cut(cell, thresh=42, white_top=0.0, state=None):
        img = cutout(cell, thresh=thresh, white_top=white_top)
        if spec.get("shadow_key"):
            # 仅对明确声明需要清投影的宠物启用：奶白/奶油色角色会被误删毛面
            img = key_shadow(img)
        if spec.get("clean_pad"):
            img = clean_pad(img)
        for (cx, cy, rx, ry, fe) in erase_map.get(state or "", []):
            img = erase_ellipse(img, cx, cy, rx, ry, fe)
        return img

    # 1) 姿态表：idle / sleep / drag / interact
    #    先全部抠出来，再用 idle 的"内容面积"给其它姿态定统一缩放：
    #    按高度填满会把趴睡/被拎起这类宽姿态整体放大，看起来就比平时大一号。
    raw = {}
    idle_img = None
    for sheet in spec["poses"]:
        cells = list(grid(os.path.join(src, sheet["file"]),
                          sheet.get("rows", 2), sheet.get("cols", 2)))
        thresh = sheet.get("thresh", 12)
        for state, idxs in sheet["map"].items():
            imgs = [cut(cells[i], thresh=thresh, state=state) for i in idxs]
            raw[state] = imgs
            if state == "idle" and idle_img is None:
                idle_img = imgs[0]
    if idle_img is None:
        idle_img = next(iter(raw.values()))[0]
    idle_bb = alpha_bbox(idle_img)
    base_scale = HEIGHT / max(1, idle_bb[3] - idle_bb[1])
    base_scale = min(base_scale, (CANVAS - 6) / max(1, idle_bb[2] - idle_bb[0]))
    ref_area = content_area(idle_img, idle_bb)
    for state, imgs in raw.items():
        bb = sequence_bbox(imgs) if len(imgs) > 1 else alpha_bbox(imgs[0])
        scale = base_scale
        if state != "idle":
            areas = sorted(content_area(f, bb) for f in imgs)
            area = max(1, areas[len(areas) // 2])
            # 面积归一：显示面积与 idle 相同 => 视觉体量一致
            scale = base_scale * (ref_area / area) ** 0.5
            scale = max(base_scale * 0.55, min(base_scale * 1.15, scale))
        for i, f in enumerate(imgs):
            save(state, i, normalize_scaled(f, bb, scale))

    # idle / greet 用同一帧（greet 是打招呼定格）
    idle0 = Image.open(os.path.join(out, "idle", "frame_00.png")).convert("RGBA")
    save("greet", 0, idle0)

    # 2) 跑步：侧面四足交替，统一 bbox 保证大小一致
    run = spec["run"]
    run_cells = list(grid(os.path.join(src, run["file"]),
                          run.get("rows", 2), run.get("cols", 2)))
    run_raw = [cutout(c, thresh=run.get("thresh", 22)) for c in run_cells]
    if spec.get("shadow_key"):
        run_raw = [key_shadow(f) for f in run_raw]
    rb = sequence_bbox(run_raw)
    for i, base in enumerate(normalize(f, rb) for f in run_raw):
        save("walk", i, base)
        save("walk_left", i, base.transpose(Image.Transpose.FLIP_LEFT_RIGHT))

    # 3) 扇翅：cells 指定要用的格（可跳过"完全收拢看起来没翅膀"的那格）
    wing = spec["wing"]
    wing_cells = list(grid(os.path.join(src, wing["file"]),
                           wing.get("rows", 2), wing.get("cols", 2)))
    wing_raw = [cutout(wing_cells[i], thresh=wing.get("thresh", 22))
                for i in wing.get("cells", list(range(len(wing_cells))))]
    wb = sequence_bbox(wing_raw)
    for i, f in enumerate(normalize(f, wb) for f in wing_raw):
        save("fly", i, f)
        save("fly_left", i, f.transpose(Image.Transpose.FLIP_LEFT_RIGHT))

    # 4) 降落伞：优先用画好的图集，否则用共享伞面程序合成
    chute_spec = spec.get("parachute", "composite")
    if isinstance(chute_spec, dict) and chute_spec.get("file"):
        cpath = os.path.join(src, chute_spec["file"])
        cells = list(grid(cpath, chute_spec.get("rows", 2), chute_spec.get("cols", 2)))
        raw = [cutout(c, white_top=0.55) for c in cells]
        bands = chute_spec.get("bands") or []
        if bands:
            stretch = chute_spec.get("stretch", 26)
            raw = [lengthen_strings(f, bands[i], stretch) for i, f in enumerate(raw)]
        cb = sequence_bbox(raw)
        chute = [normalize(f, cb, target_h=chute_spec.get("target_h", 300)) for f in raw]
    else:
        canopy = load_canopy()
        if canopy is None:
            raise RuntimeError("缺少 assets/shared/canopy.png，无法合成降落伞")
        chute = compose_parachute(idle0, canopy,
                                  base_ratio=float(spec.get("chute_ratio", 1.33)))
    for i, f in enumerate(chute):
        save("parachute", i, f)
    save("parachute", len(chute), chute[-1])   # 完全张开后停留一帧

    # 5) 落地定格：用原始立绘
    orig_path = os.path.join(src, spec.get("original", "original.webp"))
    if os.path.exists(orig_path):
        orig = Image.open(orig_path).convert("RGBA")
        if alpha_bbox(orig) is None:
            orig = cutout(orig)
        save("drop", 0, normalize(orig))

    manifest = {
        "pet": pid,
        "name": name,
        "canvas": [CANVAS, CANVAS],
        "key": "#00ff01",
        "actions": {k: dict(ACTION_SPEC.get(k, {"fps": 8, "loop": True}), frames=v,
                            **({"stills": True} if v == 1 else {}))
                    for k, v in sorted(actions.items())},
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("OK  %-9s %-6s frames=%d states=%d" % (pid, name,
                                                 sum(actions.values()), len(actions)))
    return sum(actions.values())


def main():
    with open(REGISTRY, encoding="utf-8") as f:
        registry = json.load(f)
    wanted = [a for a in sys.argv[1:] if not a.startswith("-")]
    pets = registry["pets"]
    if wanted:
        pets = [p for p in pets if p["id"] in wanted]
        if not pets:
            print("没有匹配的宠物：%s" % ", ".join(wanted))
            return 1
    total = 0
    for entry in pets:
        try:
            total += build_pet(entry)
        except Exception as exc:
            print("FAIL %s: %s" % (entry["id"], exc))
    print("--- 合计 %d 帧 ---" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
