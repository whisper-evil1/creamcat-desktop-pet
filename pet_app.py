# -*- coding: utf-8 -*-
"""星宠语 · 星狐桌宠运行时（tkinter + Pillow，Windows）。

交互规则：
  - 清醒态单击完全无反应（避免打字误触）；休眠态单击 -> 唤醒。
  - 在宠物身上长按 0.35s -> 拖拽跟随（无需双击）。
  - 双击桌面空白处 -> 走/飞过去（单击空白不触发，防误触）。
  - 休眠态下双击无效（不会走/飞、不会拖拽）。
  - 目标在上方 -> 展翅飞（身体固定只扇翅）；同水平线 -> 侧面正常跑步。
  - 拖拽向上后松手 -> 撑 3D 降落伞，先膨胀张开再缓缓飘回底部。
  - 长时间无操作 -> 睡觉（单帧定格，醒/睡都各自只有一个形态）。
  - 右键菜单可切换"显示在其他应用上层"。
"""
import ctypes
import json
import os
import random
import sys
import time
import tkinter as tk
from ctypes import wintypes
from PIL import Image, ImageDraw, ImageFont, ImageTk
import voice
import pet_chat

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.abspath(__file__))
PETS_DIR = os.path.join(ROOT, "assets", "pets")
REGISTRY = os.path.join(ROOT, "pets.json")
CONFIG_PATH = os.path.join(ROOT, "config.json")
KEY = "#00ff01"

# ---------- 可调参数 ----------
DISPLAY_SCALE = 0.85       # 桌面上宠物的整体缩放（1.0 = 360 画布原尺寸）
DOUBLE_GAP = 0.38          # 双击最大间隔（秒）
DOUBLE_DIST = 44           # 双击最大位移（像素）
LONG_PRESS_SEC = 0.35      # 长按多久触发拖拽（秒）
IDLE_SLEEP_SEC = 60        # 闲置多少秒进入睡觉
FLY_HEIGHT = 70            # 目标高于当前多少像素判定为"往高处走"
PARACHUTE_SPEED = 2.2      # 降落伞飘落速度（像素/tick）
WALK_SPEED = 7.0           # 走路速度
FLY_SPEED = 10.0           # 飞行速度
GROUND_MARGIN = 40         # 落地时距屏幕底部的留白
EDGE_PEEK = 0.5            # 探头：允许角色身体最多有多少比例探出屏幕外
SNAP_DIST = 34             # 松手后吸附到窗口边框的最大距离（像素）
SNAP_LIVE = 22             # 拖拽途中实时"磁吸"的距离（像素）
BUBBLE_FONT = "C:/Windows/Fonts/msyh.ttc"
BUBBLE_MAX_W = 250
PUFF_MAX = 4               # 休眠时同时存在的泡泡数量上限
PUFF_SPAWN = 0.45          # 每隔多少秒冒出一个新泡泡
PUFF_LIFE = 2.0            # 单个泡泡寿命（秒）
PUFF_BOX = 68              # 泡泡窗口固定边长，避免每帧 resize 闪黑框

# ---------- DPI 感知：必须在创建 Tk() 之前 ----------
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# ---------- Windows API ----------
user32 = ctypes.WinDLL("user32", use_last_error=True)
GWL_EXSTYLE = -20
WS_EX_NOACTIVATE = 0x08000000
VK_LBUTTON, VK_RBUTTON = 0x01, 0x02


class _POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short
user32.GetCursorPos.argtypes = [ctypes.POINTER(_POINT)]

# 枚举可见顶层窗口（用于吸附到"任何一个框"的边框上）
WS_EX_TOOLWINDOW = 0x00000080
WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = wintypes.LONG


def screen_size():
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def window_frames(skip=()):
    """枚举屏幕上的可见窗口矩形，当作"框"来吸附（标题栏、任务栏、侧边栏都算）。"""
    rects = []
    sw, sh = screen_size()

    def cb(hwnd, _):
        try:
            if not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
                return True
            if user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW:
                return True
            r = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(r))
            w, h = r.right - r.left, r.bottom - r.top
            if w < 140 or h < 90:
                return True
            if w >= sw - 2 and h >= sh - 2:      # 桌面/全屏窗口没有可站的边框
                return True
            rect = (r.left, r.top, r.right, r.bottom)
            for s in skip:                        # 跳过我们自己的窗口
                if all(abs(a - b) <= 2 for a, b in zip(rect, s)):
                    return True
            rects.append(rect)
        except Exception:
            pass
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return rects


def load_config():
    default = {"topmost": True, "pet": None}
    if os.path.exists(CONFIG_PATH):
        try:
            default.update(json.load(open(CONFIG_PATH, encoding="utf-8")))
        except Exception:
            pass
    return default


def load_registry():
    try:
        with open(REGISTRY, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"default": None, "pets": []}


def pet_frames(pid):
    return os.path.join(PETS_DIR, pid, "frames")


def pet_meta(pid):
    for p in load_registry()["pets"]:
        if p["id"] == pid:
            return p
    return None


def built_pets():
    """已经构建过帧的宠物（有 manifest 才算可用）。"""
    out = []
    for p in load_registry()["pets"]:
        if os.path.exists(os.path.join(pet_frames(p["id"]), "manifest.json")):
            out.append(p)
    return out


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


KEY_RGB = (0, 255, 1)


def _flatten(img):
    """透明区填纯键色、alpha 拉满：交给 -transparentcolor 抠掉，不留彩边。"""
    flat = Image.new("RGBA", img.size, KEY_RGB + (255,))
    sp, dp = img.load(), flat.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if sp[x, y][3] > 127:
                dp[x, y] = sp[x, y][:3] + (255,)
    return flat


