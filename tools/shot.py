# -*- coding: utf-8 -*-
"""临时截图：抓桌宠附近区域，方便肉眼验收。"""
import sys

from PIL import ImageGrab

x, y, w, h = (int(v) for v in sys.argv[1:5])
out = sys.argv[5] if len(sys.argv) > 5 else "debug/shot.png"
ImageGrab.grab(bbox=(x, y, x + w, y + h), all_screens=True).save(out)
print("saved", out)
