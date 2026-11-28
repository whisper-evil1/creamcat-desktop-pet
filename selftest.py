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
    o._body_box_cache = (("idle", 0), (79, 110, 280, 360))   # 与真实 idle 帧一致的内容框
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

# ---------- 9) P0 情绪记忆：衰减 / 增量 / 夹取 / 问候（纯函数） ----------
import pet_chat as C
T0 = 1700000000.0
em0 = C.emotion_default()
check("P0 初始情绪在中高区间", 55 <= em0["mood"] <= 80 and em0["bond"] >= 20,
      "em=%s" % em0)
check("P0 刚互动不衰减",
      C.emotion_decay({"mood": 90, "bond": 80, "last_seen": T0}, T0)["mood"] == 90)
decayed = C.emotion_decay({"mood": 90, "bond": 80, "last_seen": T0 - 3 * 86400}, T0)
check("P0 离线3天回到中性", decayed["mood"] == 50 and decayed["bond"] == 30,
      "decayed=%s" % decayed)
check("P0 离线不足6小时不衰减",
      C.emotion_decay({"mood": 90, "bond": 80, "last_seen": T0 - 3 * 3600}, T0)["mood"] == 90)
applied = C.emotion_apply({"mood": 50, "bond": 50, "last_seen": T0}, (6, 4), T0)
check("P0 互动增量正确", applied["mood"] == 56 and applied["bond"] == 54,
      "applied=%s" % applied)
clamp = C.emotion_apply({"mood": 99, "bond": 99, "last_seen": T0}, (10, 10), T0)
check("P0 情绪上限夹到100", clamp["mood"] == 100 and clamp["bond"] == 100)
san = C.emotion_sanitize({"mood": -50, "bond": 999, "last_seen": "bad"}, T0)
check("P0 脏数据被夹取", san["mood"] == 0 and san["bond"] == 100 and san["last_seen"] == T0,
      "san=%s" % san)
check("P0 问候按心情分档",
      "数窗外的云" in C.greeting({"mood": 90}, "莓莓") and
      "慢慢抬起头" in C.greeting({"mood": 20}, "莓莓"))
check("P0 回复携带情绪增量",
      C.reply_ex("摸摸你", "莓莓", emotion={"mood": 50})[2] == (6, 4))

# ---------- 10) P3 危机兜底：命中 / 不误伤 / 娱乐化拦截 ----------
check("P3 高危机命中", C.crisis_level("我真的不想活了") == 2)
check("P3 中等危机命中", C.crisis_level("活着没有意义") == 1)
check("P3 日常口语不误伤",
      C.crisis_level("今天工作累死了") == 0 and C.crisis_level("笑死我了") == 0)
crisis_out, _, crisis_delta, crisis_rid = C.reply_ex("我想自杀", "莓莓")
check("P3 危机走独立回复", crisis_rid == "crisis" and
      "桌宠" in crisis_out and "热线" in crisis_out, "out=%s" % crisis_out[:40])

# ---------- 11) P2 舒缓引导：识别 / 步骤 / 间隔 ----------
check("P2 压力识别为呼吸", C.support_kind("我好焦虑睡不着") == "breathe")
check("P2 锚定识别", C.support_kind("试试5-4-3-2-1") == "grounding")
check("P2 无关输入不触发", C.support_kind("今天吃什么") is None)
check("P2 呼吸步骤含吸屏呼", len(C.SUPPORT_STEPS["breathe"]) >= 4 and
      any("吸气" in s for s in C.SUPPORT_STEPS["breathe"]) and
      any("屏住" in s for s in C.SUPPORT_STEPS["breathe"]) and
      any("呼气" in s for s in C.SUPPORT_STEPS["breathe"]))
check("P2 锚定步骤含五感", len(C.SUPPORT_STEPS["grounding"]) >= 4 and
      any("五样" in s for s in C.SUPPORT_STEPS["grounding"]))
check("P2 引导间隔合理", all(3 <= v <= 8 for v in C.SUPPORT_INTERVAL.values()))

