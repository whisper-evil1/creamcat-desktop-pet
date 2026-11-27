"""从 AI 出的整伞原图里提取干净伞面（去掉绳子），供 compose_parachute 复用。

用法：
    py -3 tools/make_chute_rig.py <整伞原图.png>

产物：assets/shared/canopy.png（仅伞面，含伞沿小绳结，无吊绳）
思路：先按白底抠图，再用形态学开运算吃掉细吊绳（线宽 ~10px），
保留伞面主体；最后按 alpha 收紧裁剪。
"""
import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import build_assets as B  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    img = Image.open(src).convert("RGB")
    cut = B.cutout(img, thresh=18, white_top=1.0)

    alpha = cut.getchannel("A")
    # 开运算：先腐蚀后膨胀，去掉细绳，保留伞面
    opened = alpha.filter(ImageFilter.MinFilter(15)).filter(ImageFilter.MaxFilter(15))
    # 只保留既在 opened 里又有原 alpha 的像素（绳子被 opened 排除）
    keep = Image.eval(opened, lambda v: 255 if v > 90 else 0)
    keep = Image.composite(alpha, Image.new("L", cut.size, 0), keep)

    out = cut.copy()
    out.putalpha(keep)

    # 伞面下缘以下（残余绳结/吊绳碎块）一律清掉，只留伞体
    w, h = out.size
    rows = []
    for y in range(h):
        rows.append(sum(1 for x in range(w) if keep.getpixel((x, y)) > 120))
    peak = max(rows)
    last = max(y for y in range(h) if rows[y] >= peak * 0.35)
    keep.paste(0, (0, last + 1, w, h))
    out.putalpha(keep)

    bb = B.alpha_bbox(out)
    if bb is None:
        raise SystemExit("伞面抠空了")
    out = out.crop(bb)

    dst = os.path.join(ROOT, "assets", "shared", "canopy.png")
    out.save(dst)
    print("canopy %dx%d -> %s" % (out.width, out.height, dst))
    return 0


if __name__ == "__main__":
    sys.exit(main())
