# -*- coding: utf-8 -*-
"""在真实桌面上验证液态玻璃右键菜单（右键 -> 截图 -> 悬停/点击某一项）。

用法（需要桌宠已在运行）：
    python tools/menu_shot.py                # 打开菜单并截图
    python tools/menu_shot.py hover 10       # 悬停第 10 项（级联子菜单）后截图
    python tools/menu_shot.py click 1        # 点击第 1 项后截图

菜单矩形由枚举顶层窗口自动定位，不依赖鼠标位置推算。
"""
import ctypes
import os
import re
import sys
import time
from ctypes import wintypes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# DPI 感知必须在任何坐标/截图调用之前：否则 SetCursorPos 会被系统按缩放换算，
# 鼠标实际落到屏幕外，右键根本点不到宠物。
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass
user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
                               wintypes.DWORD, ctypes.c_size_t]
from PIL import ImageGrab                    # noqa: E402  (需在 DPI 感知之后导入)

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
MENU_HINT = (215, 459)                       # 主菜单的近似尺寸，用于识别窗口


def right_click(x, y):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.35)
    user32.mouse_event(0x0008, 0, 0, 0, 0)   # RIGHTDOWN
    time.sleep(0.14)                          # 按久一点，保证 30ms 轮询能采到边沿
    user32.mouse_event(0x0010, 0, 0, 0, 0)   # RIGHTUP


def left_click(x, y):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.3)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.05)
    user32.mouse_event(0x0004, 0, 0, 0, 0)


def read_pet_xy():
    with open(os.path.join(ROOT, "runtime.txt"), encoding="utf-8") as f:
        txt = f.read()
    m = re.search(r"RUNNING\s+(-?\d+)\s+(-?\d+)", txt)
    return int(m.group(1)), int(m.group(2))


def find_windows(min_w=120, min_h=120):
    """所有可见顶层窗口矩形（左, 上, 宽, 高）。"""
    out = []

    def cb(hwnd, _):
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            r = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(r))
            w, h = r.right - r.left, r.bottom - r.top
            if w >= min_w and h >= min_h:
                out.append((r.left, r.top, w, h))
        except Exception:
            pass
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def find_menu():
    """刚弹出的菜单窗口：宽 215 左右、高 300~520。"""
    best = None
    for (x, y, w, h) in find_windows():
        if abs(w - MENU_HINT[0]) <= 3 and 300 <= h <= 520:
            best = (x, y, w, h)
    return best


def shot(name):
    path = os.path.join(ROOT, "_raw", name)
    ImageGrab.grab().save(path)
    return path


def main():
    x, y = read_pet_xy()
    cx, cy = x + 131, y + 166              # 角色身体中部
    right_click(cx, cy)
    time.sleep(0.9)
    rect = find_menu()
    print("pet=(%d,%d) click=(%d,%d) menu=%s" % (x, y, cx, cy, rect))
    print("shot:", shot("menu_live.png"))
    if not rect:
        return
    mx, my, mw, mh = rect

    if len(sys.argv) < 3:
        return
    mode, idx = sys.argv[1], int(sys.argv[2])
    tx = mx + 100
    ty = my + 9 + 34 * idx + 17
    if mode == "hover":
        user32.SetCursorPos(tx, ty)
        time.sleep(0.8)
        print("hover item %d at (%d,%d)" % (idx, tx, ty))
        print("shot:", shot("menu_hover.png"))
    elif mode == "click":
        left_click(tx, ty)
        time.sleep(1.2)
        print("click item %d at (%d,%d)" % (idx, tx, ty))
        print("shot:", shot("menu_after_click.png"))


if __name__ == "__main__":
    main()
