# -*- coding: utf-8 -*-
"""把每个宠物包 frames/ 里各动作的帧拼成对照图，输出到 docs/frames/<pet>/。

用法：  py -3 tools/preview_frames.py [宠物id ...] [--states=idle,walk,fly]
不带参数则输出全部宠物、全部动作。
"""
import os
import sys

from PIL import Image, ImageDraw

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PETS_DIR = os.path.join(ROOT, "assets", "pets")
DOCS = os.path.join(ROOT, "docs", "frames")
CELL = 240
PAD_TOP = 22


def sheet(frames_root, state):
    folder = os.path.join(frames_root, "display", state)
    if not os.path.isdir(folder):
        return None
    files = sorted(f for f in os.listdir(folder) if f.endswith(".png"))
    if not files:
        return None
    out = Image.new("RGB", (CELL * len(files), CELL + PAD_TOP), (255, 255, 255))
    draw = ImageDraw.Draw(out)
    for i, name in enumerate(files):
        img = Image.open(os.path.join(folder, name)).convert("RGB")
        img = img.resize((CELL, CELL), Image.LANCZOS)
        out.paste(img, (i * CELL, PAD_TOP))
        draw.text((i * CELL + 8, 5), "%s / %s" % (state, name), fill=(0, 0, 0))
        draw.line([(i * CELL, PAD_TOP), (i * CELL, CELL + PAD_TOP)], fill=(228, 228, 228))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    states = []
    for a in sys.argv[1:]:
        if a.startswith("--states="):
            states = a.split("=", 1)[1].split(",")
    packs = sorted(p for p in os.listdir(PETS_DIR)
                   if os.path.isdir(os.path.join(PETS_DIR, p, "frames", "display")))
    if args:
        packs = [p for p in packs if p in args]
    for pid in packs:
        frames_root = os.path.join(PETS_DIR, pid, "frames")
        out_dir = os.path.join(DOCS, pid)
        os.makedirs(out_dir, exist_ok=True)
        todo = states or sorted(os.listdir(os.path.join(frames_root, "display")))
        made = []
        for state in todo:
            img = sheet(frames_root, state)
            if img is None:
                continue
            img.save(os.path.join(out_dir, "preview_%s.png" % state))
            made.append(state)
        print("%-9s %s" % (pid, ", ".join(made)))


if __name__ == "__main__":
    main()