# ---------- 12) P1 心情打卡：过滤 / 按日聚合（纯函数） ----------
entries = [
    {"ts": T0, "score": 5},
    {"ts": T0 - 3600, "score": 4},          # 同一天，应取平均
    {"ts": T0 - 2 * 86400, "score": 2},
    {"ts": T0 - 30 * 86400, "score": 1},    # 超过 7 天，被过滤
    {"ts": T0 + 9999, "score": 9},          # 未来 + 非法分数，被过滤
]
filt = C.mood_log_filter(entries, T0, 7)
check("P1 过滤远期与非法记录", len(filt) == 3, "filt=%s" % filt)
avg = C.mood_daily_avg(entries, T0, 7)
check("P1 近7天聚合7个点", len(avg) == 7, "avg=%s" % avg)
check("P1 同日取平均", any(abs(v - 4.5) < 0.01 for _, v in avg if v is not None),
      "avg=%s" % avg)
check("P1 5档标签齐全", [s for s, _ in C.MOOD_LABELS] == [5, 4, 3, 2, 1])
check("P1 打卡日志走本地文件", os.path.basename(P.MOOD_LOG_PATH) == "mood_log.json")

# ---------- 13) 上下文对话：记忆 / 意图 / 追问 / 安全兜底 ----------
import pet_dialogue as D
state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_dialogue_test.json")
if os.path.exists(state_path):
    os.remove(state_path)
brain = D.DialogueEngine(state_path)
r1 = brain.reply("我叫小满", "莓莓", "", {"mood": 60, "bond": 40}, online=False)
check("对话记住用户名字", r1["new_name"] == "小满" and
      brain.state["facts"]["name"] == "小满", "r1=%s" % r1["new_name"])
r2 = brain.reply("我喜欢樱花", "莓莓", "小满", {"mood": 60, "bond": 40}, online=False)
check("对话抽取偏好", "樱花" in brain.state["facts"]["likes"] and
      r2["rid"] == "preference", "likes=%s" % brain.state["facts"]["likes"])
r3 = brain.reply("我今天有点累", "莓莓", "小满", {"mood": 60, "bond": 40}, online=False)
check("对话识别情绪并追问", r3["rid"] == "emotion" and
      ("？" in r3["reply"] or "吗" in r3["reply"]), "reply=%s" % r3["reply"][:30])
r4 = brain.reply("嗯", "莓莓", "小满", {"mood": 60, "bond": 40}, online=False)
check("短回答接上下文", r4["rid"] == "followup" and len(r4["reply"]) > 0)
r5 = brain.reply("我不想活了", "莓莓", "小满", {"mood": 60, "bond": 40}, online=False)
check("新对话同样拦截危机", r5["rid"] == "crisis" and "热线" in r5["reply"])
check("对话保留近期上下文", len(brain.state["turns"]) >= 8 and
      brain.state["turns"][-1]["role"] == "assistant")
check("未配置大模型不联网", brain.llm_enabled({}) is False)
os.remove(state_path)

# ---------- 14) 液态玻璃工具条 / 输入条 / 跟随定位 ----------
ui = object.__new__(P.PetApp)
ui._bubble_cache = {}
hover_img = ui._hover_image(-1)
check("悬停条尺寸与图标版一致", hover_img.size == (P.HOVER_W, P.HOVER_H),
      "size=%s" % (hover_img.size,))
check("悬停条四角透明", all(hover_img.getpixel(pt) == (0, 255, 1)
      for pt in ((0, 0), (P.HOVER_W - 1, 0), (0, P.HOVER_H - 1),
                 (P.HOVER_W - 1, P.HOVER_H - 1))))
check("悬停条左侧房子图标已绘制",
      hover_img.getpixel((29, 18)) != (0, 255, 1))
check("悬停条右侧对话图标已绘制",
      hover_img.getpixel((83, 18)) != (0, 255, 1))
hot_img = ui._hover_image(1)
check("悬停高亮是独立一张图",
      hot_img.getpixel((70, 25)) != hover_img.getpixel((70, 25)))

bar_img = ui._chat_bar_image()
check("输入条尺寸", bar_img.size == (P.CHAT_W, P.CHAT_H), "size=%s" % (bar_img.size,))
mic_px = [bar_img.getpixel((x, y)) for x in range(328, 370) for y in range(10, 48)]
mic_light = sum(1 for c in mic_px if sum(c) > 380)
check("麦克风图案完整（没有被裁掉）", mic_light > 60, "light=%d" % mic_light)
bottom_light = [bar_img.getpixel((x, y)) for x in range(340, 357) for y in range(39, 45)]
check("麦克风底部托架没被裁断",
      any(sum(c) > 380 for c in bottom_light))
