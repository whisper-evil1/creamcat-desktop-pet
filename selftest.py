# -*- coding: utf-8 -*-
"""无 GUI 逻辑自检：长按拖拽 / 休眠唤醒 / 双击空白 / 高度分级 / 降落伞 / 单形态。"""
import json
import os
import sys
import time
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pet_app as P
from PIL import Image

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print("[%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))


def fake(**kw):
    o = types.SimpleNamespace(**kw)
    for m in ("_hit_body", "_note_interact", "_start_drag", "_on_double_down",
              "_on_up", "_plan_walk", "_advance_parachute", "_snap_to_edge",
              "_own_rects", "_body_box", "_bounds", "_clamp", "_snap", "destroy"):
        setattr(o, m, types.MethodType(getattr(P.PetApp, m), o))
    o._body_box_cache = (79, 110, 280, 360)   # 与真实 idle 帧一致的内容框
    o.W = 360                                  # 画布边长（缩放前的基准）
    o.state = "idle"
    o.frame = 0
    o.dragging = False
    o.walk_target = None
    o.drag_start_y = None
    o.pet_x, o.pet_y = 1000, 1000
    o.last_interact = time.time()
    o.drag_off = (0, 0)
    o.bubble_job = None
    o._pressing = False
    o._press_t = 0.0
    o._press_pos = (1000, 1200)
    o._press_on_body = False
    o._long_press_fired = False
    o._last_down_t = 0.0
    o._last_down_pos = (0, 0)
    o._click_chain = 0
    o._para_deploy_until = 0.0
    o.parachute_target = None
    o.states = []
    o._set_state = lambda s: o.states.append(s)
    return o

# ---------- 1) 单击 vs 双击（桌面空白走动） ----------
o = fake()
o._on_double_down = lambda x, y: o.states.append("DOUBLE")
o._hit_body = lambda x, y: False   # 桌面空白

def simulate_down(o, x, y, t):
    dx, dy = x - o._last_down_pos[0], y - o._last_down_pos[1]
    near = (dx * dx + dy * dy) ** 0.5 <= P.DOUBLE_DIST
    if t - o._last_down_t <= P.DOUBLE_GAP and near and o._click_chain >= 1:
        o._click_chain = 0
        o._on_double_down(x, y)
    else:
        o._click_chain = 1
    o._last_down_t, o._last_down_pos = t, (x, y)

simulate_down(o, 100, 100, 1.0)
check("单击空白不触发走动", "DOUBLE" not in o.states)
simulate_down(o, 110, 105, 1.2)
check("双击空白触发走动", o.states.count("DOUBLE") == 1)
simulate_down(o, 110, 105, 3.0)
check("超时点击不触发", o.states.count("DOUBLE") == 1)

# ---------- 2) 休眠态双击无效 ----------
o = fake()
o.state = "sleep"
o._hit_body = lambda x, y: False
o._plan_walk = lambda: o.states.append("WALK")
o._on_double_down(100, 100)      # 休眠态双击空白
check("休眠态双击空白无效", o.walk_target is None and "WALK" not in o.states)

# ---------- 3) 休眠态单击唤醒 / 清醒态单击无反应 ----------
o = fake()
o.state = "sleep"
o._hit_body = lambda x, y: True
o._pressing = True
o._press_t = time.time()
o._press_on_body = True
o._on_up(1000, 1000)             # 休眠态短按宠物
check("休眠态单击唤醒", o.states[-1] == "idle", "states=%s" % o.states)

o = fake()
o.state = "idle"
o._hit_body = lambda x, y: True
o._pressing = True
o._press_t = time.time()
o._press_on_body = True
o._on_up(1000, 1000)             # 清醒态短按宠物
check("清醒态单击无反应", len(o.states) == 0, "states=%s" % o.states)

# ---------- 4) 长按触发拖拽（无需双击） ----------
o = fake()
o.state = "idle"
o._hit_body = lambda x, y: True
o._pressing = True
o._press_t = time.time() - (P.LONG_PRESS_SEC + 0.1)
o._press_on_body = True
o._long_press_fired = False
# 复刻 _poll_mouse 长按分支
if (o._pressing and o._press_on_body and not o._long_press_fired
        and not o.dragging and time.time() - o._press_t >= P.LONG_PRESS_SEC):
    o._long_press_fired = True
    o._start_drag(*o._press_pos)
check("长按宠物触发拖拽", o.dragging and "drag" in o.states, "states=%s" % o.states)

# ---------- 5) 高度分级：高处展翅 / 同水平跑步 ----------
o = fake()
o.pet_y = 1000
o.walk_target = (1200, 900)
o._plan_walk()
check("高处目标展翅飞", o.states[-1] == "fly", "state=%s" % o.states)

o = fake()
o.pet_y = 1000
o.walk_target = (1200, 1280)
o._plan_walk()
check("同水平线侧面跑步", o.states[-1] == "walk", "state=%s" % o.states)

o = fake()
o.pet_y = 600
o.walk_target = (1200, 1300)
o._plan_walk()
check("下方目标改开降落伞", o.states[-1] == "parachute" and o.parachute_target == (1200, 1300),
      "state=%s target=%s" % (o.states, o.parachute_target))

o = fake()
o.pet_y = 1000
o.walk_target = (800, 900)
o._plan_walk()
check("左侧目标镜像 fly_left", o.states[-1] == "fly_left", "state=%s" % o.states)

# ---------- 6) 降落伞：上抛松手 -> 先张开再飘落 -> idle ----------
o = fake()
o.pet_y = 600
o.drag_start_y = 1000
o.dragging = True
o._on_up(1000, 600)
check("上抛松手撑降落伞", "parachute" in o.states, "states=%s" % o.states)
check("降落伞先播放张开动画", o._para_deploy_until > 0, "until=%.2f" % o._para_deploy_until)

P.screen_size = lambda: (2560, 1600)
o = fake()
o.state = "parachute"
o.pet_y = 900
o._para_deploy_until = 0.0   # 张开完成，开始下降
o._move_to = lambda x, y: setattr(o, "pet_y", y)
o._say = lambda s: None
o.lines = ["落地啦"]
o._set_state = lambda s: o.states.append(s)
for _ in range(500):
    o._advance_parachute()
    if "idle" in o.states:
        break
check("降落伞飘到地面", o.pet_y == 1600 - 360 - P.GROUND_MARGIN,
      "y=%d ground=%d" % (o.pet_y, 1600 - 360 - P.GROUND_MARGIN))
check("落地后恢复 idle", "idle" in o.states, "states=%s" % o.states)

# 张开期间不下降
o = fake()
o.state = "parachute"
o.pet_y = 900
o._para_deploy_until = time.time() + 5
o._move_to = lambda x, y: setattr(o, "pet_y", y)
o._advance_parachute()
check("张开期间暂停下降", o.pet_y == 900, "y=%d" % o.pet_y)

# ---------- 6.5) 拖到屏幕边缘：探头按"角色身体"计算（不是 360 窗口） ----------
P.screen_size = lambda: (2560, 1600)
P.window_frames = lambda skip=(): []      # 自检里不枚举真实窗口
BOX = (79, 110, 280, 360)
BW = BOX[2] - BOX[0]

o = fake()
o._move_to = lambda x, y: setattr(o, "_moved", (x, y))
o.pet_x, o.pet_y = -900, 1200
o._snap_to_edge()
vis = o._moved[0] + BOX[2]
check("左边缘探头约露半个身体", abs(vis - BW * 0.5) <= 3, "visible=%d" % vis)

o = fake()
o._move_to = lambda x, y: setattr(o, "_moved", (x, y))
o.pet_x, o.pet_y = 3000, 1200
o._snap_to_edge()
vis = 2560 - (o._moved[0] + BOX[0])
check("右边缘探头约露半个身体", abs(vis - BW * 0.5) <= 3, "visible=%d" % vis)

o = fake()
o._move_to = lambda x, y: setattr(o, "_moved", (x, y))
o.pet_x, o.pet_y = 800, -900
o._snap_to_edge()
vis = o._moved[1] + BOX[3]
check("顶部探头不会整只消失", vis > 0, "visible_h=%d" % vis)

# ---------- 6.6) 松手吸附到其他窗口的"框" ----------
P.window_frames = lambda skip=(): [(300, 500, 1500, 900)]   # 一个假窗口
o = fake()
o._move_to = lambda x, y: setattr(o, "_moved", (x, y))
o.pet_x, o.pet_y = 700, 155          # 脚底离窗口上沿 15px
o._snap_to_edge()
check("吸附站到窗口上沿", o._moved[1] == 500 - 360, "y=%d" % o._moved[1])

o = fake()
o._move_to = lambda x, y: setattr(o, "_moved", (x, y))
o.pet_x, o.pet_y = 1230, 200         # 身体右边缘离窗口右边框 10px
o._snap_to_edge()
check("吸附贴到窗口右边框", o._moved[0] + BOX[2] == 1500, "x=%d" % o._moved[0])

o = fake()
o._move_to = lambda x, y: setattr(o, "_moved", (x, y))
o.pet_x, o.pet_y = 800, 340          # 离任何框都很远
o._snap_to_edge()
check("离框远时不乱吸附", o._moved[1] == 340, "y=%d" % o._moved[1])

# ---------- 7) 闲置睡觉 + 单形态 ----------
o = fake()
o.state = "idle"
o.last_interact = time.time() - (P.IDLE_SLEEP_SEC + 5)
idle_due = (o.state in ("idle", "greet", "interact") and
            time.time() - o.last_interact >= P.IDLE_SLEEP_SEC)
check("闲置超时进入睡觉判据", idle_due, "idle_sec=%d" % P.IDLE_SLEEP_SEC)

o = fake()
o.state = "walk"
o.last_interact = time.time() - (P.IDLE_SLEEP_SEC + 5)
moving_skip = not (o.state in ("idle", "greet", "interact") and
                   time.time() - o.last_interact >= P.IDLE_SLEEP_SEC)
check("行走中不打断睡觉判据", moving_skip)

# ---------- 6.7) 每个已构建的宠物包：帧结构检查 ----------
packs = P.built_pets()
check("至少有一个可用的宠物包", len(packs) >= 1,
      "pets=%s" % [p["id"] for p in packs])
for pack in packs:
    pid = pack["id"]
    fdir = P.pet_frames(pid)
    manifest = json.load(open(os.path.join(fdir, "manifest.json"), encoding="utf-8"))
    need = ("idle", "sleep", "walk", "walk_left", "fly", "fly_left", "parachute", "drop")
    missing = [k for k in need if k not in manifest["actions"]]
    check("[%s] 动作齐全" % pid, not missing, "missing=%s" % missing)
    for st in ("idle", "sleep"):
        frames = [p for p in os.listdir(os.path.join(fdir, st)) if p.endswith(".png")]
        check("[%s] %s 单形态定格" % (pid, st), len(frames) == 1, "frames=%s" % frames)
    fly_frames = [p for p in os.listdir(os.path.join(fdir, "fly")) if p.endswith(".png")]
    chute_frames = [p for p in os.listdir(os.path.join(fdir, "parachute")) if p.endswith(".png")]
    walk_frames = [p for p in os.listdir(os.path.join(fdir, "walk")) if p.endswith(".png")]
    check("[%s] 翅膀扇动 >=4 帧" % pid, len(fly_frames) >= 4, "frames=%d" % len(fly_frames))
    check("[%s] 降落伞 5 帧（含全开停留）" % pid, len(chute_frames) == 5,
          "frames=%d" % len(chute_frames))
    check("[%s] 跑步 4 帧" % pid, len(walk_frames) == 4, "frames=%d" % len(walk_frames))
    # 左右镜像必须真的互为镜像
    mi = Image.open(os.path.join(fdir, "walk", "frame_00.png"))
    mr = Image.open(os.path.join(fdir, "walk_left", "frame_00.png"))
    check("[%s] 左右跑互为镜像" % pid,
          mi.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() == mr.tobytes())
check("配置里有当前宠物", P.load_config().get("pet") in [p["id"] for p in packs] or
      P.load_config().get("pet") is None, "pet=%s" % P.load_config().get("pet"))

# ---------- 7.5) 休眠泡泡：多个同时冒、由小到大再散掉 ----------
sizes = [P.PetApp._puff_size(None, a / 100.0) for a in range(0, 200, 10)]
check("泡泡由小到大再散掉",
      12 <= sizes[0] and max(sizes) >= 55 and sizes[-1] <= 12,
      "sizes=%s" % [round(s) for s in sizes])
check("休眠同时多个泡泡", P.PUFF_MAX >= 2 and P.PUFF_SPAWN < P.PUFF_LIFE,
      "max=%d spawn=%.2f life=%.1f" % (P.PUFF_MAX, P.PUFF_SPAWN, P.PUFF_LIFE))

# ---------- 8) 置顶配置 ----------
cfg = P.load_config()
check("配置默认含 topmost", "topmost" in cfg, "cfg=%s" % cfg)

failed = [n for n, ok, _ in results if not ok]
print("\nTOTAL %d  PASS %d  FAIL %d" % (len(results), len(results) - len(failed), len(failed)))
sys.exit(1 if failed else 0)
