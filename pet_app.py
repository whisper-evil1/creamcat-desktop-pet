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
import threading
import time
import tkinter as tk
from ctypes import wintypes
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageTk
import voice
import pet_chat
import pet_dialogue

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.abspath(__file__))
PETS_DIR = os.path.join(ROOT, "assets", "pets")
REGISTRY = os.path.join(ROOT, "pets.json")
CONFIG_PATH = os.path.join(ROOT, "config.json")
MOOD_LOG_PATH = os.path.join(ROOT, "mood_log.json")   # P1 心情打卡（本地、进 gitignore）
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
# 液态玻璃工具条尺寸（图标版，无文字）
HOVER_W, HOVER_H = 112, 50
CHAT_W, CHAT_H = 432, 58
# 液态玻璃右键菜单（原生 tk.Menu 画不出磨砂，只能自绘）
MENU_ROW_H = 34            # 单行高度
MENU_SEP_H = 11            # 分隔线占位
MENU_PAD_T, MENU_PAD_B = 9, 9
MENU_PAD_L = 16            # 无勾选列的左内边距
MENU_MARK_W = 32           # 有勾选/单选时的左内边距（留给标记）
MENU_PAD_R = 16
MENU_FONT = 14             # 菜单文字字号（像素，1:1）
MENU_MIN_W = 212
MENU_RADIUS = 18
PUFF_MAX = 4               # 休眠时同时存在的泡泡数量上限
PUFF_SPAWN = 0.45          # 每隔多少秒冒出一个新泡泡
PUFF_LIFE = 2.0            # 单个泡泡寿命（秒）
PUFF_BOX = 68              # 泡泡窗口固定边长，避免每帧 resize 闪黑框
GREET_AFTER_HOURS = 3.0    # P0 离线超过这么多小时，回来时主动问候
SUPPORT_STEP_MS = 4600     # P2 舒缓引导每步间隔（毫秒）

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


# ---------- P1 心情打卡：本地日志读写（失败静默，不影响桌宠） ----------
def load_mood_log():
    try:
        if os.path.exists(MOOD_LOG_PATH):
            data = json.load(open(MOOD_LOG_PATH, encoding="utf-8"))
            return data if isinstance(data, list) else []
    except Exception:
        pass
    return []


