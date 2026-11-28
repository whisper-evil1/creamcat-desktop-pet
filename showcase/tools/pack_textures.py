"""打包展示厅用的宠物贴图（正面 + 转身四向），输出 data/pets.js。

用法：py -3 showcase/tools/pack_textures.py

正面取自 assets/pets/<id>/frames/idle/frame_00.png；
转身图取自 showcase/assets/turn/<id>/*.png（2x2：背面 / 右后 3/4 / 右侧 / 右前 3/4）。
四张视角统一按"正面内容高度"归一，保证转起来不会忽大忽小。
"""
import base64
import glob
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
import build_assets as B  # noqa: E402

OUT = os.path.join(ROOT, "showcase", "data", "pets.js")
TURN_DIR = os.path.join(ROOT, "showcase", "assets", "turn")

FRONT_SIZE = 512     # 正面
VIEW_SIZE = 384      # 转身四向
QUALITY = 90         # WebP 质量

META = {
    "xinghu": {
        "en": "STAR FOX", "element": "星辉",
        "tags": ["温柔", "守夜", "粘人"],
        "desc": "从星尘里醒来的小狐狸，尾巴上挂着没送出去的星光。它习惯在你回来后，"
                "把今天攒下的第一缕光轻轻放到你手心里。",
        "accent": "#f2c98a",
    },
    "naitang": {
        "en": "MARSHMALLOW CAT", "element": "月铃",
        "tags": ["慵懒", "撒娇", "怕冷"],
        "desc": "粉白的长毛小猫，颈间铃铛一响就是一句想你。她会把最软的那块绒毛"
                "留着给你当枕头，然后假装自己只是路过。",
        "accent": "#f7b5cd",
    },
    "tuantuan": {
        "en": "CLOUD SHEEP", "element": "云绵",
        "tags": ["安静", "软糯", "慢热"],
        "desc": "一朵会咩咩叫的云，头顶小花一直开着。它不催你，也不吵你，"
                "只是在你脚边慢慢滚过来，等你弯腰。",
        "accent": "#d9cdf7",
    },
    "buding": {
        "en": "CUSTARD POODLE", "element": "暖阳",
        "tags": ["热情", "护主", "话多"],
        "desc": "奶油卷毛的小泰迪，尾巴有自己的一套语言。肉干藏在枕头下面，"
                "但它觉得你看它一眼，比肉干更值钱。",
        "accent": "#f5d9a8",
    },
    "keke": {
        "en": "COCO HAMSTER", "element": "榛果",
        "tags": ["囤货", "慢生活", "小机灵"],
        "desc": "脸颊鼓鼓的圆仓鼠，头顶两片小叶子。它把最大的那颗坚果留给你，"
                "并且坚称自己的储备粮只是「刚好够吃」。",
        "accent": "#b9d99a",
    },
    "meimei": {
        "en": "BERRY BEAR", "element": "甜品",
        "tags": ["热情", "大方", "甜甜的"],
        "desc": "抱着草莓的小熊，如果你不开心，它就分你一半最甜的草莓。",
        "accent": "#ef9fb6",
    },
    "paopao": {
        "en": "BUBBLE OTTER", "element": "海洋",
        "tags": ["好奇", "聪明", "爱玩水"],
        "desc": "会把烦恼装进泡泡的小水獭，吹口气，坏心情就飞走啦。",
        "accent": "#9fd6bd",
    },
    "yaya": {
        "en": "SPROUT", "element": "森林",
        "tags": ["元气", "乐观", "爱分享"],
        "desc": "来自森林深处的小精灵，头上的叶子会随着心情轻轻摇晃。",
        "accent": "#9dbd77",
    },
    "yunxi": {
        "en": "CLOUD DRAGON", "element": "云朵",
        "tags": ["安静", "贴心", "会发光"],
        "desc": "来自云墟的小龙，翅膀小小的，却想为你挡住所有的坏心情。",
        "accent": "#9fc9e8",
    },
}


def encode(im, quality=QUALITY):
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=quality, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def content_h(im):
    bb = B.alpha_bbox(im)
    return 0 if bb is None else bb[3] - bb[1]


def fit(im, canvas, target_h, baseline=True):
    """等比缩放到内容高度 = target_h，底部对齐、水平按内容居中。"""
    bb = B.alpha_bbox(im)
    if bb is None:
        return Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    body = im.crop(bb)
    k = target_h / max(1, body.height)
    body = body.resize((max(1, int(body.width * k)), int(target_h)), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    bx = (canvas - body.width) // 2
    by = canvas - body.height if baseline else (canvas - body.height) // 2
    out.alpha_composite(body, (bx, by))
    return out


def turn_views(pid, front_h_ratio):
    """切转身图集，返回 [45°, 90°, 135°, 180°] 四张（未归一）。"""
    files = sorted(glob.glob(os.path.join(TURN_DIR, pid, "*.png")))
    if not files:
        return None
    cells = list(B.grid(files[0], 2, 2, inset=3))
    raw = [B.cutout(c, thresh=12, white_top=0.35) for c in cells]
    # 图集顺序：0=背面 1=右后3/4 2=右侧 3=右前3/4
    order = [3, 2, 1, 0]          # 转换成 45 / 90 / 135 / 180
    return [raw[i] for i in order]


def main():
    with open(os.path.join(ROOT, "pets.json"), encoding="utf-8") as f:
        reg = json.load(f)

    pets = []
    for i, entry in enumerate(reg["pets"]):
        pid = entry["id"]
        src = os.path.join(ROOT, "assets", "pets", pid, "frames", "idle", "frame_00.png")
        if not os.path.exists(src):
            print("SKIP %s" % pid)
            continue

        idle = Image.open(src).convert("RGBA")
        ratio = content_h(idle) / idle.height          # 正面内容占画布的比例
        front = fit(idle, FRONT_SIZE, FRONT_SIZE * ratio)

        views = [encode(front)]
        turns = turn_views(pid, ratio)
        if turns:
            target = VIEW_SIZE * ratio
            for v in turns:
                views.append(encode(fit(v, VIEW_SIZE, target)))
        else:
            views += [views[0]] * 4

        meta = META.get(pid, {})
        lines = entry.get("lines") or []
        pets.append({
            "id": pid,
            "name": entry.get("name", pid),
            "no": "%02d" % (i + 1),
            "en": meta.get("en", pid.upper()),
            "element": meta.get("element", "星尘"),
            "tags": meta.get("tags", []),
            "desc": meta.get("desc", ""),
            "quote": lines[0] if lines else "",
            "accent": meta.get("accent", "#e8cf9a"),
            "texture": views[0],
            "views": views,
        })
        print("PACK %-9s %-5s views=%d  %d KB" % (pid, entry.get("name"), len(views),
                                                  sum(len(v) for v in views) // 1024))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 showcase/tools/pack_textures.py 生成，不要手改\n")
        f.write("window.PET_DATA = ")
        json.dump(pets, f, ensure_ascii=False)
        f.write(";\n")
    print("-> %s  (%d KB)" % (OUT, os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
