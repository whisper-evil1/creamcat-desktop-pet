# -*- coding: utf-8 -*-
"""离线预览液态玻璃右键菜单（不开 Tk 窗口）。

用法：
    python tools/preview_menu.py            # 出 _raw/menu_preview.png
    python tools/preview_menu.py 3          # 第 3 项高亮

预览图把 KEY 绿背景换成深色桌面色，便于判断真实观感。
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pet_app as P                      # noqa: E402
from PIL import Image                    # noqa: E402


def build_app():
    app = object.__new__(P.PetApp)
    app._menu_cache = {}
    app._menu_base_cache = {}
    for name in ("_menu_font", "_menu_layout", "_menu_base", "_menu_compose"):
        setattr(app, name, types.MethodType(getattr(P.PetApp, name), app))
    app._alpha_to_key = P.PetApp._alpha_to_key
    app._glass_pill = types.MethodType(P.PetApp._glass_pill, app)
    return app


MAIN_ITEMS = [
    {"label": "聊聊天…"},
    {"label": "说句话"},
    {"label": "睡一会儿"},
    {"label": "陪我走走"},
    {"label": "今天心情如何", "children": [1]},
    {"kind": "sep"},
    {"label": "回到主界面（2D 小窝）"},
    {"label": "去星穹展厅"},
    {"label": "去 3D 小屋"},
    {"label": "宠物图鉴"},
    {"label": "换一只宠物", "children": [1]},
    {"kind": "sep"},
    {"label": "显示在其他应用上层", "kind": "check", "checked": True},
    {"kind": "sep"},
    {"label": "拜拜~", "danger": True},
]


def main():
    hot = int(sys.argv[1]) if len(sys.argv) > 1 else -1
    app = build_app()
    w, h, rows, pad_l = app._menu_layout(MAIN_ITEMS)
    menu = app._menu_compose(MAIN_ITEMS, hot, w, h, rows, pad_l)

    PAD = 40
    bg = Image.new("RGB", (w + PAD * 2, h + PAD * 2), (40, 52, 62))
    # 铺一层深色渐变，模拟壁纸，方便看玻璃透出的冷/暖折射
    for y in range(bg.height):
        k = y / max(1, bg.height - 1)
        bg.paste(tuple(int(c * (0.72 + 0.35 * k)) for c in (38, 48, 60)),
                 (0, y, bg.width, y + 1))
    mask = Image.new("L", menu.size, 0)
    md = mask.load()
    for y in range(menu.height):
        for x in range(menu.width):
            r, g, b = menu.getpixel((x, y))
            md[x, y] = 0 if (r, g, b) == P.KEY_RGB else 255
    bg.paste(menu, (PAD, PAD), mask)

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "_raw", "menu_preview.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bg.save(out)
    print("size=%dx%d hot=%d -> %s" % (w, h, hot, out))


if __name__ == "__main__":
    main()