def save_mood_log(entries):
    try:
        with open(MOOD_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    # 同步写一份 JS，供主界面在 file:// 下用 <script> 加载（fetch 本地 json 会被 CORS 拦）
    try:
        js_path = os.path.join(ROOT, "showcase", "data", "mood_log.js")
        os.makedirs(os.path.dirname(js_path), exist_ok=True)
        payload = json.dumps(entries, ensure_ascii=False)
        with open(js_path, "w", encoding="utf-8") as f:
            f.write("// 由桌宠打卡自动生成，不要手改\nwindow.MOOD_LOG = " + payload + ";\n")
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
        self._menu_stack = []            # 液态玻璃右键菜单（栈：父菜单 + 级联子菜单）
        self._menu_cache = {}            # (seed, hot) -> PhotoImage
        self._menu_base_cache = {}       # (w, h) -> 未抠图的玻璃底板 RGBA
        self.user_name = (self.cfg.get("user_name") or "").strip()
        self._chat_win = None
        self._voice = None              # root 建好后实例化
        # 悬停状态条（回主界面 / 对话）
        self._hover_win = None
        self._hover_visible = False
        self._hover_hide_job = None
        self._hover_suppress_until = 0.0
        self._hover_hot = -1             # 当前悬停的按钮（-1 无 / 0 主界面 / 1 对话）
        self._hover_label = None
        self._dialogue = pet_dialogue.DialogueEngine()
        self._chat_seq = 0              # 异步回复代号：旧回复作废
        self._chat_busy = False
        self._chat_guard = 0.0          # 刚打开输入条的保护期，避免被同一帧的"点别处"关掉
        self._ui_press = False          # 点状态条/输入条时不走桌面点击逻辑
        # P0 情绪记忆：衰减前先算出离线时长，再决定要不要主动问候
        raw_seen = self.cfg.get("last_seen")
        try:
            away_hours = (time.time() - float(raw_seen)) / 3600.0 if raw_seen else 0.0
        except (TypeError, ValueError):
            away_hours = 0.0
        self._greet_pending = away_hours >= GREET_AFTER_HOURS  # 久别重逢主动问候
        self.emotion = pet_chat.emotion_decay(
            {k: self.cfg.get(k) for k in ("mood", "bond", "last_seen")})
        # P2 舒缓引导：分步吐字 + 可打断
        self._support_steps = None
        self._support_i = 0
        self._support_job = None
        self._support_seq = 0           # 代号：新流程让旧流程作废

        self.root = tk.Tk()
        self.root.report_callback_exception = self._tk_error   # 回调异常落盘，便于排障
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
        switch_env = os.environ.get("XINGHU_SWITCH")
        if switch_env:
            # 调试用：按逗号顺序连续换宠，验证"换宠闪退"是否真的解决
            seq = [x.strip() for x in switch_env.split(",") if x.strip()]

            def _cycle(i=0):
                if i >= len(seq):
                    return
                self._switch_pet(seq[i])
                self.root.after(800, lambda: _cycle(i + 1))

            self.root.after(1400, _cycle)

        self._write_runtime()
        if self._greet_pending and not any(
                k.startswith("XINGHU_DEMO") and os.environ.get(k) == "1"
                for k in list(os.environ)):
            # 回来时先说话，再刷新时间戳并落盘
            self.root.after(1200, self._greet_on_return)
        self._tick()
        self.root.mainloop()

    def _greet_on_return(self):
        """P0：久别重逢的主动状态问候，带出当前心情。"""
        if not self._greet_pending:
            return
        self._greet_pending = False
        self._say_voice(pet_chat.greeting(self.emotion, self.pet_name, self.user_name))
        self.emotion = pet_chat.emotion_apply(self.emotion, (2, 0))
        self._save_emotion()

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

    def _tk_error(self, exc, val, tb):
        """Tk 回调异常：写 _raw/tk_error.txt 再按默认方式抛出。

        pythonw 没有控制台，异常被吞掉时只能靠这份日志定位（以前"换宠闪退"
        就是这么查的）。
        """
        try:
            import traceback
            path = os.path.join(ROOT, "_raw", "tk_error.txt")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write("".join(traceback.format_exception(exc, val, tb)) + "\n")
        except Exception:
            pass
        sys.__excepthook__(exc, val, tb)

    def _build_photos(self, frames_dir=None, manifest=None, w=None):
        """把真值 alpha 帧按 DISPLAY_SCALE 缩放后再展平——顺序不能反。

        先缩放再展平，彩色边缘才会落在 alpha 之外被键色吃掉；反过来（先展平后缩放）
        键色会和毛边混在一起，边缘出现一圈脏色。
        """
        need = abs(DISPLAY_SCALE - 1.0) > 1e-3
        frames_dir = frames_dir or self.frames
        manifest = manifest or self.manifest
        w = w or self.W
        imgs, photos = {}, {}
        for state in manifest["actions"]:
            d = os.path.join(frames_dir, state)
            names = sorted(p for p in os.listdir(d) if p.endswith(".png"))
            truth = [Image.open(os.path.join(d, n)).convert("RGBA") for n in names]
            if need:
                truth = [i.resize((w, w), Image.LANCZOS) for i in truth]
            imgs[state] = truth
            photos[state] = [ImageTk.PhotoImage(_flatten(i)) for i in truth]
        self.imgs, self.photo_cache = imgs, photos

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
        按**当前状态的那一帧**算：趴睡/拖拽的轮廓和平站差很多，
        固定用 idle 会让状态条在别的姿态下对不准身体。
        """
        state = getattr(self, "state", "idle")
        frame = getattr(self, "frame", 0)
        imgs = getattr(self, "imgs", {})
        key = (state, min(frame, 8))
        if self._body_box_cache and self._body_box_cache[0] == key:
            return self._body_box_cache[1]
        W = self.W
        box = (W * 60 // 360, W * 110 // 360, W * 300 // 360, W)
        frames = imgs.get(state) or imgs.get("idle") or []
        if frames:
            idx = min(frame, len(frames) - 1)
            # 90 而不是 40：清掉素材边缘残留的淡淡虚影，对齐只认真正的身体轮廓
            b = frames[idx].getchannel("A").point(lambda v: 255 if v > 90 else 0).getbbox()
            if b:
                box = b
        self._body_box_cache = (key, box)
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
        if self._menu_stack:
            self._close_menu()          # 再按一次右键：先收起旧菜单
        if not self._hit_body(x, y):
            return
        self._note_interact()
        self._hide_hover_bar()
        self._hover_suppress_until = time.time() + 1.2
        self._open_menu(x, y, self._main_menu_items())

    def _main_menu_items(self):
        """右键菜单内容（数据化，交给自绘玻璃菜单渲染）。"""
        mood_items = [{"label": label,
                       "command": lambda s=score, l=label: self._check_in(s, l)}
                      for score, label in pet_chat.MOOD_LABELS]
        mood_items.append({"kind": "sep"})
        mood_items.append({"label": "看看近 7 天…", "command": self._show_mood_chart})

        items = [
            {"label": "聊聊天…", "command": self._open_chat},
            {"label": "说句话",
             "command": lambda: self._say_voice(random.choice(self.lines))},
            {"label": "睡一会儿", "command": lambda: self._set_state("sleep")},
            {"label": "陪我走走", "command": self._random_walk},
            {"label": "今天心情如何", "children": mood_items},
            {"kind": "sep"},
            {"label": "回到主界面（2D 小窝）", "command": self._open_home},
            {"label": "去星穹展厅", "command": self._open_showcase},
            {"label": "去 3D 小屋", "command": self._open_room3d},
            {"label": "宠物图鉴", "command": self._open_dex},
        ]
        pets = built_pets()
        if len(pets) > 1:
            items.append({
                "label": "换一只宠物",
                "children": [{"label": p.get("name", p["id"]), "kind": "radio",
                              "checked": p["id"] == self.pet_id,
                              "command": lambda pid=p["id"]: self._switch_pet(pid)}
                             for p in pets],
            })
        items += [
            {"kind": "sep"},
            {"label": "显示在其他应用上层", "kind": "check",
             "checked": bool(self.cfg.get("topmost")),
             "command": self._toggle_topmost},
            {"kind": "sep"},
            {"label": "拜拜~", "command": self.destroy, "danger": True},
        ]
        return items

    # ---------- 液态玻璃右键菜单 ----------
    def _menu_font(self, scale=1):
        try:
            return ImageFont.truetype(BUBBLE_FONT, int(MENU_FONT * scale))
        except Exception:
            return ImageFont.load_default()

    def _menu_layout(self, items):
        """菜单宽高、每行 y 区间、左内边距。纯计算，便于自测。"""
        font = self._menu_font()
        marks = any(it.get("kind") in ("check", "radio") for it in items)
        pad_l = MENU_MARK_W if marks else MENU_PAD_L
        text_w = 0.0
        for it in items:
            if it.get("kind") == "sep":
                continue
            text_w = max(text_w, font.getlength(it["label"]))
        w = int(max(MENU_MIN_W, text_w + pad_l + MENU_PAD_R + 18))
        rows, y = [], MENU_PAD_T
        for it in items:
            rh = MENU_SEP_H if it.get("kind") == "sep" else MENU_ROW_H
            rows.append((y, y + rh))
            y += rh
        return w, y + MENU_PAD_B, rows, pad_l

    def _menu_base(self, w, h):
        """玻璃底板（未抠图），同一尺寸只画一次。"""
        key = (w, h)
        if key not in self._menu_base_cache:
            if len(self._menu_base_cache) > 6:
                self._menu_base_cache.clear()
            self._menu_base_cache[key] = self._glass_pill(
                w, h, MENU_RADIUS, keyed=False, sky=0.26, tone=0.84)
        return self._menu_base_cache[key]

    def _menu_compose(self, items, hot, w, h, rows, pad_l):
        """把菜单项画到玻璃底板上，返回抠好 KEY 的 RGB 图（便于离线预览/自测）。

        文字在 3 倍画布上画完再缩回，边缘干净；底板单独缓存，
        切换高亮时不必重画整块玻璃。
        """
        S = 3
        W, H = w * S, h * S
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        font = self._menu_font(S)
        for i, it in enumerate(items):
            y0, y1 = rows[i]
            if it.get("kind") == "sep":
                cy = (y0 + y1) / 2.0
                d.line([(pad_l * S, cy * S), ((w - MENU_PAD_R) * S, cy * S)],
                       fill=(255, 255, 255, 34), width=S)
                continue
            on = (i == hot)
            if on:
                d.rounded_rectangle(
                    [6 * S, (y0 + 2) * S, (w - 6) * S, (y1 - 2) * S], radius=10 * S,
                    fill=(255, 255, 255, 40), outline=(255, 255, 255, 66),
                    width=int(1.2 * S))
            cy = (y0 + y1) / 2.0
            # 勾选 / 单选标记：走线而不是画字符，任何字体下都不会缺字形
            if it.get("kind") in ("check", "radio"):
                mx, my = (MENU_MARK_W // 2 + 2) * S, cy * S
                if it.get("checked"):
                    if it["kind"] == "radio":
                        d.ellipse([mx - 5 * S, my - 5 * S, mx + 5 * S, my + 5 * S],
                                  fill=(178, 228, 255, 240))
                    else:
                        d.line([(mx - 5 * S, my + 0.5 * S), (mx - 1 * S, my + 4.5 * S),
                                (mx + 6 * S, my - 5 * S)],
                               fill=(178, 228, 255, 250), width=int(2.2 * S),
                               joint="curve")
                elif it["kind"] == "radio":
                    d.ellipse([mx - 4 * S, my - 4 * S, mx + 4 * S, my + 4 * S],
                              outline=(255, 255, 255, 80), width=int(1.2 * S))
            if it.get("danger"):
                color = (255, 216, 210, 255)
            else:
                color = (255, 255, 255, 255) if on else (242, 240, 248, 255)
            d.text((pad_l * S, cy * S), it["label"], font=font, anchor="lm", fill=color)
            if it.get("children"):
                ax, ay = (w - 15) * S, cy * S
                d.line([(ax - 2.5 * S, ay - 5 * S), (ax + 3 * S, ay),
                        (ax - 2.5 * S, ay + 5 * S)],
                       fill=(255, 255, 255, 150), width=int(1.6 * S), joint="curve")

        ov = ov.resize((w, h), Image.Resampling.LANCZOS)
        img = self._menu_base(w, h).copy()
        img.alpha_composite(ov)
        return self._alpha_to_key(img)

    def _menu_image(self, items, hot, w, h, rows, pad_l):
        seed = (tuple((it.get("label", ""), it.get("kind", "item"),
                       bool(it.get("checked"))) for it in items),
                pad_l, w, h)
        key = (seed, hot)
        if key in self._menu_cache:
            return self._menu_cache[key]
        if len(self._menu_cache) > 48:
            self._menu_cache.clear()
        photo = ImageTk.PhotoImage(self._menu_compose(items, hot, w, h, rows, pad_l))
        self._menu_cache[key] = photo
        return photo

    def _menu_win_new(self):
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.attributes("-transparentcolor", KEY)
        win.configure(bg=KEY)
        lab = tk.Label(win, bg=KEY, bd=0, highlightthickness=0, cursor="hand2")
        lab.pack()
        return win, lab

    def _menu_place(self, sx, sy, w, h, work=None, body=None):
        """主菜单落点：默认从宠物外侧展开，实在放不下才压在身上。

        鼠标落在角色右半边就往左开、落在下半边就往上开——菜单永远朝"远离宠物"
        的方向长，右键之后不会糊住角色的脸；最后再夹进桌面可用区。
        纯计算，便于自测。
        """
        if work is None:
            work = self._work_area()
        if body is None:
            bx0, by0, bx1, by1 = self._body_box()
            body = (self.pet_x + bx0, self.pet_y + by0,
                    self.pet_x + bx1, self.pet_y + by1)
        wx0, wy0, wx1, wy1 = work
        bcx = (body[0] + body[2]) / 2.0

        def clamp(x, y):
            return (max(wx0 + 6, min(wx1 - w - 6, x)),
                    max(wy0 + 6, min(wy1 - h - 6, y)))

        def overlap(x, y):
            return not (x + w <= body[0] or x >= body[2] or
                        y + h <= body[1] or y >= body[3])

        # 菜单贴着角色的外侧站：鼠标在右半边先试左侧，否则先试右侧；
        # 两边都挤就摸头顶 / 脚下，最后才允许压在身上。
        left = (body[0] - w - 8, sy - 4)
        right = (body[2] + 8, sy - 4)
        above = (sx - w // 2, body[1] - h - 8)
        below = (sx - w // 2, body[3] + 8)
        order = [left, above, below, right] if sx >= bcx else [right, above, below, left]
        # 第一轮只接受"本来就在可用区内"的位置（被夹到屏幕边会贴在边上很难看）；
        # 第二轮才允许夹取，仍以不压住角色为准。
        for strict in (True, False):
            for cx_, cy_ in order:
                px, py = clamp(cx_, cy_)
                if strict and (abs(px - cx_) > 0.5 or abs(py - cy_) > 0.5):
                    continue
                if not overlap(px, py):
                    return px, py
        return clamp(sx + 4, sy + 4)

    def _open_menu(self, sx, sy, items, parent=None, anchor=None):
        """弹出一张玻璃菜单；parent/anchor 用于级联子菜单定位。"""
        if parent is None:
            self._close_menu()
        w, h, rows, pad_l = self._menu_layout(items)
        wx0, wy0, wx1, wy1 = self._work_area()
        if parent is None:
            x, y = self._menu_place(sx, sy, w, h)
        else:
            px, py, pw = anchor
            x, y = px + pw - 10, py - 8
            if x + w > wx1 - 8:              # 右侧放不下：翻到父菜单左边
                x = px - w + 10
            x = max(wx0 + 6, min(wx1 - w - 6, x))
            y = max(wy0 + 6, min(wy1 - h - 6, y))

        win, lab = self._menu_win_new()
        photo = self._menu_image(items, -1, w, h, rows, pad_l)
        lab.configure(image=photo)
        lab.image = photo
        win.geometry("%dx%d+%d+%d" % (w, h, x, y))
        win.deiconify()
        win.lift()
        entry = {"win": win, "lab": lab, "items": items, "rows": rows,
                 "w": w, "h": h, "x": x, "y": y, "hot": -1, "pad_l": pad_l,
                 "parent_idx": None}
        self._menu_stack.append(entry)
        lab.bind("<Motion>", lambda e, en=entry: self._menu_motion(en, e.y))
        lab.bind("<Button-1>", lambda e, en=entry: self._menu_click(en, e))
        return entry

    def _close_menu(self, keep=0):
        """收起菜单（keep 之前的保留，用于只关子菜单）。"""
        while len(self._menu_stack) > keep:
            entry = self._menu_stack.pop()
            try:
                entry["win"].destroy()
            except Exception:
                pass

    def _menu_contains(self, mx, my):
        for e in self._menu_stack:
            if e["x"] <= mx <= e["x"] + e["w"] and e["y"] <= my <= e["y"] + e["h"]:
                return True
        return False

    @staticmethod
    def _menu_row_at(entry, ly):
        """窗口内纵坐标 -> 菜单项序号（分隔线上返回 -1）。"""
        for i, (y0, y1) in enumerate(entry["rows"]):
            if y0 <= ly < y1:
                if entry["items"][i].get("kind") == "sep":
                    return -1
                return i
        return -1

    def _menu_track(self, mx, my):
        """按鼠标位置刷新最上层菜单的高亮与级联子菜单。

        无边框窗口在 Windows 上收不到可靠的 <Motion>，和状态条一样用轮询驱动。
        """
        for entry in reversed(self._menu_stack):
            if not entry["win"].winfo_exists():
                continue
            if (entry["x"] <= mx <= entry["x"] + entry["w"]
                    and entry["y"] <= my <= entry["y"] + entry["h"]):
                self._menu_motion(entry, my - entry["y"])
                return

    def _menu_motion(self, entry, ly):
        idx = self._menu_row_at(entry, ly)
        if idx != entry["hot"]:
            entry["hot"] = idx
            photo = self._menu_image(entry["items"], idx, entry["w"], entry["h"],
                                     entry["rows"], entry["pad_l"])
            entry["lab"].configure(image=photo)
            entry["lab"].image = photo
        depth = next((i for i, e in enumerate(self._menu_stack) if e is entry), -1)
        if depth < 0:
            return
        item = entry["items"][idx] if 0 <= idx < len(entry["items"]) else None
        child = item.get("children") if item else None
        has_child = len(self._menu_stack) > depth + 1
        if child:
            if not has_child or self._menu_stack[depth + 1].get("parent_idx") != idx:
                self._close_menu(keep=depth + 1)
                y0 = entry["rows"][idx][0]
                sub = self._open_menu(0, 0, child, parent=entry,
                                      anchor=(entry["x"], entry["y"] + y0, entry["w"]))
                sub["parent_idx"] = idx
        elif has_child:
            self._close_menu(keep=depth + 1)

    def _menu_click(self, entry, event):
        self._ui_press = True                 # 点的是自己的 UI，不算桌面点击
        self._chat_guard = time.time() + 0.4
        idx = self._menu_row_at(entry, event.y)
        if idx < 0:
            return
        it = entry["items"][idx]
        if it.get("children"):
            depth = next((i for i, e in enumerate(self._menu_stack) if e is entry), 0)
            self._close_menu(keep=depth + 1)
            y0 = entry["rows"][idx][0]
            sub = self._open_menu(0, 0, it["children"], parent=entry,
                                  anchor=(entry["x"], entry["y"] + y0, entry["w"]))
            sub["parent_idx"] = idx
            return
        cmd = it.get("command")
        self._close_menu()
        if cmd:
            self.root.after(1, cmd)           # 先收菜单再执行，避免回调里销毁窗口

    # ---------- P1 心情打卡 ----------
    def _check_in(self, score, label):
        """记一次心情：写本地日志 + 按分数调情绪 + 宠物回应。"""
        entries = load_mood_log()
        entries.append({"ts": time.time(), "score": int(score)})
        entries = entries[-200:]          # 数量上限，防文件无限增长
        save_mood_log(entries)
        # 打卡映射：1 分 -> -10 心情，5 分 -> +10 心情；亲昵固定 +2
        dm = (int(score) - 3) * 5
        self.emotion = pet_chat.emotion_apply(self.emotion, (dm, 2))
        self._save_emotion()
        who = self.user_name or "你"
        low = "记下了。" + who + "今天有点难过呀。\n我陪你，慢慢来。"
        mid = "记下了。" + who + "今天还算平静。\n这样就很好。"
        high = "记下了。" + who + "今天心情不错！\n我也跟着亮堂起来了。"
        self._say_voice(low if score <= 2 else (high if score >= 4 else mid))

    def _show_mood_chart(self):
        """近 7 天心情趋势：纯 tkinter Canvas 折线，无第三方依赖。"""
        days = pet_chat.mood_daily_avg(load_mood_log())
        win = tk.Toplevel(self.root)
        win.title("近 7 天心情")
        win.attributes("-topmost", True)
        win.resizable(False, False)
        win.configure(bg="#FFF7EC")
        tk.Label(win, text="近 7 天心情（1 很糟 · 5 很好）", bg="#FFF7EC", fg="#5A4632",
                 font=("Microsoft YaHei", 11, "bold")).pack(padx=16, pady=(12, 6), anchor="w")
        W, H, PAD = 420, 180, 34
        cv = tk.Canvas(win, width=W, height=H, bg="#FFF7EC", highlightthickness=0)
        cv.pack(padx=12, pady=(0, 6))
        for s in range(1, 6):
            yy = H - PAD - (s - 1) * ((H - 2 * PAD) / 4.0)
            cv.create_line(PAD, yy, W - 12, yy, fill="#F0E4D5", width=1)
            cv.create_text(PAD - 10, yy, text=str(s), fill="#A08B72",
                           font=("Microsoft YaHei", 9))
        pts = []
        for i, (day, avg) in enumerate(days):
            xx = PAD + i * ((W - PAD - 18) / 6.0)
            cv.create_text(xx, H - 14, text=day[5:], fill="#A08B72",
                           font=("Microsoft YaHei", 8))
            if avg is not None:
                yy = H - PAD - (avg - 1) * ((H - 2 * PAD) / 4.0)
                pts.append((xx, yy))
                cv.create_oval(xx - 4, yy - 4, xx + 4, yy + 4,
                               fill="#F3B7A0", outline="#E8843C")
        if len(pts) >= 2:
            cv.create_line([c for p in pts for c in p], fill="#E8843C", width=2)
        elif not pts:
            cv.create_text(W // 2, H // 2, text="还没有打卡，右键我选「今天心情如何」",
                           fill="#A08B72", font=("Microsoft YaHei", 10))
        tk.Button(win, text="关闭", command=win.destroy,
                  font=("Microsoft YaHei", 10), bg="#F3B7A0", fg="white",
                  relief="flat", padx=18).pack(pady=(0, 12))
        win.update_idletasks()
        x = max(0, min(screen_size()[0] - win.winfo_width(), self.pet_x - 40))
        y = max(0, min(screen_size()[1] - win.winfo_height(), self.pet_y + self.W + 10))
        win.geometry("+%d+%d" % (x, y))

    def _load_pet(self, pid):
        """就地换一套宠物素材（不重启进程）。

        以前用 os.execv 重启自己，Windows 上父进程先销毁 Tk 再 exec，
        新进程偶尔起不来（语音线程/托盘句柄还没收干净），表现就是"换宠闪退"。
        现在改成先把新包全部读进来，成功后再整体替换，失败就原样不动。
        """
        frames = pet_frames(pid)
        try:
            manifest = json.load(open(os.path.join(frames, "manifest.json"),
                                      encoding="utf-8"))
            cw = int(manifest.get("canvas", [360, 360])[0])
            w = max(120, int(round(cw * DISPLAY_SCALE)))
            self._build_photos(frames, manifest, w)
        except Exception:
            return False

        self.pet_id = pid
        self.pet_meta = pet_meta(pid)
        self.pet_name = (self.pet_meta or {}).get("name", pid)
        self.frames = frames
        self.manifest = manifest
        self.W = w
        self._body_box_cache = None
        self.lines = self._load_lines()
        self.state = "idle"
        self.frame = 0
        self.walk_target = None
        self.parachute_target = None
        self.dragging = False
        self._pressing = False
        self._bub_size = None
        return True

    def _switch_pet(self, pid):
        """换宠物：进程内热切换，不再重启。"""
        if pid == self.pet_id:
            return
        self._hide_hover_bar()
        self._close_chat()
        if not self._load_pet(pid):
            self._show_bubble("这只还没装好呀，\n先换回原来那只吧。", small=True, hold=2200)
            return
        self.cfg["pet"] = pid
        save_config(self.cfg)
        # 尺寸变了要重新落位，别让角色一半在屏幕外
        sw, sh = screen_size()
        self.pet_x = max(0, min(sw - self.W, self.pet_x))
        self.pet_y = max(0, min(sh - self.W, self.pet_y))
        self.root.geometry("%dx%d+%d+%d" % (self.W, self.W, self.pet_x, self.pet_y))
        self._write_runtime()
        self._show_bubble("换好啦，我是" + self.pet_name + "～", small=True, hold=2200)

    def _toggle_topmost(self):
        val = not bool(self.cfg.get("topmost"))
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

    @staticmethod
    def _alpha_to_key(img):
        """RGBA -> RGB：3 倍超采样后按阈值抠图，边缘平滑且不留绿边/黑点。

        不能用半透明直接混 KEY（会发绿），也不能抖动（会出黑点）；
        超采样缩小后再硬阈值，边缘只剩 1px 台阶，肉眼接近平滑。
        """
        src = img.load()
        out = Image.new("RGB", img.size, KEY_RGB)
        dst = out.load()
        w, h = img.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = src[x, y]
                if a >= 108:
                    dst[x, y] = (r, g, b)
        return out

    @staticmethod
    def _draw_bubble_shape(draw, box, radius, tail=None, fill=None, outline=None, width=0):
        x0, y0, x1, y1 = box
        draw.rounded_rectangle(box, radius=radius, fill=fill,
                               outline=outline, width=width)
        if tail:
            cx, top, half, tip = tail
            draw.polygon([(cx - half, top), (cx + half, top), (cx, tip)], fill=fill)
            if outline:
                draw.line([(cx - half, top), (cx, tip), (cx + half, top)],
                          fill=outline, width=max(1, width))

    def _puffy_bubble(self, w, h, text=None, font_size=17, dark=False):
        """3D 膨胀气泡：阴影 / 渐变主体 / 高光 / 内描边 / 连体尖角。

        在 3 倍画布上画 RGBA，再缩回目标尺寸并以抖动阈值抠成 KEY 透明。
        这样边缘平滑、没有绿色残边，尾巴也不会留下接缝横线。
        """
        S = 3
        W, H = w * S, h * S
        tail = 14 if text is not None else 0
        body_h = h - tail
        BH = body_h * S
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)

        def shape(box, fill, outline=None, width=0, t=None, blur=0):
            part = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            dp = ImageDraw.Draw(part)
            self._draw_bubble_shape(dp, box, (22 if dark else 26) * S, t, fill, outline, width * S)
            if blur:
                part = part.filter(ImageFilter.GaussianBlur(blur * S))
            layer.alpha_composite(part)

        # 阴影：两层错位柔化，形成浮起的厚度（输入条本身无尖角）
        t1 = (w * S // 2, BH + 1 * S, 9 * S, (h - 1) * S) if tail else None
        t2 = (w * S // 2, BH, 10 * S, (h - 1) * S) if tail else None
        shape([2 * S, 4 * S, (w - 2) * S, (body_h + 3) * S], (70, 54, 42, 52),
              t=t1, blur=2)
        shape([1 * S, 2 * S, (w - 1) * S, (body_h + 1) * S], (78, 60, 48, 62),
              t=t2, blur=1)

        if dark:
            # 深色输入条：顶部微亮、底部更深，右侧有柔和高光
            grad = Image.new("RGBA", (W, BH), (0, 0, 0, 0))
            gd = ImageDraw.Draw(grad)
            for yy in range(BH):
                t = yy / max(1, BH - 1)
                gd.line([(0, yy), (W, yy)], fill=(int(61 - 12 * t), int(61 - 12 * t), int(64 - 12 * t), 255))
            grad.putalpha(Image.new("L", (W, BH), 255))
            mask = Image.new("L", (W, H), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, BH - 1], radius=22 * S, fill=255)
            grad_mask = mask.crop((0, 0, W, BH))
            grad.putalpha(grad_mask)
            layer.alpha_composite(grad, (0, 0))
            # 顶部高光 / 底部暗边
            hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            dh = ImageDraw.Draw(hi)
            dh.rounded_rectangle([3 * S, 2 * S, W - 3 * S, BH // 2], radius=18 * S,
                                 outline=(255, 255, 255, 42), width=2 * S)
            dh.rounded_rectangle([2 * S, 2 * S, W - 2 * S, BH - 2 * S], radius=21 * S,
                                 outline=(255, 255, 255, 22), width=S)
            hi.putalpha(ImageChops.multiply(hi.getchannel("A"), mask))
            layer.alpha_composite(hi)
        else:
            # 奶白渐变主体（整张画布，尾巴也有同样的渐变，不留空白）
            grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            gd = ImageDraw.Draw(grad)
            for yy in range(H):
                t = yy / max(1, H - 1)
                gd.line([(0, yy), (W, yy)], fill=(
                    int(255 - 6 * t), int(255 - 13 * t), int(252 - 20 * t), 255))
            mask = Image.new("L", (W, H), 0)
            dm = ImageDraw.Draw(mask)
            dm.rounded_rectangle([0, 0, W - 1, BH - 1], radius=26 * S, fill=255)
            dm.polygon([(w * S // 2 - 10 * S, BH - 2 * S),
                        (w * S // 2 + 10 * S, BH - 2 * S),
                        (w * S // 2, H - 1)], fill=255)
            grad.putalpha(mask)
            layer.alpha_composite(grad, (0, 0))
            # 立体高光：左上椭圆柔光 + 顶部内描边
            glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            dg = ImageDraw.Draw(glow)
            dg.ellipse([7 * S, 4 * S, int(W * 0.62), int(BH * 0.55)],
                       fill=(255, 255, 255, 90))
            glow = glow.filter(ImageFilter.GaussianBlur(7 * S))
            glow.putalpha(ImageChops.multiply(glow.getchannel("A"), mask))
            layer.alpha_composite(glow)
            hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            dh = ImageDraw.Draw(hi)
            dh.rounded_rectangle([2 * S, 2 * S, W - 2 * S, BH - 2 * S],
                                 radius=25 * S, outline=(255, 255, 255, 210), width=2 * S)
            dh.rounded_rectangle([5 * S, 5 * S, W - 5 * S, BH - 5 * S],
                                 radius=22 * S, outline=(255, 246, 235, 120), width=S)
            hi.putalpha(ImageChops.multiply(hi.getchannel("A"), mask))
            layer.alpha_composite(hi)
            # 蜜桃描边：只贴在轮廓外侧，不覆盖主体
            edge = ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(2 * S + 1)), mask)
            rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            rim.paste((232, 190, 158, 235), (0, 0), edge)
            layer.alpha_composite(rim)

        small_img = layer.resize((w, h), Image.Resampling.LANCZOS)
        img = self._alpha_to_key(small_img)

        if text is not None:
            try:
                font = ImageFont.truetype(BUBBLE_FONT, font_size)
            except Exception:
                font = ImageFont.load_default()
            ImageDraw.Draw(img).text((w // 2, h // 2 - 2), text, font=font,
                                     fill=(91, 68, 54), anchor="mm")
        return img

    def _chat_bubble_photo(self, w=None, h=None):
        """聊天输入条：液态玻璃胶囊 + 星芒 + 麦克风 + 发送键。"""
        w = w or CHAT_W
        h = h or CHAT_H
        key = ("chatbar", w, h)
        if key in self._bubble_cache:
            return self._bubble_cache[key]
        img = self._chat_bar_image(w, h)
        photo = ImageTk.PhotoImage(img)
        self._bubble_cache[key] = (photo, w, h)
        return self._bubble_cache[key]

    def _chat_bar_image(self, w=None, h=None):
        """生成输入条 PIL 图；图案一律在 4 倍画布画完再缩放。"""
        w = w or CHAT_W
        h = h or CHAT_H

        def extra(d, S, W, H, mask):
            # 输入区做成玻璃里的一块内凹磨砂槽，文字框填同色就不会露出直角色块
            d.rounded_rectangle([34 * S, 10 * S, 300 * S, 48 * S], radius=18 * S,
                                fill=(39, 38, 45, 255),
                                outline=(255, 255, 255, 24), width=S)
            d.line([(52 * S, 11 * S), (282 * S, 11 * S)],
                   fill=(0, 0, 0, 64), width=S)
            # 左端星芒：给纯文字入口一点"液态"的装饰
            cx, cy = 26 * S, (h // 2) * S
            r1, r2 = 7 * S, int(1.8 * S)
            d.polygon([(cx, cy - r1), (cx + r2, cy - r2), (cx + r1, cy),
                       (cx + r2, cy + r2), (cx, cy + r1), (cx - r2, cy + r2),
                       (cx - r1, cy), (cx - r2, cy - r2)],
                      fill=(255, 247, 232, 180))
            # 与输入区之间的细分隔线
            dx = (w - 122) * S
            d.line([(dx, 16 * S), (dx, (h - 16) * S)],
                   fill=(255, 255, 255, 34), width=S)
            # 麦克风按钮：玻璃圆底 + 话筒
            mx, my = (w - 84) * S, (h // 2) * S
            d.ellipse([mx - 17 * S, my - 17 * S, mx + 17 * S, my + 17 * S],
                      fill=(255, 255, 255, 20), outline=(255, 255, 255, 46),
                      width=S)
            mic = (226, 222, 226, 238)
            d.rounded_rectangle([mx - 4 * S, my - 10 * S, mx + 4 * S, my + 1 * S],
                                radius=4 * S, outline=mic, width=int(1.8 * S))
            d.arc([mx - 8 * S, my - 6 * S, mx + 8 * S, my + 9 * S],
                  start=0, end=180, fill=mic, width=int(1.8 * S))
            d.line([(mx, my + 9 * S), (mx, my + 13 * S)], fill=mic,
                   width=int(1.8 * S))
            d.line([(mx - 5 * S, my + 13 * S), (mx + 5 * S, my + 13 * S)],
                   fill=mic, width=int(1.8 * S))
            # 发送键：青苹果绿圆 + 向上箭头
            sx, sy = (w - 36) * S, (h // 2) * S
            d.ellipse([sx - 17 * S, sy - 17 * S, sx + 17 * S, sy + 17 * S],
                      fill=(163, 212, 158, 255))
            d.ellipse([sx - 14 * S, sy - 14 * S, sx + 14 * S, sy + 4 * S],
                      fill=(196, 235, 190, 58))
            d.ellipse([sx - 17 * S, sy - 17 * S, sx + 17 * S, sy + 17 * S],
                      outline=(214, 242, 210, 150), width=S)
            arrow = (250, 255, 248, 255)
            d.line([(sx, sy + 8 * S), (sx, sy - 9 * S)], fill=arrow,
                   width=int(2.8 * S))
            d.line([(sx - 6 * S, sy - 3 * S), (sx, sy - 9 * S),
                    (sx + 6 * S, sy - 3 * S)], fill=arrow,
                   width=int(2.8 * S), joint="curve")

        return self._glass_pill(w, h, 29, extra)

    def _bubble_photo(self, text, small=False):
        """回复气泡：奶白 3D 膨胀气泡，带连体尖角。"""
        key = ("say", str(text), small)
        if key in self._bubble_cache:
            return self._bubble_cache[key]
        size = 16 if small else 17
        try:
            font = ImageFont.truetype(BUBBLE_FONT, size)
        except Exception:
            font = ImageFont.load_default()
        maxw = 130 if small else BUBBLE_MAX_W
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
        lh = size + 8
        pad = 14 if small else 18
        tail = 14
        tw = max(font.getlength(l) for l in lines)
        w = int(tw + pad * 2) + 4
        body_h = int(lh * len(lines) + pad * 2)
        h = body_h + tail
        # 只生成无字底图；文字按行排版，避免单行居中把多行挤在一起
        img = self._puffy_bubble(w, h, dark=False)
        d = ImageDraw.Draw(img)
        y = pad - 1
        for line in lines:
            d.text(((w - font.getlength(line)) / 2, y), line, font=font, fill=(91, 68, 54))
            y += lh
        photo = ImageTk.PhotoImage(img)
        self._bubble_cache[key] = (photo, w, h)
        return self._bubble_cache[key]

    def _work_area(self):
        """桌面可用区域（不含任务栏），避免输入条压到任务栏上。"""
        r = wintypes.RECT()
        try:
            if user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0):
                if r.right - r.left > 200 and r.bottom - r.top > 200:
                    return r.left, r.top, r.right, r.bottom
        except Exception:
            pass
        sw, sh = screen_size()
        return 0, 0, sw, sh

    def _make_room_for_chat(self):
        """角色贴底时向上让一点，给正下方的输入条腾出位置（最多让 64px）。"""
        _, _, _, wy1 = self._work_area()
        bx0, by0, bx1, by1 = self._body_box()
        need_bottom = self.pet_y + by1 + 10 + CHAT_H + 6
        if need_bottom <= wy1:
            return
        new_y = wy1 - (by1 + 10 + CHAT_H + 6)
        if self.pet_y - new_y <= 64 and new_y >= 0:
            self._move_to(self.pet_x, int(new_y))

    def _chat_bar_xy(self, sw=None, sh=None, work=None):
        """输入条坐标：居中贴在角色正下方；下方放不下才翻到头顶。

        纯计算，便于自测。`work` 为 (左, 上, 右, 下) 可用区域。
        """
        if sw is None or sh is None:
            sw, sh = screen_size()
        if work is None:
            work = self._work_area()
        wx0, wy0, wx1, wy1 = work
        w, h = CHAT_W, CHAT_H
        bx0, by0, bx1, by1 = self._body_box()
        cx = self.pet_x + (bx0 + bx1) // 2
        x = cx - w // 2
        # 正下方，贴着角色脚边
        y = self.pet_y + by1 + 10
        if y + h > wy1 - 6:
            # 下方没空间：翻到头顶上方（状态栏会再往上让位）
            y = self.pet_y + by0 - h - 10
        x = max(wx0 + 6, min(wx1 - w - 6, x))
        y = max(wy0 + 6, min(wy1 - h - 6, y))
        # 极端窄屏兜底
        x = max(6, min(sw - w - 6, x))
        y = max(6, min(sh - h - 6, y))
        return x, y, w, h

    def _place_chat_bubble(self):
        """输入条贴着角色，宠物走动/拖拽时一路跟着。"""
        win = self._chat_win
        if win is None or not win.winfo_exists():
            return
        x, y, w, h = self._chat_bar_xy()
        win.geometry("%dx%d+%d+%d" % (w, h, x, y))

    def _show_bubble(self, text, small=False, dy=0, hold=2600):
        photo, w, h = self._bubble_photo(text, small)
        self._bub_size = (w, h)
        self.bub_label.configure(image=photo)
        self.bub_label.image = photo
        sw, sh = screen_size()
        bx0, by0, bx1, by1 = self._body_box()
        bx = max(0, min(sw - w, self.pet_x + (bx0 + bx1) // 2 - w // 2))
        by = max(0, min(sh - h, self.pet_y + by0 - h + 6 + dy))
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

    # ---------- 液态玻璃：悬停工具条 / 聊天输入条 ----------
    def _glass_pill(self, w, h, radius, extra=None, keyed=True, sky=1.0, tone=1.0):
        """画一枚液态玻璃胶囊：冷色折射 + 顶部高光 + 双层高光边 + 磨砂颗粒。

        4 倍超采样后统一缩回目标尺寸，再硬阈值抠成 KEY。所有图标也必须
        在超采样阶段画完——先缩图再画 1px 线条会断线、缺角。
        keyed=False 时返回 RGBA（菜单要先把文字合成上去再统一抠图）。
        sky 控制天光/折射强度，tone 控制体色深浅：大面积菜单需要更暗更收的光。
        """
        S = 4
        W, H = w * S, h * S
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, W - 1, H - 1], radius=radius * S, fill=255)

        # 玻璃主体：顶端略亮、中段稳定、底端压暗，像有厚度的实心玻璃
        top = tuple(int(c * tone) for c in (76, 74, 88))
        mid = tuple(int(c * tone) for c in (46, 45, 53))
        bot = tuple(int(c * tone) for c in (27, 27, 34))
        body = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        bd = ImageDraw.Draw(body)
        for yy in range(H):
            t = yy / max(1, H - 1)
            if t < 0.24:
                k = t / 0.24
                c = tuple(int(top[i] + (mid[i] - top[i]) * k) for i in range(3))
            elif t > 0.82:
                k = (t - 0.82) / 0.18
                c = tuple(int(mid[i] + (bot[i] - mid[i]) * k) for i in range(3))
            else:
                c = mid
            bd.line([(0, yy), (W, yy)], fill=c + (236,))
        body.putalpha(ImageChops.multiply(body.getchannel("A"), mask))
        layer.alpha_composite(body)

        # 折射色带：只压在两端的弧面上，中段留给输入框，避免出现色块接缝
        tint = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        td = ImageDraw.Draw(tint)
        td.ellipse([int(-0.26 * W), int(-0.55 * H), int(0.17 * W), int(0.95 * H)],
                   fill=(150, 206, 238, int(46 * sky)))
        td.ellipse([int(0.80 * W), int(0.05 * H), int(1.16 * W), int(1.30 * H)],
                   fill=(244, 190, 168, int(34 * sky)))
        tint = tint.filter(ImageFilter.GaussianBlur(int(8 * S)))
        tint.putalpha(ImageChops.multiply(tint.getchannel("A"), mask))
        layer.alpha_composite(tint)

        # 顶部天光：一条被压扁的柔光，做出"鼓起来"的液面
        spec = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(spec).ellipse(
            [int(0.06 * W), int(-0.36 * H), int(0.94 * W), int(0.24 * H)],
            fill=(255, 255, 255, int(62 * sky)))
        spec = spec.filter(ImageFilter.GaussianBlur(int(4 * S)))
        spec.putalpha(ImageChops.multiply(spec.getchannel("A"), mask))
        layer.alpha_composite(spec)

        # 底部内阴影：让下沿有收进去的体积感
        low = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(low).rounded_rectangle(
            [2 * S, int(0.84 * H), W - 2 * S, H - 2 * S],
            radius=max(2, radius - 2) * S, outline=(0, 0, 0, 62), width=int(2 * S))
        low = low.filter(ImageFilter.GaussianBlur(int(3 * S)))
        low.putalpha(ImageChops.multiply(low.getchannel("A"), mask))
        layer.alpha_composite(low)

        # 内外两道高光边：外沿亮、内沿细，是玻璃最关键的"边"
        rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        rd = ImageDraw.Draw(rim)
        rd.rounded_rectangle([S, S, W - 1 - S, H - 1 - S],
                             radius=max(2, radius - 1) * S,
                             outline=(255, 255, 255, 92), width=int(1.3 * S))
        rd.rounded_rectangle([2 * S, 2 * S, W - 1 - 2 * S, H - 1 - 2 * S],
                             radius=max(2, radius - 2) * S,
                             outline=(255, 255, 255, 36), width=S)
        rim.putalpha(ImageChops.multiply(rim.getchannel("A"), mask))
        layer.alpha_composite(rim)

        # 磨砂颗粒：极轻的一层噪点，远看是雾面，近看有质感
        noise = Image.effect_noise((W, H), 26)
        frost = Image.new("RGBA", (W, H), (255, 255, 255, 0))
        frost.putalpha(noise.point(lambda v: int(abs(v - 128) * 0.10)))
        frost.putalpha(ImageChops.multiply(frost.getchannel("A"), mask))
        layer.alpha_composite(frost)

        if extra is not None:
            # 必须单独画在透明层再 alpha_composite：
            # ImageDraw 往 RGBA 上画是"覆盖"而不是"混合"，
            # 半透明白会直接把玻璃打穿成透明洞。
            ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            extra(ImageDraw.Draw(ov), S, W, H, mask)
            ov.putalpha(ImageChops.multiply(ov.getchannel("A"), mask))
            layer.alpha_composite(ov)

        img = layer.resize((w, h), Image.Resampling.LANCZOS)
        return self._alpha_to_key(img) if keyed else img

    def _hover_image(self, hot=-1):
        """生成悬停工具条的 PIL 图（便于离线预览与自测）。"""
        w, h = HOVER_W, HOVER_H

        def extra(d, S, W, H, mask):
            icon = (250, 248, 246, 240)
            for i, x0 in enumerate((8, 62)):
                on = (i == hot)
                d.rounded_rectangle(
                    [x0 * S, 8 * S, (x0 + 42) * S, 42 * S], radius=15 * S,
                    fill=(255, 255, 255, 88) if on else (255, 255, 255, 24),
                    outline=(255, 255, 255, 190) if on else (255, 255, 255, 58),
                    width=int(1.2 * S))
                if on:
                    d.rounded_rectangle(
                        [x0 * S + S, 9 * S, (x0 + 42) * S - S, 41 * S],
                        radius=14 * S, outline=(255, 255, 255, 40), width=S)
            lw = int(2.1 * S)
            # 房子：屋顶 + 屋身 + 门
            hx, hy = 29 * S, 25 * S
            d.line([(hx - 8 * S, hy - 1 * S), (hx, hy - 8 * S), (hx + 8 * S, hy - 1 * S)],
                   fill=icon, width=lw, joint="curve")
            d.line([(hx - 5 * S, hy - 2 * S), (hx - 5 * S, hy + 7 * S),
                    (hx + 5 * S, hy + 7 * S), (hx + 5 * S, hy - 2 * S)],
                   fill=icon, width=lw, joint="curve")
            d.line([(hx - 1 * S, hy + 7 * S), (hx - 1 * S, hy + 2 * S),
                    (hx + 2 * S, hy + 2 * S), (hx + 2 * S, hy + 7 * S)],
                   fill=icon, width=int(1.5 * S), joint="curve")
            # 对话气泡：圆角框 + 小尾巴 + 三个点
            bx, by = 83 * S, 25 * S
            d.rounded_rectangle([bx - 8 * S, by - 7 * S, bx + 8 * S, by + 4 * S],
                                radius=4 * S, outline=icon, width=lw)
            d.polygon([(bx - 4 * S, by + 4 * S), (bx - 7 * S, by + 8 * S),
                       (bx + 1 * S, by + 4 * S)], fill=icon)
            for dx in (-4, 0, 4):
                d.ellipse([bx + (dx - 1) * S, by - 2 * S,
                           bx + (dx + 1) * S, by], fill=icon)

        return self._glass_pill(w, h, 25, extra)

    def _hover_photo(self, hot=-1):
        """两颗玻璃按钮（房子 / 对话），只有图标没有文字。"""
        key = ("hoverbar", hot)
        if key in self._bubble_cache:
            return self._bubble_cache[key]
        img = self._hover_image(hot)
        photo = ImageTk.PhotoImage(img)
        self._bubble_cache[key] = (photo, HOVER_W, HOVER_H)
        return self._bubble_cache[key]

    def _ensure_hover_bar(self):
        if self._hover_win is not None and self._hover_win.winfo_exists():
            return
        win = tk.Toplevel(self.root)
        self._hover_win = win
        win.withdraw()
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.attributes("-transparentcolor", KEY)
        win.resizable(False, False)
        win.configure(bg=KEY)
        photo, w, h = self._hover_photo()
        win.geometry("%dx%d+0+0" % (w, h))
        lab = tk.Label(win, image=photo, bg=KEY, bd=0, highlightthickness=0,
                       cursor="hand2")
        lab.image = photo
        lab.pack()
        lab.bind("<Button-1>", self._on_hover_click)
        self._hover_label = lab

    def _hover_bar_xy(self, sw=None, sh=None):
        """状态条基准位置：水平严格居中在角色身体正上方。纯计算，便于自测。"""
        if sw is None or sh is None:
            sw, sh = screen_size()
        w, h = HOVER_W, HOVER_H
        bx0, by0, bx1, by1 = self._body_box()
        cx = self.pet_x + (bx0 + bx1) // 2
        # 严格居中：不偏左也不偏右，与角色、输入条共用同一根中轴
        x = max(6, min(sw - w - 6, cx - w // 2))
        y = self.pet_y + by0 - h - 6
        if y < 6:
            y = self.pet_y + self.W + 6
        y = max(6, min(sh - h - 6, y))
        return x, y, w, h

    def _place_hover_bar(self):
        win = self._hover_win
        if win is None or not win.winfo_exists():
            return
        # withdraw 时 winfo_width() 可能是 1，必须用设计尺寸
        sw, sh = screen_size()
        x, y, w, h = self._hover_bar_xy(sw, sh)

        # 回复气泡正在显示时，把状态条抬到气泡上方，保持"从上到下"的竖直秩序
        if self.bub.state() != "withdrawn" and self._bub_size:
            bw, bh = self._bub_size
            bxx, byy = self.bub.winfo_x(), self.bub.winfo_y()
            if not (y + h <= byy or y >= byy + bh):
                if not (x + w <= bxx or x >= bxx + bw):
                    above = byy - h - 8
                    if above >= 6:
                        y = above
                    else:
                        left = bxx - w - 8
                        right = bxx + bw + 8
                        if left >= 6:
                            x = left
                        elif right + w <= sw - 6:
                            x = right
        # 角色贴屏幕底部时输入条会翻到头顶，状态条再往上让位
        if self._chat_win is not None and self._chat_win.winfo_exists():
            cxx, cyy = self._chat_win.winfo_x(), self._chat_win.winfo_y()
            if not (y + h <= cyy or y >= cyy + CHAT_H) and \
                    not (x + w <= cxx or x >= cxx + CHAT_W):
                y = max(6, cyy - h - 6)
        win.geometry("%dx%d+%d+%d" % (w, h, x, y))

    def _hover_contains(self, mx, my):
        win = self._hover_win
        if win is None or not self._hover_visible or not win.winfo_exists():
            return False
        x, y = win.winfo_x(), win.winfo_y()
        return x <= mx <= x + HOVER_W and y <= my <= y + HOVER_H

    def _update_hover_hot(self, mx, my):
        """鼠标落在哪个按钮上，就点亮哪一颗（玻璃高亮）。"""
        win = self._hover_win
        if win is None or not win.winfo_exists():
            return
        lx = mx - win.winfo_x()
        ly = my - win.winfo_y()
        hot = -1
        if 0 <= ly <= HOVER_H:
            if 6 <= lx <= 56:
                hot = 0
            elif 58 <= lx <= 106:
                hot = 1
        if hot == self._hover_hot:
            return
        self._hover_hot = hot
        photo, w, h = self._hover_photo(hot)
        if self._hover_label is not None:
            self._hover_label.configure(image=photo)
            self._hover_label.image = photo

    def _cancel_hover_hide(self):
        if self._hover_hide_job:
            try:
                self.root.after_cancel(self._hover_hide_job)
            except Exception:
                pass
            self._hover_hide_job = None

    def _show_hover_bar(self):
        if self.dragging or time.time() < self._hover_suppress_until:
            return
        if self._menu_stack:            # 右键菜单开着就别再压一条状态条上去
            return
        # 聊天输入条打开时也照常显示：鼠标回到角色身上就该出现
        self._ensure_hover_bar()
        self._cancel_hover_hide()
        self._place_hover_bar()
        if not self._hover_visible:
            self._hover_win.deiconify()
            self._hover_win.lift()
            self._hover_visible = True

    def _hide_hover_bar(self):
        self._hover_hide_job = None
        if not self._hover_visible:
            return
        self._hover_visible = False
        self._hover_hot = -1
        if self._hover_label is not None:
            photo, _, _ = self._hover_photo(-1)
            self._hover_label.configure(image=photo)
            self._hover_label.image = photo
        self._hover_win.withdraw()

    def _on_hover_click(self, event):
        # 窗口尺寸就是设计稿（1:1），直接用控件坐标；
        # 刚 deiconify 时 winfo_width() 可能还是 1，按比例换算会把点击算飞。
        self._ui_press = True          # 这一下点的是自己的 UI，不算桌面点击
        self._chat_guard = time.time() + 0.6
        x = event.x
        if 6 <= x <= 56:
            self._hide_hover_bar()
            self._open_home()
        elif 58 <= x <= 106:
            self._hide_hover_bar()
            self._open_chat()

    # ---------- 聊聊天：深色胶囊输入条 + 上下文回复 ----------
    def _open_chat(self):
        if self._chat_win is not None and self._chat_win.winfo_exists():
            self._chat_win.lift()
            self._chat_entry.focus_set()
            return
        self._hide_hover_bar()

        W, H = CHAT_W, CHAT_H
        win = tk.Toplevel(self.root)
        self._chat_win = win
        win.withdraw()
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.attributes("-transparentcolor", KEY)
        win.resizable(False, False)
        win.configure(bg=KEY)

        photo, _, _ = self._chat_bubble_photo(W, H)
        bg = tk.Label(win, image=photo, bg=KEY, bd=0, highlightthickness=0)
        bg.image = photo
        bg.place(x=0, y=0)
        bg.bind("<Button-1>", self._on_chat_bar_click)

        placeholder = "想做什么事，直接跟我说"
        entry = tk.Entry(win, font=("Microsoft YaHei", 11), bg="#27262D",
                         fg="#A6A1A6", relief="flat", highlightthickness=0,
                         insertbackground="#F4F0EC")
        entry.insert(0, placeholder)
        entry.place(x=46, y=14, width=246, height=30)
        entry.bind("<Return>", lambda e: self._send_chat())
        entry.bind("<FocusIn>", lambda e: self._chat_focus_in())
        entry.bind("<FocusOut>", lambda e: self._chat_focus_out())
        entry.bind("<Escape>", lambda e: self._close_chat())
        self._chat_placeholder = placeholder
        self._chat_entry = entry

        win.geometry("%dx%d+0+0" % (W, H))
        win.update_idletasks()
        # 贴着屏幕底部时先把角色往上让一点，输入条才能真的落在正下方
        self._make_room_for_chat()
        self._place_chat_bubble()
        self._chat_guard = time.time() + 0.6      # 保护期：这次按下不算"点别处"
        win.deiconify()
        win.lift()
        entry.focus_set()
        entry.icursor("end")

    def _chat_focus_in(self):
        e = self._chat_entry
        if e is not None and e.get() == self._chat_placeholder:
            e.delete(0, "end")
            e.configure(fg="#F1EDE9")

    def _chat_focus_out(self):
        e = self._chat_entry
        if e is not None and not e.get().strip():
            e.insert(0, self._chat_placeholder)
            e.configure(fg="#A6A1A6")

    def _on_chat_bar_click(self, event):
        x = event.x
        if x >= 378:                 # 发送箭头
            self._send_chat()
        elif x >= 326:               # 麦克风 = 语音朗读开关
            self._toggle_voice()
        else:
            self._chat_entry.focus_set()

    def _chat_contains(self, mx, my):
        win = self._chat_win
        if win is None or not win.winfo_exists():
            return False
        x, y = win.winfo_x(), win.winfo_y()
        return x <= mx <= x + win.winfo_width() and y <= my <= y + win.winfo_height()

    def _toggle_voice(self):
        if self._voice:
            self._voice.enabled = not self._voice.enabled
            self._show_bubble("语音朗读打开了～" if self._voice.enabled
                              else "语音朗读先关掉啦。", small=True, hold=1800)

    def _close_chat(self):
        if self._chat_win is not None:
            try:
                self._chat_win.destroy()
            except Exception:
                pass
        self._chat_win = None
        self._chat_busy = False

    def _save_emotion(self):
        """P0：把情绪状态写回配置，供下次启动衰减。"""
        for k, v in self.emotion.items():
            self.cfg[k] = v
        save_config(self.cfg)

    def _send_chat(self):
        if self._chat_entry is None or self._chat_busy:
            return
        text = self._chat_entry.get().strip()
        if not text or text == self._chat_placeholder:
            return
        self._chat_entry.delete(0, "end")
        self._chat_entry.configure(fg="#A6A1A6")
        # P2 有 active 引导时，任何新输入都打断引导（用户优先）
        if self._support_steps:
            self._stop_support()
        self._chat_busy = True
        self._chat_seq += 1
        seq = self._chat_seq
        # 思考中：先给一个短暂的小气泡，真实回复回来后替换
        self._show_bubble("（认真听着…）", small=True, hold=0)
        # 本地上下文引擎 / 可选大模型都在后台线程跑，不卡桌面
        def worker():
            try:
                result = self._dialogue.reply(
                    text, self.pet_name, self.user_name, self.emotion, self.cfg)
            except Exception:
                result = {"reply": "（眨了眨眼）\n我还在想，先等我一小会儿。",
                          "new_name": None, "delta": (0, 0), "rid": "fallback",
                          "support": None, "source": "local"}
            self.root.after(0, lambda r=result, s=seq: self._finish_chat(r, s))

        threading.Thread(target=worker, daemon=True).start()

    def _finish_chat(self, result, seq):
        if seq != self._chat_seq:
            return
        self._chat_busy = False
        new_name = result.get("new_name")
        if new_name:
            self.user_name = new_name
            self.cfg["user_name"] = new_name
        self.emotion = pet_chat.emotion_apply(self.emotion, result.get("delta"))
        self._save_emotion()
        # 回复回到宠物身边的大气泡，不再留在输入框里
        self._say_voice(result.get("reply") or "我在听呢。")
        rid = result.get("rid")
        if rid == "crisis":
            self.root.after(300, self._show_crisis_resources)
        kind = result.get("support")
        if kind and rid != "crisis":
            self.root.after(2200, lambda k=kind: self._start_support(k))

    # ---------- P2 舒缓引导：逐句气泡 + 语音，可打断 ----------
    def _start_support(self, kind):
        steps = pet_chat.SUPPORT_STEPS.get(kind)
        if not steps:
            return
        self._stop_support()
        self._support_seq += 1
        self._support_steps = steps
        self._support_i = 0
        self._support_emit()

    def _support_emit(self):
        if not self._support_steps or self._support_i >= len(self._support_steps):
            self._stop_support()
            return
        step = self._support_steps[self._support_i]
        self._say_voice(step)
        self._support_i += 1
        if self._support_i < len(self._support_steps):
            self._support_job = self.root.after(SUPPORT_STEP_MS, self._support_emit)
        else:
            self._support_job = None
            self.root.after(SUPPORT_STEP_MS, self._stop_support)

    def _stop_support(self):
        if self._support_job:
            try:
                self.root.after_cancel(self._support_job)
            except Exception:
                pass
            self._support_job = None
        self._support_steps = None
        self._support_i = 0

    # ---------- P3 危机资源：一次性提示卡 ----------
    def _show_crisis_resources(self):
        win = tk.Toplevel(self.root)
        win.title("找人聊聊")
        win.attributes("-topmost", True)
        win.resizable(False, False)
        win.configure(bg="#FFF7EC")
        tk.Label(win, text="这些话，值得跟真人说说", bg="#FFF7EC", fg="#5A4632",
                 font=("Microsoft YaHei", 12, "bold")).pack(padx=16, pady=(14, 6), anchor="w")
        info = ("全国心理援助热线：12356（24 小时）\n"
                "北京心理危机研究与干预中心：010-82951332\n"
                "紧急情况请拨打 110 / 120\n\n"
                "我是一只桌宠，不是专业帮助。\n你值得被真人认真听见。")
        tk.Label(win, text=info, bg="#FFF7EC", fg="#7A6A58",
                 font=("Microsoft YaHei", 10), justify="left").pack(padx=16, pady=(0, 8), anchor="w")
        tk.Button(win, text="知道了", command=win.destroy,
                  font=("Microsoft YaHei", 10), bg="#F3B7A0", fg="white",
                  relief="flat", padx=18).pack(pady=(0, 14))
        win.update_idletasks()
        x = max(0, min(screen_size()[0] - win.winfo_width(), self.pet_x - 40))
        y = max(0, min(screen_size()[1] - win.winfo_height(), self.pet_y + self.W + 10))
        win.geometry("+%d+%d" % (x, y))

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
            bx0, by0, bx1, by1 = self._body_box()
            bx = max(0, min(sw - w, x + (bx0 + bx1) // 2 - w // 2))
            by = max(0, min(sh - h, y + by0 - h + 6))
            self.bub.geometry("%dx%d+%d+%d" % (w, h, bx, by))
        if self._hover_visible:
            self._place_hover_bar()

    # ---------- 鼠标轮询 ----------
    def _poll_mouse(self):
        p = _POINT()
        user32.GetCursorPos(ctypes.byref(p))
        mx, my = p.x, p.y
        self._last_mouse = (mx, my)
        # 悬停状态条：鼠标在宠物身上时出现，移开后收起
        on_pet = self._hit_body(mx, my)
        hover_hit = self._hover_contains(mx, my)
        if on_pet or hover_hit:
            self._cancel_hover_hide()
            self._show_hover_bar()
            if hover_hit:
                self._update_hover_hot(mx, my)
        elif self._hover_visible and self._hover_hide_job is None:
            # 只排一次收起任务；每帧重排会把定时器一直往后推，永远收不起来
            self._hover_hide_job = self.root.after(160, self._hide_hover_bar)
        lbtn = bool(user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)
        rbtn = bool(user32.GetAsyncKeyState(VK_RBUTTON) & 0x8000)
        on_menu = self._menu_contains(mx, my)
        # 玻璃菜单：点外面 / 按 Esc 收起；这一下点击同时吞掉，避免顺带把宠物叫走
        if self._menu_stack:
            esc = bool(user32.GetAsyncKeyState(0x1B) & 0x8000)
            if esc or (lbtn and not self._prev_lbtn and not on_menu):
                self._close_menu()
                self._ui_press = True
            else:
                self._menu_track(mx, my)     # 悬停高亮 + 级联子菜单（轮询，非 Motion）
        on_ui = self._hover_contains(mx, my) or self._chat_contains(mx, my) or on_menu
        # 输入条只在点了"对话"之后才存在；点桌面空白就收起，平时保持干净。
        # 刚打开的那一下不能算"点别处"（同一次按下会先开窗再被判成外部点击）。
        if (lbtn and not self._prev_lbtn and self._chat_win is not None
                and self._chat_win.winfo_exists() and not on_ui
                and not self._ui_press and time.time() >= self._chat_guard):
            self._close_chat()
        if on_ui or self._ui_press:
            if lbtn and not self._prev_lbtn:
                self._ui_press = True
            if not lbtn:
                self._ui_press = False
            self._prev_lbtn, self._prev_rbtn = lbtn, rbtn
            return
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
        # 聊天气泡跟随宠物移动（拖拽/走路/飞行时都贴着）
        if self._chat_win is not None and self._chat_win.winfo_exists():
            self._place_chat_bubble()
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
        self._stop_support()
        if self._voice:
            self._voice.shutdown()
        self._close_chat()
        self._save_emotion()
        self.root.destroy()


if __name__ == "__main__":
    PetApp()