class PetApp:
    def __init__(self):
        self.cfg = load_config()
        self.pet_id, self.pet_meta = self._resolve_pet()
        self.frames = pet_frames(self.pet_id)
        self.pet_name = (self.pet_meta or {}).get("name", self.pet_id)
        self.manifest = json.load(open(os.path.join(self.frames, "manifest.json"),
                                     encoding="utf-8"))
        self.lines = self._load_lines()
        self.imgs = {}
        self.photo_cache = {}
        self._body_box_cache = None      # 角色内容框（懒计算）
        # 窗口与画布同步缩放：所有坐标/命中判定都在缩放后的尺寸里算
        cw = int(self.manifest.get("canvas", [360, 360])[0])
        self.W = max(120, int(round(cw * DISPLAY_SCALE)))

        self.state = "idle"
        self.frame = 0
        self.last_tick = time.time()
        self.walk_target = None          # (x, y) 屏幕目标点
        self.facing_right = True
        self.dragging = False
        self.drag_off = (0, 0)
        self.drag_start_y = None         # 抓起时的高度，用于判断是否需要降落伞
        self.parachute_target = None     # 双击下方目标时的降落点；None= drag 抛落后回地面
        self._para_deploy_until = 0.0    # 降落伞张开动画播放期间暂不下降

        # 长按检测（拖拽）
        self._pressing = False           # 左键是否正按住
        self._press_t = 0.0              # 本次按下时刻
        self._press_pos = (0, 0)         # 本次按下位置
        self._press_on_body = False      # 按下时是否落在宠物身上
        self._long_press_fired = False   # 本次按下是否已触发长按拖拽

        # 双击检测（仅用于桌面空白处走动）
        self._prev_lbtn = False
        self._prev_rbtn = False
        self._poll_primed = False
        self._last_down_t = 0.0
        self._last_down_pos = (0, 0)
        self._last_mouse = (0, 0)
        self._click_chain = 0            # 连续点击计数

        self.last_interact = time.time() # 上次交互时间（闲置睡觉用）
        self.pet_x, self.pet_y = 200, 400
        self.bubble_job = None
        self.menu = None
        self._topmost_var = None
        self.user_name = (self.cfg.get("user_name") or "").strip()
        self._chat_win = None
        self._voice = None              # root 建好后实例化

        self.root = tk.Tk()
        self._voice = voice.VoiceEngine(self.root)
        self._build_photos()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", bool(self.cfg["topmost"]))
        self.root.attributes("-transparentcolor", KEY)
        self.root.configure(bg=KEY)
        sw, sh = screen_size()
        self.pet_x, self.pet_y = sw - 460, sh - 420
        self.root.geometry("%dx%d+%d+%d" % (self.W, self.W, self.pet_x, self.pet_y))
        self.label = tk.Label(self.root, bg=KEY, bd=0, highlightthickness=0)
        self.label.pack()

        # 气泡窗口
        self.bub = tk.Toplevel(self.root)
        self.bub.overrideredirect(True)
        self.bub.attributes("-topmost", True)
        self.bub.attributes("-transparentcolor", KEY)
        self.bub.configure(bg=KEY)
        self.bub_label = tk.Label(self.bub, bg=KEY, bd=0, highlightthickness=0)
        self.bub_label.pack()
        self.bub.withdraw()
        self._bubble_cache = {}
        self._bub_size = None
        # 休眠泡泡池：多个泡泡同时冒出、一边长大一边上飘
        self._puff_wins = []
        self._puffs = []
        self._puff_job = None
        self._puff_spawn_at = 0.0
        self._puff_last = 0.0

        if os.environ.get("XINGHU_DEMO") == "1":
            # 调试用：启动后自动说一句话，便于验证气泡渲染
            self.root.after(1500, lambda: self._say("我把今天的第一缕星光留给你啦～"))
        elif os.environ.get("XINGHU_DEMO") == "2":
            # 调试用：直接进入睡眠，便于验证泡泡生长动画
            self.root.after(800, lambda: self._set_state("sleep"))
        elif os.environ.get("XINGHU_DEMO") == "3":
            # 调试用：直接展翅，便于验证扇翅循环
            self.root.after(600, lambda: self._set_state("fly"))
        elif os.environ.get("XINGHU_DEMO") == "4":
            # 调试用：直接进降落伞，便于验证伞的展开
            self.root.after(600, lambda: self._set_state("parachute"))
        elif os.environ.get("XINGHU_DEMO") == "5":
            # 调试用：先挪到高处再开伞，验证"张开 -> 飘落 -> 落地说话"全流程
            self.root.after(600, self._demo_high_chute)
        elif os.environ.get("XINGHU_DEMO") == "6":
            # 调试用：自己往左跑一段，验证跑步动画在桌面上的观感
            self.root.after(800, self._demo_walk)
        if os.environ.get("XINGHU_SNAP_TEST"):
            # 调试用：对真实窗口跑一次吸附并把结果写盘
            self.root.after(700, self._snap_selftest)

        self._write_runtime()
        self._tick()
        self.root.mainloop()

    def _resolve_pet(self):
        """决定这次跑哪只：命令行 --pet > config.json > pets.json 默认值 > 第一个可用。"""
        avail = built_pets()
        ids = [p["id"] for p in avail]
        want = None
        for i, a in enumerate(sys.argv):
            if a == "--pet" and i + 1 < len(sys.argv):
                want = sys.argv[i + 1]
            elif a.startswith("--pet="):
                want = a.split("=", 1)[1]
        want = want or self.cfg.get("pet") or load_registry().get("default")
        if want in ids:
            return want, pet_meta(want)
        if ids:
            return ids[0], pet_meta(ids[0])
        raise SystemExit("assets/pets 下没有任何可用的宠物包，请先运行 build_assets.py")

    def _build_photos(self):
        """把真值 alpha 帧按 DISPLAY_SCALE 缩放后再展平——顺序不能反。

        先缩放再展平，彩色边缘才会落在 alpha 之外被键色吃掉；反过来（先展平后缩放）
        键色会和毛边混在一起，边缘出现一圈脏色。
        """
        need = abs(DISPLAY_SCALE - 1.0) > 1e-3
        for state in self.manifest["actions"]:
            d = os.path.join(self.frames, state)
            names = sorted(p for p in os.listdir(d) if p.endswith(".png"))
            truth = [Image.open(os.path.join(d, n)).convert("RGBA") for n in names]
            if need:
                truth = [i.resize((self.W, self.W), Image.LANCZOS) for i in truth]
            self.imgs[state] = truth
            self.photo_cache[state] = [ImageTk.PhotoImage(_flatten(i)) for i in truth]

    def _load_lines(self):
        lines = (self.pet_meta or {}).get("lines") or []
        if lines:
            return lines
        p = os.path.join(ROOT, "lines.json")
        if os.path.exists(p):
            try:
                return json.load(open(p, encoding="utf-8"))
            except Exception:
                pass
        return ["我把今天的第一缕星光留给你啦～", "摸摸头？", "我一直都在你身边哦。"]

    # ---------- 命中与交互 ----------
    def _hit_body(self, x, y):
        """点击是否真的落在宠物身上：按当前帧 alpha 轮廓判定，透明区不响应。

        允许 ±2px 容差，毛边和细尾巴尖也能点中，避免"明明点在身上却没反应"。
        """
        ix, iy = int(x - self.pet_x), int(y - self.pet_y)
        if not (-2 <= ix < self.W + 2 and -2 <= iy < self.W + 2):
            return False
        frames = self.imgs.get(self.state)
        if not frames:
            return False
        idx = min(self.frame, len(frames) - 1)
        try:
            alpha = frames[idx].getchannel("A")
            for dy in (-2, 0, 2):
                for dx in (-2, 0, 2):
                    px, py = ix + dx, iy + dy
                    if 0 <= px < self.W and 0 <= py < self.W and alpha.getpixel((px, py)) > 60:
                        return True
        except Exception:
            pass
        return False

    def _note_interact(self):
        self.last_interact = time.time()

    def _start_drag(self, x, y):
        """长按宠物触发：进入拖拽跟随。休眠态长按也先唤醒。"""
        self._note_interact()
        self.dragging = True
        self.drag_off = (x - self.pet_x, y - self.pet_y)
        self.drag_start_y = self.pet_y
        self._set_state("drag")

    def _on_double_down(self, x, y):
        """双击桌面空白处 -> 走/飞过去。休眠态双击无效。"""
        if self.state == "sleep" or self._hit_body(x, y):
            return
        self._note_interact()
        self.walk_target = (x, y)
        self._plan_walk()

    def _on_up(self, x, y):
        """松开左键：结束长按/拖拽；休眠态短按=唤醒；清醒态单击无反应。"""
        was_drag = self.dragging
        pressed = self._pressing
        on_body = self._press_on_body
        held = time.time() - self._press_t if pressed else 0

        self._pressing = False
        self._long_press_fired = False

        if was_drag:
            self.dragging = False
            lift = (self.drag_start_y is not None and
                    self.pet_y < self.drag_start_y - FLY_HEIGHT)
            self._note_interact()
            if lift:
                self.walk_target = None
                self.parachute_target = None
                self._para_deploy_until = time.time() + 0.7   # 张开动画播完再下降
                self._set_state("parachute")   # 先播膨胀张开，再飘落
            else:
                self._snap_to_edge()
                self._set_state("drop")
        elif pressed and on_body and held < LONG_PRESS_SEC:
            # 短按宠物：仅在休眠态唤醒，清醒态完全无反应（防打字误触）
            if self.state == "sleep":
                self._note_interact()
                self._set_state("idle")

    def _own_rects(self):
        """自己两个窗口的矩形，枚举其他窗口时排除掉。"""
        rects = []
        for w in (getattr(self, "root", None), getattr(self, "bub", None)):
            if w is None:
                continue
            try:
                x, y = w.winfo_x(), w.winfo_y()
                rects.append((x, y, x + w.winfo_width(), y + w.winfo_height()))
            except Exception:
                pass
        return rects

    def _body_box(self):
        """角色在窗口里的真实内容框（不是窗口框）。

        idle 帧内容只占中间一竖条，之前的"探头"按整个窗口算，
        实际只露出一条窄缝，看起来像被切开的狐狸。所有对齐/边界改成按这个框算。
        """
        if self._body_box_cache:
            return self._body_box_cache
        W = self.W
        box = (W * 60 // 360, W * 110 // 360, W * 300 // 360, W)
        frames = self.imgs.get("idle") or []
        if frames:
            b = frames[0].getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
            if b:
                box = b
        self._body_box_cache = box
        return box

    def _bounds(self):
        """pet_x / pet_y 允许范围：保证角色身体至少 (1-EDGE_PEEK) 还在屏幕内。"""
        sw, sh = screen_size()
        bx0, by0, bx1, by1 = self._body_box()
        bw, bh = bx1 - bx0, by1 - by0
        min_x = -(bx0 + bw * EDGE_PEEK)
        max_x = sw - (bx0 + bw * (1 - EDGE_PEEK))
        min_y = -(by0 + bh * EDGE_PEEK)
        max_y = sh - (by0 + bh * (1 - EDGE_PEEK))
        return min_x, max_x, min_y, max_y

    def _clamp(self, x, y):
        min_x, max_x, min_y, max_y = self._bounds()
        return max(min_x, min(max_x, x)), max(min_y, min(max_y, y))

    def _snap(self, x, y, dist=None):
        """把位置吸附到最近的"框"：其它窗口的上/下/左/右边框 + 屏幕边缘。

        - 竖直：脚底线贴到窗口上沿/下沿（站在标题栏、任务栏上）
        - 水平：身体左/右边缘或中线贴到窗口左右边框
        - 屏幕左右边：以身体中线对齐，形成"探头"（半个身子探出去）
        拖拽途中用 SNAP_LIVE 实时磁吸，松手用 SNAP_DIST。
        """
        dist = SNAP_DIST if dist is None else dist
        sw, sh = screen_size()
        bx0, by0, bx1, by1 = self._body_box()
        foot = y + by1
        body_l, body_r = x + bx0, x + bx1
        body_cx = x + (bx0 + bx1) / 2.0
        best_x = best_y = None

        ytargets, xtargets = [sh], []
        for (l, t, r, b) in window_frames(skip=self._own_rects()):
            if t > 8:                     # 顶边 y<=0 无处置身（最大化窗口/桌面）
                ytargets.append(t)
            ytargets.append(b)
            xtargets += [l, r]

        for target in ytargets:
            d = abs(foot - target)
            if d <= dist and (best_y is None or d < best_y[0]):
                best_y = (d, target - by1)
        for target in xtargets:
            for probe, off in ((body_l, bx0), (body_r, bx1),
                               (body_cx, (bx0 + bx1) / 2.0)):
                d = abs(probe - target)
                if d <= dist and (best_x is None or d < best_x[0]):
                    best_x = (d, target - off)
        for target in (0, sw):            # 屏幕左右：按身体中线吸附 -> 探头
            d = abs(body_cx - target)
            if d <= dist and (best_x is None or d < best_x[0]):
                best_x = (d, target - (bx0 + bx1) / 2.0)
        if best_x:
            x = best_x[1]
        if best_y:
            y = best_y[1]
        return self._clamp(x, y)

    def _snap_to_edge(self):
        """松手/到点后：贴合最近的边框，并按角色身体限制探出比例。"""
        nx, ny = self._snap(self.pet_x, self.pet_y, SNAP_DIST)
        self._move_to(int(nx), int(ny))

    def _open_page(self, relpath, say_fail="页面还没装好呀～"):
        """打开 ROOT 下的页面：直接点名 Chrome / Edge，绕开 .html 的系统关联。"""
        page = os.path.join(ROOT, *relpath.split("/"))
        if not os.path.exists(page):
            self._say(say_fail)
            return
        try:
            import open_page as _op
            ok, how = _op.open_page(relpath)
            if not ok:
                raise RuntimeError(how)
        except Exception:
            # 兜底：系统默认程序
            try:
                if hasattr(os, "startfile"):
                    os.startfile(page)
                else:
                    import webbrowser
                    webbrowser.open("file://" + page.replace(os.sep, "/"))
            except Exception:
                self._say("浏览器没开成功，双击 open_page.py 试试～")

    def _open_home(self):
        """打开星宠语主界面（2D 小窝）。"""
        self._open_page("house2d/index.html", say_fail="主界面还没装好呀～")

    def _open_dex(self):
        """打开宠物图鉴页（场景卡 + 穿搭 / 喂食 / 状态面板）。"""
        self._open_page("showcase/home.html", say_fail="图鉴页还没装好呀～")

    def _open_showcase(self):
        """打开星空展示厅。"""
        self._open_page("showcase/index.html", say_fail="展示厅还没装好呀～")

    def _open_room3d(self):
        """打开 3D 小屋（可走动的那间）。"""
        self._open_page("room3d/index.html", say_fail="3D 小屋还没装好呀～")

    def _open_room2d(self):
        """打开 2D 小窝（点家具看场景）。"""
        self._open_page("house2d/index.html", say_fail="2D 小窝还没装好呀～")

    def _on_right(self, x, y):
        if not self._hit_body(x, y):
            return
        self._note_interact()
        if self.menu is None:
            self.menu = tk.Menu(self.root, tearoff=0, font=("Microsoft YaHei", 10))
            self.menu.add_command(label="聊聊天…", command=self._open_chat)
            self.menu.add_command(label="说句话", command=lambda: self._say_voice(random.choice(self.lines)))
            self.menu.add_command(label="睡一会儿", command=lambda: self._set_state("sleep"))
            self.menu.add_command(label="陪我走走", command=self._random_walk)
            self.menu.add_separator()
            self.menu.add_command(label="回到主界面（2D 小窝）", command=self._open_home)
            self.menu.add_command(label="去星穹展厅", command=self._open_showcase)
            self.menu.add_command(label="去 3D 小屋", command=self._open_room3d)
            self.menu.add_command(label="宠物图鉴", command=self._open_dex)
            pets = built_pets()
            if len(pets) > 1:
                sub = tk.Menu(self.menu, tearoff=0, font=("Microsoft YaHei", 10))
                self._pet_var = tk.StringVar(value=self.pet_id)
                for p in pets:
                    sub.add_radiobutton(
                        label=p.get("name", p["id"]), value=p["id"],
                        variable=self._pet_var,
                        command=lambda pid=p["id"]: self._switch_pet(pid))
                self.menu.add_cascade(label="换一只宠物", menu=sub)
            self.menu.add_separator()
            self._topmost_var = tk.BooleanVar(value=bool(self.cfg["topmost"]))
            self.menu.add_checkbutton(
                label="显示在其他应用上层", variable=self._topmost_var,
                command=self._toggle_topmost)
            self.menu.add_separator()
            self.menu.add_command(label="拜拜~", command=self.destroy)
        else:
            self._topmost_var.set(bool(self.cfg["topmost"]))
        try:
            self.menu.tk_popup(x, y)
        finally:
            self.menu.grab_release()

    def _switch_pet(self, pid):
        """换宠物：记住选择后重启自己（换整套帧、台词、体型，比重建窗口干净）。"""
        if pid == self.pet_id:
            return
        self.cfg["pet"] = pid
        save_config(self.cfg)
        try:
            self.root.destroy()
        except Exception:
            pass
        os.execv(sys.executable,
                 [sys.executable, os.path.abspath(__file__), "--pet", pid])

    def _toggle_topmost(self):
        val = bool(self._topmost_var.get())
        self.cfg["topmost"] = val
        save_config(self.cfg)
        self.root.attributes("-topmost", val)
        self.bub.attributes("-topmost", True)  # 气泡始终可见，不受主控开关影响

    def _random_walk(self):
        self._note_interact()
        sw, sh = screen_size()
        self.walk_target = (random.randint(80, sw - 80), random.randint(200, sh - 120))
        self._plan_walk()

    # ---------- 状态与渲染 ----------
    def _set_state(self, state):
        if state not in self.imgs:
            state = "idle"
        if self.state != state:
            self.state = state
            self.frame = 0
            if state == "sleep":
                self.bub.withdraw()
                self._start_puffs()
            else:
                self._stop_puffs()
        self._render()

    def _render(self):
        frames = self.photo_cache[self.state]
        idx = min(self.frame, len(frames) - 1)
        self.label.configure(image=frames[idx])

    def _bubble_photo(self, text, small=False):
        """用 PIL 画圆角气泡（带小尾巴），比直角 Label 更饱满、不像文字框。"""
        key = (str(text), small)
        if key in self._bubble_cache:
            return self._bubble_cache[key]
        size = 17 if small else 20
        try:
            font = ImageFont.truetype(BUBBLE_FONT, size)
        except Exception:
            font = ImageFont.load_default()
        maxw = 90 if small else BUBBLE_MAX_W
        lines, cur = [], ""
        for ch in str(text):
            if ch == "\n":
                lines.append(cur)
                cur = ""
            elif font.getlength(cur + ch) <= maxw:
                cur += ch
            else:
                lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
        if not lines:
            lines = [""]
        lh = size + 9
        pad = 12 if small else 18
        tw = max(font.getlength(l) for l in lines)
        w = int(tw + pad * 2)
        h = int(lh * len(lines) + pad * 2 + 12)
        img = Image.new("RGB", (w, h), KEY)
        d = ImageDraw.Draw(img)
        r = 12 if small else 19
        body_h = h - 12
        d.rounded_rectangle([0, 0, w - 1, body_h - 1], radius=r,
                            fill=(255, 250, 243), outline=(230, 192, 160), width=2)
        d.rounded_rectangle([3, 3, w - 4, body_h - 4], radius=max(4, r - 4),
                            outline=(255, 245, 234), width=2)
        cx = w // 2
        d.polygon([(cx - 9, body_h - 2), (cx + 9, body_h - 2), (cx, h - 1)],
                  fill=(255, 250, 243))
        d.line([(cx - 9, body_h - 2), (cx, h - 1)], fill=(230, 192, 160), width=2)
        d.line([(cx + 9, body_h - 2), (cx, h - 1)], fill=(230, 192, 160), width=2)
        y = pad
        for l in lines:
            d.text(((w - font.getlength(l)) / 2, y), l, font=font, fill=(98, 72, 58))
            y += lh
        photo = ImageTk.PhotoImage(img)
        self._bubble_cache[key] = (photo, w, h)
        return self._bubble_cache[key]

    def _show_bubble(self, text, small=False, dy=0, hold=2600):
        photo, w, h = self._bubble_photo(text, small)
        self._bub_size = (w, h)
        self.bub_label.configure(image=photo)
        self.bub_label.image = photo
        sw, sh = screen_size()
        bx = max(0, min(sw - w, self.pet_x + self.W // 2 - w // 2))
        by = max(0, min(sh - h, self.pet_y + self.W * 118 // 360 - h + dy))
        self.bub.geometry("%dx%d+%d+%d" % (w, h, bx, by))
        self.bub.deiconify()
        self.bub.lift()
        if self.bubble_job:
            self.root.after_cancel(self.bubble_job)
            self.bubble_job = None
        if hold:
            self.bubble_job = self.root.after(hold, self.bub.withdraw)

    def _say(self, text):
        self._note_interact()
        self._show_bubble(text)

    def _say_voice(self, text):
        """气泡 + 语音朗读；语音失败时气泡照常显示。"""
        self._say(text)
        if self._voice:
            self._voice.speak(text)

    # ---------- 聊聊天：输入框 + 规则回复 + 语音 ----------
    def _open_chat(self):
        if self._chat_win is not None and self._chat_win.winfo_exists():
            self._chat_win.lift()
            self._chat_entry.focus_set()
            return
        win = tk.Toplevel(self.root)
        self._chat_win = win
        win.title("和" + self.pet_name + "聊聊天")
        win.attributes("-topmost", True)
        win.resizable(False, False)
        win.configure(bg="#FFF7EC")
        win.protocol("WM_DELETE_WINDOW", self._close_chat)

        head = tk.Label(win, text="和 " + self.pet_name + " 说点什么…",
                        bg="#FFF7EC", fg="#5A4632", font=("Microsoft YaHei", 11, "bold"))
        head.pack(padx=14, pady=(12, 4), anchor="w")
        tip = tk.Label(win, text="说「我叫小满」它会记住；回车发送",
                       bg="#FFF7EC", fg="#A08B72", font=("Microsoft YaHei", 9))
        tip.pack(padx=14, pady=(0, 8), anchor="w")

        row = tk.Frame(win, bg="#FFF7EC")
        row.pack(padx=14, pady=(0, 10), fill="x")
        entry = tk.Entry(row, font=("Microsoft YaHei", 11), width=30,
                         bg="white", relief="flat", highlightthickness=1,
                         highlightbackground="#E8D9C5")
        entry.pack(side="left", fill="x", expand=True, ipady=4)
        entry.bind("<Return>", lambda e: self._send_chat())
        btn = tk.Button(row, text="说", command=self._send_chat,
                        font=("Microsoft YaHei", 10), bg="#F3B7A0", fg="white",
                        relief="flat", padx=12, activebackground="#E8A489")
        btn.pack(side="left", padx=(6, 0), ipady=3)
        self._chat_entry = entry

        # 定位在宠物附近，不遮挡整块屏幕
        win.update_idletasks()
        w, h = win.winfo_width(), win.winfo_height()
        x = max(0, min(screen_size()[0] - w, self.pet_x - 40))
        y = max(0, min(screen_size()[1] - h, self.pet_y + self.W + 10))
        win.geometry("+%d+%d" % (x, y))
        entry.focus_set()

    def _close_chat(self):
        if self._chat_win is not None:
            try:
                self._chat_win.destroy()
            except Exception:
                pass
        self._chat_win = None

    def _send_chat(self):
        if self._chat_entry is None:
            return
        text = self._chat_entry.get().strip()
        if not text:
            return
        self._chat_entry.delete(0, "end")
        answer, new_name = pet_chat.reply(text, self.pet_name, self.user_name)
        if new_name:
            self.user_name = new_name
            self.cfg["user_name"] = new_name
            save_config(self.cfg)
        self._say_voice(answer)

    # ---------- 休眠泡泡：多个同时冒 ----------
    def _make_puff_window(self):
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.attributes("-transparentcolor", KEY)
        win.configure(bg=KEY)
        lab = tk.Label(win, bg=KEY, bd=0, highlightthickness=0)
        lab.pack()
        return (win, lab)

    def _puff_photo(self, size):
        """在固定尺寸透明画布中央画一朵云（size 控制大小）。

        窗口尺寸固定，只换图片 -> 不会因为每帧 resize 造成黑框闪烁。
        """
        size = max(6, int(size))
        key = ("puff", size)
        if key in self._bubble_cache:
            return self._bubble_cache[key]
        box = PUFF_BOX
        img = Image.new("RGB", (box, box), KEY)
        d = ImageDraw.Draw(img)
        white, edge = (255, 255, 255), (206, 222, 236)
        cx = cy = box / 2.0
        s = float(size)
        blobs = ((0.30, 0.46, 0.22), (0.50, 0.34, 0.27), (0.70, 0.46, 0.22),
                 (0.50, 0.57, 0.24))

        def draw_pass(shrink, color):
            for bx, by, rr in blobs:
                r2 = max(0.04, rr - shrink)
                ox, oy = (bx - 0.5) * s, (by - 0.5) * s
                d.ellipse([cx + ox - r2 * s, cy + oy - r2 * s,
                           cx + ox + r2 * s, cy + oy + r2 * s], fill=color)
            d.rounded_rectangle([cx + (0.30 - shrink - 0.5) * s,
                                 cy + (0.50 - 0.5) * s,
                                 cx + (0.70 + shrink - 0.5) * s,
                                 cy + (0.76 - 0.5) * s],
                                radius=max(1, s * 0.12), fill=color)

        draw_pass(0.0, edge)
        draw_pass(0.045, white)
        photo = ImageTk.PhotoImage(img)
        self._bubble_cache[key] = (photo, box, box)
        return self._bubble_cache[key]

    def _puff_blank(self):
        """全透明的空图，用于让闲置泡泡窗口保持"看不见"但不销毁。"""
        if "puff_blank" not in self._bubble_cache:
            img = Image.new("RGB", (PUFF_BOX, PUFF_BOX), KEY)
            self._bubble_cache["puff_blank"] = (
                ImageTk.PhotoImage(img), PUFF_BOX, PUFF_BOX)
        return self._bubble_cache["puff_blank"]

    def _puff_size(self, age):
        """由小到大鼓起来，停一下再缩小散掉。"""
        if age < 0.85:
            return 12 + 44 * (age / 0.85)
        if age < 1.45:
            return 56
        return max(6, 56 * (1 - (age - 1.45) / (PUFF_LIFE - 1.45)))

    def _start_puffs(self):
        self._stop_puffs()
        if not self._puff_wins:
            self._puff_wins = [self._make_puff_window() for _ in range(PUFF_MAX)]
        # 全部先映射出来并显示空图，之后只换图不 resize，避免黑框闪烁
        for win, lab in self._puff_wins:
            photo = self._puff_blank()[0]
            lab.configure(image=photo)
            lab.image = photo
            win.geometry("%dx%d+0+0" % (PUFF_BOX, PUFF_BOX))
            win.deiconify()
        self._puff_last = time.time()
        self._puff_spawn_at = self._puff_last        # 立刻先冒一个
        self._puff_job = self.root.after(50, self._puff_tick)

    def _stop_puffs(self):
        if self._puff_job:
            try:
                self.root.after_cancel(self._puff_job)
            except Exception:
                pass
            self._puff_job = None
        blank = self._puff_blank()[0] if self._puff_wins else None
        for win, lab in self._puff_wins:
            try:
                lab.configure(image=blank)
                lab.image = blank
            except Exception:
                pass
        self._puffs = []

    def _puff_tick(self):
        if self.state != "sleep":
            self._stop_puffs()
            return
        now = time.time()
        dt = min(0.12, max(0.0, now - self._puff_last))
        self._puff_last = now
        # 每隔一小段时间冒一个新泡，最多同时 PUFF_MAX 个
        if now >= self._puff_spawn_at and len(self._puffs) < PUFF_MAX:
            used = {p["slot"] for p in self._puffs}
            free = [i for i in range(len(self._puff_wins)) if i not in used]
            if free:
                self._puffs.append({"slot": free[0], "age": 0.0,
                                    "dir": random.choice((-1, 1)),
                                    "off": random.choice((-34, -17, 0, 17, 34)),
                                    "lift": random.uniform(0, 24),
                                    "scale": random.uniform(0.72, 1.12)})
                self._puff_spawn_at = now + PUFF_SPAWN
        alive = []
        for p in self._puffs:
            p["age"] += dt
            age = p["age"]
            win, lab = self._puff_wins[p["slot"]]
            if age >= PUFF_LIFE:
                blank = self._puff_blank()[0]
                lab.configure(image=blank)
                lab.image = blank
                continue
            photo = self._puff_photo(min(60, self._puff_size(age) * p["scale"]))[0]
            lab.configure(image=photo)
            lab.image = photo
            bx = self.pet_x + 178 - PUFF_BOX / 2 + p["off"] + p["dir"] * (6 + age * 10)
            by = self.pet_y + 116 - PUFF_BOX + p["lift"] - age * 26
            win.geometry("%dx%d+%d+%d" % (PUFF_BOX, PUFF_BOX, int(bx), int(by)))
            alive.append(p)
        self._puffs = alive
        self._puff_job = self.root.after(55, self._puff_tick)

    def _demo_high_chute(self):
        """调试用（XINGHU_DEMO=5）：挪到高处开伞，走一遍张开 -> 飘落 -> 落地。"""
        self._move_to(self.pet_x, 60)
        self.walk_target = None
        self.parachute_target = None
        self._para_deploy_until = time.time() + 0.9
        self._set_state("parachute")

    def _demo_walk(self):
        """调试用（XINGHU_DEMO=6）：自己往左跑一段，检查跑步动画观感。"""
        self.walk_target = (max(20, self.pet_x - 320), self.pet_y)
        self._plan_walk()

    def _snap_selftest(self):
        """调试用（XINGHU_SNAP_TEST=1）：对真实窗口验证吸附与探头，结果写 debug/snap_test.txt。"""
        out = []
        sw, sh = screen_size()
        box = self._body_box()
        out.append("screen=%dx%d body=%s bounds=%s" % (sw, sh, box, self._bounds()))
        frames = window_frames(skip=self._own_rects())
        out.append("windows=%d %s" % (len(frames), frames[:4]))
        for (l, t, r, b) in frames:
            if t > 8:
                self.pet_x, self.pet_y = l + 40, t - self.W + 18
                self._snap_to_edge()
                out.append("snap-top t=%d -> y=%d need=%d ok=%s"
                           % (t, self.pet_y, t - self.W, self.pet_y == t - self.W))
                self.pet_x, self.pet_y = r - self.W * 280 // 360 + 12, self.W * 300 // 360
                self._snap_to_edge()
                out.append("snap-right r=%d -> x+body_r=%d ok=%s"
                           % (r, self.pet_x + box[2], self.pet_x + box[2] == r))
                break
        self.pet_x, self.pet_y = -9999, 900
        self.pet_x, self.pet_y = [int(v) for v in self._clamp(-9999, 900)]
        self._move_to(self.pet_x, self.pet_y)
        out.append("peek-left x=%d visible_body=%d (half=%d)"
                   % (self.pet_x, self.pet_x + box[2], (box[2] - box[0]) // 2))
        try:
            dbg = os.path.join(ROOT, "debug")
            os.makedirs(dbg, exist_ok=True)
            with open(os.path.join(dbg, "snap_test.txt"), "w",
                      encoding="utf-8") as f:
                f.write("\n".join(out))
        except Exception:
            pass

    def _write_runtime(self):
        try:
            with open(os.path.join(ROOT, "runtime.txt"), "w", encoding="utf-8") as f:
                f.write("RUNNING %d %d | pet=%s(%s) | state=%s | topmost=%s"
                        % (self.pet_x, self.pet_y, self.pet_id, self.pet_name,
                           self.state, self.cfg["topmost"]))
        except Exception:
            pass

    def _move_to(self, x, y):
        self.pet_x, self.pet_y = x, y
        self.root.geometry("%dx%d+%d+%d" % (self.W, self.W, x, y))
        if self.bub.state() != "withdrawn" and self._bub_size:
            w, h = self._bub_size
            sw, sh = screen_size()
            bx = max(0, min(sw - w, x + self.W // 2 - w // 2))
            by = max(0, min(sh - h, y + self.W * 118 // 360 - h))
            self.bub.geometry("%dx%d+%d+%d" % (w, h, bx, by))

    # ---------- 鼠标轮询 ----------
    def _poll_mouse(self):
        p = _POINT()
        user32.GetCursorPos(ctypes.byref(p))
        mx, my = p.x, p.y
        self._last_mouse = (mx, my)
        lbtn = bool(user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)
        rbtn = bool(user32.GetAsyncKeyState(VK_RBUTTON) & 0x8000)
        if not self._poll_primed:
            self._prev_lbtn, self._prev_rbtn = lbtn, rbtn
            self._poll_primed = True
            return

        if lbtn and not self._prev_lbtn:
            # 按下：记录长按起点 + 双击判定（双击仅用于桌面空白走动）
            now = time.time()
            self._pressing = True
            self._press_t = now
            self._press_pos = (mx, my)
            self._press_on_body = self._hit_body(mx, my)
            self._long_press_fired = False

            dx = mx - self._last_down_pos[0]
            dy = my - self._last_down_pos[1]
            near = (dx * dx + dy * dy) ** 0.5 <= DOUBLE_DIST
            if now - self._last_down_t <= DOUBLE_GAP and near and self._click_chain >= 1:
                self._click_chain = 0
                self._on_double_down(mx, my)
            else:
                self._click_chain = 1
            self._last_down_t = now
            self._last_down_pos = (mx, my)

        elif not lbtn and self._prev_lbtn:
            self._on_up(mx, my)

        # 长按触发拖拽：按住宠物超过阈值即进入拖拽，无需双击
        if (self._pressing and self._press_on_body and not self._long_press_fired
                and not self.dragging
                and time.time() - self._press_t >= LONG_PRESS_SEC):
            self._long_press_fired = True
            self._start_drag(*self._press_pos)

        if rbtn and not self._prev_rbtn:
            self._on_right(mx, my)

        if self.dragging:
            self._on_mouse_move_global(mx, my)
        self._prev_lbtn, self._prev_rbtn = lbtn, rbtn

    def _on_mouse_move_global(self, x, y):
        if not self.dragging:
            return
        # 拖拽途中：先按角色身体限制，再实时磁吸到附近的框（跟手且有吸附感）
        nx, ny = self._clamp(x - self.drag_off[0], y - self.drag_off[1])
        nx, ny = self._snap(nx, ny, SNAP_LIVE)
        self._move_to(int(nx), int(ny))

    # ---------- 行走规划 ----------
    def _plan_walk(self):
        """根据目标高度决定走还是飞。宠物脚底约在窗口底部上方一点。"""
        if not self.walk_target:
            return
        tx, ty = self.walk_target
        foot_y = self.pet_y + self.W * 300 // 360
        cx = self.pet_x + self.W // 2
        if ty < foot_y - FLY_HEIGHT:
            self._set_state("fly_left" if tx < cx else "fly")
        elif ty > foot_y + FLY_HEIGHT:
            # 目标明显在下方：直接开伞飘下去，避免倒着走路
            self.parachute_target = (tx, ty)
            self.walk_target = None
            self._para_deploy_until = time.time() + 0.7
            self._set_state("parachute")
        else:
            self._set_state("walk_left" if tx < cx else "walk")

    def _advance_walk(self):
        if not self.walk_target or self.state not in (
                "walk", "walk_left", "fly", "fly_left"):
            return
        tx, ty = self.walk_target
        cx, cy = self.pet_x + self.W // 2, self.pet_y + self.W * 300 // 360
        dx, dy = tx - cx, ty - cy
        dist = (dx * dx + dy * dy) ** 0.5
        if dist < 18:
            self.walk_target = None
            self._snap_to_edge()      # 走到点后贴合最近的框（标题栏/任务栏/屏幕边）
            self._set_state("greet")
            return
        # 飞行中若已经飞到目标高度附近，切换回走路
        if self.state in ("fly", "fly_left") and ty >= cy - FLY_HEIGHT // 2:
            self._set_state("walk_left" if dx < 0 else "walk")
        step = min((FLY_SPEED if self.state in ("fly", "fly_left") else WALK_SPEED), dist)
        nx = self.pet_x + dx / dist * step
        ny = self.pet_y + dy / dist * step
        nx, ny = self._clamp(nx, ny)
        want_state = ("fly_left" if dx < 0 else "fly") if self.state in ("fly", "fly_left") \
            else ("walk_left" if dx < 0 else "walk")
        if self.state != want_state:
            self._set_state(want_state)
        self._move_to(int(nx), int(ny))

    def _advance_parachute(self):
        """降落伞：先播完膨胀张开动画，再缓缓竖直飘到底部，落地恢复 idle。"""
        if self.state != "parachute":
            return
        if time.time() < self._para_deploy_until:
            return  # 伞还在张开，暂不下降，让膨胀效果看得清
        sw, sh = screen_size()
        if self.parachute_target:
            tx, ty = self.parachute_target
            # 目标脚底在 ty，窗口顶部应停在 ty - 角色高度
            foot_h = self.W * 300 // 360
            ground = max(0, min(sh - self.W, ty - foot_h))
            goal_x = max(0, min(sw - self.W, tx - self.W // 2))
        else:
            ground = sh - self.W - GROUND_MARGIN
            goal_x = self.pet_x
        # 水平方向缓慢靠拢，竖直方向匀速飘落
        dx = goal_x - self.pet_x
        nx = self.pet_x + (1 if dx > 1 else -1 if dx < -1 else 0) * min(abs(dx), 2)
        ny = min(ground, self.pet_y + PARACHUTE_SPEED)
        if self.pet_y >= ground - 1 and abs(dx) <= 2:
            self._move_to(int(goal_x), int(ground))
            self.parachute_target = None
            self._set_state("greet" if self.walk_target else "idle")
            self._say(random.choice(self.lines))
            return
        self._move_to(int(nx), int(ny))

    # ---------- 主循环 ----------
    def _tick(self):
        self._poll_mouse()
        now = time.time()

        # 闲置自动睡觉：仅在空闲态触发，不打断走路/飞行/拖拽/降落伞
        if self.state in ("idle", "greet", "interact") and \
                now - self.last_interact >= IDLE_SLEEP_SEC:
            self._set_state("sleep")

        spec = self.manifest["actions"].get(self.state, {"fps": 6, "loop": True})
        fps = spec.get("fps", 6)
        if now - self.last_tick >= 1.0 / max(fps, 1):
            self.last_tick = now
            frames = self.imgs[self.state]
            if len(frames) > 1:
                self.frame += 1
                if self.frame >= len(frames):
                    if spec.get("loop", True):
                        self.frame = 0
                    else:
                        self.frame = len(frames) - 1
                        self._after_once()
            self._render()

        self._advance_walk()
        self._advance_parachute()
        self.root.after(30, self._tick)

    def _after_once(self):
        if self.state == "drop":
            self.root.after(400, lambda: self._set_state("idle"))
        elif self.state == "greet":
            self.root.after(900, lambda: self._set_state(
                "idle" if not self.walk_target else
                ("walk_left" if self.walk_target[0] < self.pet_x + self.W // 2 else "walk")))
        elif self.state == "interact":
            self.root.after(500, lambda: self._set_state("idle"))

    def destroy(self):
        if self._voice:
            self._voice.shutdown()
        self._close_chat()
        self.root.destroy()


if __name__ == "__main__":
    PetApp()
