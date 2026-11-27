# -*- coding: utf-8 -*-
"""G2 反伪动画门禁（多宠物版）：逐个宠物包检查帧尺寸/alpha，以及多帧之间是否真有姿态变化。

用法：
    py -3 gate_check.py             # 检查 assets/pets 下所有已构建的宠物
    py -3 gate_check.py naitang     # 只检查指定宠物
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 帧分析工具已内联为项目内的 pipeline.py，不再依赖外部专家插件路径
from pipeline import (ALPHA_MIN, ALPHA_MAX, DIFF_MIN, POSE_MIN, POSE_WARN,  # noqa: E402
                      load_rgba, alpha_ratio, frame_diff_ratio, pose_diff_ratio)

ROOT = Path(__file__).parent
PETS_DIR = ROOT / "assets" / "pets"
SINGLE_OK = {"drop", "greet", "sleep", "parachute", "idle"}


def check_pack(frames_dir, wanted_states=None):
    manifest = json.loads((frames_dir / "manifest.json").read_text(encoding="utf-8"))
    ok = True
    warnings = []
    for state, spec in manifest["actions"].items():
        if wanted_states and state not in wanted_states:
            continue
        d = frames_dir / state
        imgs = [load_rgba(p) for p in sorted(d.glob("*.png"))]
        issues = []
        for img in imgs:
            img.load()
            if img.size != tuple(manifest["canvas"]):
                issues.append("size %s" % (img.size,))
            ar = alpha_ratio(img)
            if not (ALPHA_MIN <= ar <= ALPHA_MAX):
                issues.append("alpha %.3f" % ar)
        # stills=True：素材本身只有一张定格（如"被拎起来"的拖拽姿势），不算伪动画
        if len(imgs) < 2 and state not in SINGLE_OK and not spec.get("stills"):
            issues.append("single frame")
        for i, (a, b) in enumerate(zip(imgs, imgs[1:])):
            last_pair = i == len(imgs) - 2
            if spec.get("hold_last") and last_pair:
                continue
            diff = frame_diff_ratio(a, b)
            pose = pose_diff_ratio(a, b)
            if diff < DIFF_MIN:
                issues.append("duplicate diff %.4f" % diff)
            elif pose < POSE_MIN and not spec.get("bob_only"):
                issues.append("moved-only pose %.4f" % pose)
            elif pose < POSE_WARN:
                warnings.append("%s pose %.4f (WARN)" % (state, pose))
        status = "PASS" if not issues else "FAIL"
        print("[G2] %-10s %2d frames -> %s" % (state, len(imgs), status))
        for issue in issues:
            print("   -", issue)
            ok = False
    for w in warnings:
        print("[G2][WARN]", w)
    return ok


def main():
    wanted = [a for a in sys.argv[1:] if not a.startswith("-")]
    packs = [p for p in sorted(PETS_DIR.iterdir())
             if (p / "frames" / "manifest.json").exists()]
    if wanted:
        packs = [p for p in packs if p.name in wanted]
    if not packs:
        print("[G2] 没有找到已构建的宠物包")
        return 1
    all_ok = True
    for pack in packs:
        print("==== %s ====" % pack.name)
        all_ok = check_pack(pack / "frames") and all_ok
    print("[G2]", "ALL PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
