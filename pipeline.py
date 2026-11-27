# -*- coding: utf-8 -*-
"""帧分析门禁的基础常量与函数（原为外部专家插件依赖，现内联到项目）。

供 gate_check.py 使用。仅依赖 Pillow（项目已有）。

阈值来源：对 assets/pets 下 9 个已构建宠物包的真实帧实测分布校准——
  - alpha 占比：真实帧 0.132–0.402，取 0.02–0.95 留出余量，抓空帧/满屏帧。
  - 帧差异：最小真实相邻差异 0.0441（meimei/parachute），取 0.01 抓完全重复帧。
  - 姿态差异：最小真实非 bob_only 差异 0.0210（xinghu/parachute），取 0.01 抓纯位移帧。

实现说明：
  - frame_diff_ratio 比较 RGBA 四通道，任一通道差异 > 16 即计为变化像素。
  - pose_diff_ratio 先按 alpha 包围盒中心对齐两帧（消除整体平移），再算 alpha
    掩码的 1-IoU。纯位移帧对齐后 IoU 接近 1，得分趋近 0；姿态真变了则得分升高。
"""
from PIL import Image, ImageChops

ALPHA_MIN = 0.02
ALPHA_MAX = 0.95
DIFF_MIN = 0.01
POSE_MIN = 0.01
POSE_WARN = 0.04

# 单通道差异超过此值才计为"变化"，容忍 AI 生成帧的轻微压缩噪声
_DIFF_PIXEL_THRESH = 16
_ALPHA_ON = 127


def load_rgba(path):
    """读图并统一转 RGBA，避免调色板/灰度帧在后续通道比较时报错。"""
    return Image.open(path).convert("RGBA")


def alpha_ratio(img):
    """非透明像素占整幅画布的比例。"""
    hist = img.getchannel("A").histogram()
    total = sum(hist)
    return sum(hist[_ALPHA_ON + 1:]) / total if total else 0.0


def _mask(img):
    return img.getchannel("A").point(lambda v: 255 if v > _ALPHA_ON else 0)


def frame_diff_ratio(a, b):
    """两帧 RGBA 的差异像素占比，用于识别完全重复的帧。"""
    if a.size != b.size:
        return 1.0
    diff = ImageChops.difference(a, b)
    bands = [ch.point(lambda v: 255 if v > _DIFF_PIXEL_THRESH else 0)
             for ch in diff.split()]
    changed = bands[0]
    for ch in bands[1:]:
        changed = ImageChops.lighter(changed, ch)
    return sum(changed.histogram()[1:]) / (a.width * a.height)


def _center(img):
    bb = _mask(img).getbbox()
    if bb is None:
        return None
    return ((bb[0] + bb[2]) / 2.0, (bb[1] + bb[3]) / 2.0)


def pose_diff_ratio(a, b):
    """对齐整体平移后的 alpha 掩码差异（1-IoU），用于识别"只挪位置没变姿态"。"""
    if a.size != b.size:
        return 1.0
    ca, cb = _center(a), _center(b)
    if ca is None or cb is None:
        return 0.0 if ca == cb else 1.0
    # 把 b 的中心移到 a 的中心：位移量是 ca - cb，方向不能反
    dx, dy = int(round(ca[0] - cb[0])), int(round(ca[1] - cb[1]))
    shifted = Image.new("L", a.size, 0)
    shifted.paste(_mask(b), (dx, dy))
    ma = _mask(a)
    inter = ImageChops.multiply(ma, shifted)
    union = ImageChops.lighter(ma, shifted)
    n_inter = sum(inter.histogram()[1:])
    n_union = sum(union.histogram()[1:])
    return 1.0 - n_inter / n_union if n_union else 0.0
