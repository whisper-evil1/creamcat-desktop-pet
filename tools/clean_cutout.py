# -*- coding: utf-8 -*-
"""清掉帧里残留的"白色地板 / 地面投影"，只改 alpha，不动 RGB。

为什么需要这一步
--------------
AI 原图里角色脚下有一块近白的地面反光，抠图时被当成主体留了下来。
桌宠用 `-transparentcolor` 抠背景，半透明像素会被压成实色，
于是那块地面就变成一条硬边白带（用户截图里脚下那块白）。

三步处理
--------
1. **去地板**：只动"内容框底部 BAND 行内、颜色中性且亮"的像素，并且要求
   它跟外部透明区连通——角色内部的浅色（肚子、肉垫）够不到外部，不受影响。
2. **孔洞回填**：删完以后凡是变成"封闭孔洞"（不连通到画布边）的像素全部还原，
   避免在浅色毛上打洞。
3. **底边软化**：最后几行按渐变降 alpha，把"被画布裁断的硬直边"化成柔和过渡。

用法
----
    python tools/clean_cutout.py                 # 处理所有宠物
    python tools/clean_cutout.py meimei yunxi    # 只处理指定宠物
    python tools/clean_cutout.py --preview       # 只出前后对比图，不写盘
    python tools/clean_cutout.py --restore       # 从 frames_raw/ 还原

原始帧首次处理前自动备份到 `assets/pets/<id>/frames_raw/`。
依赖 numpy（一次性素材工具，桌宠运行时不依赖）。
"""
import os
import shutil
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PETS_DIR = os.path.join(ROOT, "assets", "pets")
STATES = ("idle", "walk", "walk_left", "fly", "fly_left", "parachute",
          "drag", "drop", "sleep", "greet", "interact")

SAT_MAX = 24        # 最大通道差：暖白/奶白毛的饱和度更高，不会被误判
LUM_MIN = 185       # 最低亮度：地面是亮的
BAND = 14           # 只看内容框底部往上 14px
TRANS = 45          # alpha 低于它就算"已透明"，用于连通性判断
FADE = (0.82, 0.55, 0.3)   # 底部 3 行的 alpha 系数（上→下）


def _load(path):
    return Image.open(path).convert("RGBA")


def _components(mask):
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    out = []
    ys, xs = np.where(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        q = deque([(x0, y0)])
        seen[y0, x0] = True
        comp = []
        while q:
            cx, cy = q.popleft()
            comp.append((cx, cy))
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((nx, ny))
        out.append(comp)
    return out


def clean(img):
    """返回 (新图, 删除像素数, 回填像素数)。"""
    arr = np.asarray(img)
    alpha = arr[:, :, 3].astype(int)
    rgb = arr[:, :, :3].astype(int)
    h, w = alpha.shape

    rows = np.where((alpha > 60).any(axis=1))[0]
    if len(rows) == 0:
        return img, 0, 0
    y1 = int(rows.max())

    lum = (rgb[:, :, 0] * 299 + rgb[:, :, 1] * 587 + rgb[:, :, 2] * 114) // 1000
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    yy = np.arange(h)[:, None]

    kill = (sat <= SAT_MAX) & (lum >= LUM_MIN) & (alpha > 0) & (yy >= y1 - BAND)
    out = np.array(alpha, dtype=np.uint8)
    restored = 0
    if kill.any():
        out[kill] = 0
        # 孔洞回填：删完变成"封闭孔洞"的还原，防止啃出洞
        trans = out <= TRANS
        restore = np.zeros((h, w), dtype=bool)
        for comp in _components(trans):
            if any(cx in (0, w - 1) or cy in (0, h - 1) for cx, cy in comp):
                continue            # 连到画布边 = 外部，不回填
            for cx, cy in comp:
                if kill[cy, cx]:
                    restore[cy, cx] = True
        out[restore] = alpha[restore]
        restored = int(restore.sum())

    # 底边软化：被画布裁断的硬直边化成渐变
    for i, k in enumerate(FADE):
        y = y1 - (len(FADE) - 1) + i
        if 0 <= y < h:
            out[y] = (out[y] * k).astype(np.uint8)

    res = img.copy()
    res.putalpha(Image.fromarray(out))
    removed = int(kill.sum()) - restored if kill.any() else 0
    return res, removed, restored


def frame_dirs(pid):
    base = os.path.join(PETS_DIR, pid, "frames")
    for state in STATES:
        d = os.path.join(base, state)
        if os.path.isdir(d):
            yield d
    for state in STATES:
        d = os.path.join(base, "display", state)
        if os.path.isdir(d):
            yield d


def _render(x):
    bg = Image.new("RGBA", x.size, (24, 32, 42, 255))
    return Image.alpha_composite(bg, x).convert("RGB").resize((306, 306), Image.LANCZOS)


def preview(pets):
    CW, CH = 500, 88
    sheet = Image.new("RGB", (CW * 2 + 8, CH * len(pets)), (8, 10, 12))
    for i, pid in enumerate(pets):
        d = os.path.join(PETS_DIR, pid, "frames", "idle")
        if not os.path.isdir(d):
            continue
        name = sorted(x for x in os.listdir(d) if x.endswith(".png"))[0]
        src = _load(os.path.join(d, name))
        res, removed, restored = clean(src)
        sheet.paste(_render(src).crop((20, 262, 292, 306)).resize((CW, CH), Image.Resampling.NEAREST),
                    (0, i * CH))
        sheet.paste(_render(res).crop((20, 262, 292, 306)).resize((CW, CH), Image.Resampling.NEAREST),
                    (CW + 8, i * CH))
        print("%-9s removed=%-4d restored=%d" % (pid, removed, restored))
    out = os.path.join(ROOT, "_raw", "check", "clean_preview.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print("preview ->", out)


def main(argv):
    restore = "--restore" in argv
    preview_only = "--preview" in argv
    pets = [a for a in argv if not a.startswith("--")]
    if not pets:
        pets = sorted(p for p in os.listdir(PETS_DIR)
                      if os.path.isfile(os.path.join(PETS_DIR, p, "frames", "manifest.json")))

    if preview_only:
        preview(pets)
        return 0

    for pid in pets:
        base = os.path.join(PETS_DIR, pid, "frames")
        if not os.path.isdir(base):
            print("skip", pid)
            continue
        raw = os.path.join(PETS_DIR, pid, "frames_raw")
        if restore:
            if os.path.isdir(raw):
                shutil.rmtree(base)
                shutil.copytree(raw, base)
                print("restored", pid)
            continue
        # 每次都从原始备份重来：保证反复运行结果一致（底边渐变不会被叠加）
        if not os.path.isdir(raw):
            shutil.copytree(base, raw)
        else:
            shutil.rmtree(base)
            shutil.copytree(raw, base)
        removed = restored = 0
        for d in frame_dirs(pid):
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".png"):
                    continue
                p = os.path.join(d, fn)
                res, rm, rs = clean(_load(p))
                if rm:
                    res.save(p)
                removed += rm
                restored += rs
        print("%-9s removed=%-6d restored=%d" % (pid, removed, restored))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