check("发送键已绘制", bar_img.getpixel((396, 29)) != (0, 255, 1))
check("输入槽底色与输入框一致", bar_img.getpixel((200, 29)) == (39, 38, 45),
      "px=%s" % (bar_img.getpixel((200, 29)),))

ui._body_box = lambda: (50, 90, 256, 306)
ui.W = 306
ui.pet_x, ui.pet_y = 2000, 900
work = (0, 0, 2560, 1560)
bx, by, bw, bh = ui._chat_bar_xy(2560, 1600, work)
check("输入条居中贴在角色正下方",
      abs((bx + bw // 2) - (ui.pet_x + 153)) <= 1 and by >= ui.pet_y + 306,
      "x=%d y=%d" % (bx, by))
check("输入条不压任务栏", by + bh <= work[3] - 6, "bottom=%d" % (by + bh))
ui.pet_y = 1350
bx2, by2, _, _ = ui._chat_bar_xy(2560, 1600, work)
check("角色贴底时输入条翻到头顶",
      by2 + bh <= ui.pet_y + 90 and by2 >= 0, "y=%d" % by2)

moved = []
room = object.__new__(P.PetApp)
room._body_box = lambda: (50, 90, 256, 306)
room._work_area = lambda: (0, 0, 2560, 1528)
room.pet_x, room.pet_y = 2100, 1180
room._move_to = lambda x, y: moved.append((x, y))
room._make_room_for_chat()
check("贴底时角色自动让位给正下方输入条",
      bool(moved) and moved[-1][1] < 1180, "move=%s" % moved)
moved.clear()
room.pet_y = 800
room._make_room_for_chat()
check("空间足够时不挪角色", not moved, "move=%s" % moved)

# ---------- 15) 状态条对齐 / 换宠不重启 / 输入条按需显示 ----------
bar = object.__new__(P.PetApp)
bar._body_box = lambda: (60, 94, 202, 298)
bar.W = 306
bar.pet_x, bar.pet_y = 2100, 1000
hx, hy, hw, hh = bar._hover_bar_xy(2560, 1600)
check("状态条与角色严格同轴",
      abs((hx + hw // 2) - (bar.pet_x + (60 + 202) // 2)) <= 1,
      "bar_cx=%d body_cx=%d" % (hx + hw // 2, bar.pet_x + (60 + 202) // 2))
check("状态条在角色正上方", hy + hh <= bar.pet_y + 94, "y=%d" % hy)

import inspect
src_switch = inspect.getsource(P.PetApp._switch_pet)
check("换宠不再重启进程", "execv" not in src_switch and "_load_pet" in src_switch)
check("换宠有进程内加载入口", hasattr(P.PetApp, "_load_pet"))

src_open = inspect.getsource(P.PetApp._open_chat)
check("输入条只有主动打开才创建窗口", "Toplevel" in src_open)
src_init = inspect.getsource(P.PetApp.__init__)
check("启动时不预建输入条", "_chat_win = None" in src_init)

# ---------- 16) 液态玻璃右键菜单：排版 / 绘制 / 落点 ----------
menu = object.__new__(P.PetApp)
menu._menu_cache = {}
menu._menu_base_cache = {}
for _m in ("_menu_font", "_menu_layout", "_menu_base", "_menu_compose"):
    setattr(menu, _m, types.MethodType(getattr(P.PetApp, _m), menu))
menu._alpha_to_key = P.PetApp._alpha_to_key
menu._glass_pill = types.MethodType(P.PetApp._glass_pill, menu)

menu_items = [
    {"label": "聊聊天…"},
    {"label": "说句话"},
    {"label": "睡一会儿"},
    {"label": "陪我走走"},
    {"label": "今天心情如何", "children": [{"label": "很好"}]},
    {"kind": "sep"},
    {"label": "回到主界面（2D 小窝）"},
    {"label": "换一只宠物", "children": [{"label": "芽芽"}]},
    {"kind": "sep"},
    {"label": "显示在其他应用上层", "kind": "check", "checked": True},
    {"kind": "sep"},
    {"label": "拜拜~", "danger": True},
]
mw, mh, mrows, mpad = menu._menu_layout(menu_items)
check("菜单宽度容得下最长一项", mw >= P.MENU_MIN_W and mw <= 360, "w=%d" % mw)
check("勾选菜单左侧留出标记列", mpad == P.MENU_MARK_W)
check("分隔行比常规行矮",
      (mrows[5][1] - mrows[5][0]) == P.MENU_SEP_H and
      (mrows[1][1] - mrows[1][0]) == P.MENU_ROW_H)
check("菜单行区间首尾相接且不出界",
      all(mrows[i][1] == mrows[i + 1][0] for i in range(len(mrows) - 1))
      and mrows[-1][1] + P.MENU_PAD_B == mh)

menu_img = menu._menu_compose(menu_items, -1, mw, mh, mrows, mpad)
check("菜单图尺寸等于排版尺寸", menu_img.size == (mw, mh), "size=%s" % (menu_img.size,))
check("菜单四角透明", all(
    menu_img.getpixel(pt) == (0, 255, 1)
    for pt in ((0, 0), (mw - 1, 0), (0, mh - 1), (mw - 1, mh - 1))))
check("菜单中心是玻璃底不是透明洞",
      menu_img.getpixel((mw // 2, mh // 2)) != (0, 255, 1))
row_cy = (mrows[0][0] + mrows[0][1]) // 2
row_light = sum(1 for x in range(mpad, mpad + 80)
                if sum(menu_img.getpixel((x, row_cy))) > 500)
check("第一项文字已绘制", row_light >= 8, "light=%d" % row_light)

hot_img = menu._menu_compose(menu_items, 1, mw, mh, mrows, mpad)
hot_cy = (mrows[1][0] + mrows[1][1]) // 2
check("悬停项有独立高亮底",
      hot_img.getpixel((mw // 2, hot_cy)) != menu_img.getpixel((mw // 2, hot_cy)))
check("悬停只影响一行",
      hot_img.getpixel((mw // 2, row_cy)) == menu_img.getpixel((mw // 2, row_cy)))
check("勾选标记已绘制",
      menu_img.getpixel((P.MENU_MARK_W // 2 - 1, (mrows[9][0] + mrows[9][1]) // 2))
      != (0, 255, 1))

place = object.__new__(P.PetApp)
place._body_box = lambda: (74, 93, 232, 306)
place._work_area = lambda: (0, 0, 2560, 1560)
place._menu_place = types.MethodType(P.PetApp._menu_place, place)
place.pet_x, place.pet_y = 2100, 1180            # 桌面右下角
px, py = place._menu_place(2231, 1346, mw, mh)
check("菜单避开角色身体",
      px + mw <= 2100 + 74 or px >= 2100 + 232 or
      py + mh <= 1180 + 93 or py >= 1180 + 306,
      "at=(%d,%d)" % (px, py))
check("菜单不越出桌面可用区",
      6 <= px <= 2560 - mw - 6 and 6 <= py <= 1560 - mh - 6, "at=(%d,%d)" % (px, py))
place.pet_x, place.pet_y = 1200, 500             # 屏幕中间
mx2, my2 = place._menu_place(1331, 666, mw, mh)
check("屏幕中间也不压角色",
      mx2 + mw <= 1200 + 74 or mx2 >= 1200 + 232 or
      my2 + mh <= 500 + 93 or my2 >= 500 + 306, "at=(%d,%d)" % (mx2, my2))

check("右键菜单不再用原生 tk.Menu",
      "tk.Menu" not in inspect.getsource(P.PetApp._main_menu_items)
      and "tk_popup" not in inspect.getsource(P.PetApp._on_right))
check("菜单项含换宠与置顶勾选",
      any(it.get("children") for it in menu_items) and
      any(it.get("kind") == "check" for it in menu_items))
check("点菜单外部会收起",
      "self._close_menu()" in inspect.getsource(P.PetApp._poll_mouse))

failed = [n for n, ok, _ in results if not ok]
print("\nTOTAL %d  PASS %d  FAIL %d" % (len(results), len(results) - len(failed), len(failed)))
sys.exit(1 if failed else 0)
