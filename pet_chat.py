# -*- coding: utf-8 -*-
"""桌宠对话规则：从 house2d/app.js 的 RULES 精简移植，保持同一人设。

纯本地、零依赖、不联网。返回 (回复文本, 用户名字或 None)。
用户名字由调用方存进 config.json，实现「我叫小满」的记忆。
"""
import random
import re
import time

# 规则顺序即优先级：与 2D 小窝一致，先匹配先返回。
# 元素：(id, 关键词列表, 回复 或 callable(text, ctx)->回复)
RULES = [
    ("setname", ["我叫", "我是", "叫我"], None),
    ("name", ["名字", "你是谁", "叫什么"], lambda t, c: "我叫" + c["name"] + "呀，就住在你的桌面上。\n你怎么称呼？"),
    ("remember", ["记住"], lambda t, c: "记住啦，" + c["user"] + "。\n我把你的名字放在最里面的那格。" if c["user"] else "记住啦，写在心里的那种。"),
    ("age", ["几岁", "多大", "年龄"], lambda t, c: "按你们的算法…大概三岁？\n不过我不太在意这个。"),
    ("home", ["住在这里", "你的家", "家住", "住哪"], lambda t, c: "嗯！这间屋子就是我的家。\n你点一下家具，我就带你去看。"),
    ("fav", ["喜欢哪个地方", "最喜欢哪", "哪里最好", "哪个地方最好"], lambda t, c: "唔…最喜欢窗边。\n因为站在那里，能第一个看见你回来。"),
    ("why_like", ["为什么喜欢"], lambda t, c: "因为这里是你布置的呀。"),
    ("where", ["什么地方", "这是哪", "这里是", "在哪", "哪里呀"], lambda t, c: "整间屋子呀：左边是猫爬架和窗，中间是床和圆桌，右边是我的小屋。"),
    ("lie", ["躺一下", "坐一下", "躺下", "坐上来", "一起睡", "上来"], lambda t, c: "当然可以呀，被子很大。\n给你留一半，我睡边上。"),
    ("goto", ["带我去", "去床边", "去窗边", "去猫爬架", "去书柜", "去桌子", "去猫窝"], lambda t, c: "好呀，跟我来～\n（在前面带路，尾巴一摇一摇）"),
    ("doing", ["做什么", "干嘛", "干什么", "忙什么", "忙吗"], lambda t, c: random.choice([
        "我在房间里转来转去，看看有没有新东西。",
        "刚在地毯上打了个滚，地板凉凉的。",
        "我在数书脊上的颜色，一本一本数过去。",
    ])),
    ("give", ["给你", "拿去吧", "吃吧", "去吃吧", "喂你"], lambda t, c: "哇！是给我的吗？\n谢谢你，我分你一半～"),
    ("more_food", ["还要", "再来", "够吗", "吃饱", "还有吗"], lambda t, c: "已经吃得很饱啦～\n剩下的留到晚上，我们一起吃。"),
    ("taste", ["好吃", "香吗", "味道"], lambda t, c: "好吃呀，脆脆的。\n你要不要也来一口？"),
    ("no_food", ["没有", "没得", "等我", "等一下", "待会", "下次"], lambda t, c: "那我先忍一忍…\n等你有空再给我嘛，我不急。"),
    ("food", ["饿", "吃", "饭", "零食", "鱼干", "牛奶", "饼干", "点心"], lambda t, c: "有点想吃小鱼干…\n你会给我吗？"),
    ("sleep", ["困", "睡", "晚安", "休息", "哈欠", "做梦"], lambda t, c: "那我去床上躺一会儿…\n你点一下床就能找到我。"),
    ("accompany", ["陪你", "陪着你", "陪一会儿"], lambda t, c: "（往你手边挪了挪）\n嗯…有你在就不怕黑了。"),
    ("play", ["玩", "球", "游戏", "一起"], lambda t, c: "好呀，去地毯上追球吧！"),
    ("start", ["开始吧", "开始", "来吧", "走吧", "一起玩"], lambda t, c: "那我先跑啦！\n（已经冲到地毯中间，回头看你一眼）"),
    ("fast", ["跑得快", "跑得动", "快吗", "追不上"], lambda t, c: "当然快呀，我可是每天在屋里巡逻三圈的。\n不过我会等你的。"),
    ("pet", ["摸", "抱", "rua", "撸", "揉", "蹭", "挠下巴"], lambda t, c: random.choice([
        "（把脑袋凑过来）这里…可以摸。",
        "唔…好舒服。\n再摸一下也可以。",
        "（眯起眼睛，喉咙里发出呼噜声）",
    ])),
    ("soft", ["好软", "软吗", "软软的", "毛"], lambda t, c: "（团成一个球）\n软软的哦，像刚晒过的被子。"),
    ("spin", ["转个圈", "转圈", "看看你"], lambda t, c: "（原地转了一圈，尾巴扫过地板）\n怎么样，毛毛蓬起来了吧。"),
    ("cute", ["可爱", "萌", "漂亮", "好看", "好乖", "真乖", "乖乖", "帅"], lambda t, c: "嘿嘿，被你发现啦。\n我今天特意理了毛。"),
    ("story", ["讲讲", "再讲", "故事", "秘密", "小时候", "以前", "过去"], lambda t, c: "秘密…我只告诉你一个：\n我最喜欢的事，是你回来的时候叫我名字。"),
    ("weather", ["天气", "窗外", "外面", "樱花", "下雨", "太阳", "晴", "云"], lambda t, c: "窗外在飘樱花，风一吹就像下雪。\n要不要去窗边一起看？"),
    ("cold", ["怕冷", "冷吗", "冷不冷"], lambda t, c: "我有一身毛毛呀，不怕冷。\n倒是你，手凉凉的，要不要贴着我？"),
    ("warm", ["暖暖", "暖手", "贴着我", "暖和"], lambda t, c: "（整只贴在你手心里）\n这样暖一点吗？我体温偏高的。"),
    ("come_more", ["常来", "天天来", "每天都来", "一直来"], lambda t, c: "那我每天都在这儿等你。\n（把门口的位置先占好）"),
    ("better", ["我好多", "好些了", "没事了", "好一点"], lambda t, c: "那就好。\n我陪你到你不难过为止。"),
    ("backsoon", ["很快回来", "马上回来", "就回来", "一会儿就回"], lambda t, c: "嗯，我数着时间。\n（趴在门口，耳朵朝着门的方向）"),
    ("love", ["喜欢", "爱你", "宝贝", "最好了", "离不开", "真好"], lambda t, c: "我也喜欢你。\n（尾巴绕住你的手）"),
    ("sad", ["难过", "累", "烦", "压力", "不开心", "emo", "伤心", "焦虑", "好难"], lambda t, c: "那…我安静地陪你坐一会儿吧。\n不用说话也可以。"),
    ("thanks", ["谢谢", "谢啦", "感谢"], lambda t, c: "不用谢呀。\n你开心，我就开心。"),
    ("bye", ["再见", "拜拜", "走了", "该走", "下线", "出去"], lambda t, c: "那…" + c["user"] + "，早点回来。\n我在这儿等你。" if c["user"] else "那…早点回来。\n我在这儿等你。"),
    ("help", ["怎么玩", "能做什么", "帮助", "不会玩", "教我"], lambda t, c: "右键我能换宠物、去小窝、去展厅。\n想聊天就直接点「聊聊天」，我听得懂不少呢。"),
    ("hi", ["你好", "您好", "嗨", "hi", "hello", "在吗", "在么", "早安", "晚上好", "下午好", "早上好"], None),
]

FALLBACK = [
    "唔…（歪了歪头）我没太听懂。\n你是想问「你在做什么」吗？",
    "这个我不太懂诶…\n不过你愿意跟我说话，我就很开心了。",
    "（把爪子搭在你手上）\n你想说什么都可以，我听着呢。",
]

NAME_RE = re.compile(r"(?:我(?:叫|是)|叫我)\s*([^\s，,。！!？?、]{1,8})")


def _dispatch(text, pet_name, user_name="", emotion=None):
    """规则派发：返回 (回复文本, 新用户名字或 None, 规则 id)。"""
    raw = (text or "").strip()
    if not raw:
        return "你说话呀，我在听呢。", None, "empty"
    low = raw.lower()
    ctx = {
        "name": pet_name,
        "user": user_name or "",
        "moodWord": mood_word(emotion or {}),
    }
    new_name = None

    for rid, keys, body in RULES:
        if not any(k in low for k in keys):
            continue
        if rid == "setname":
            m = NAME_RE.search(raw)
            if not m:
                return "嗯？你叫什么呀，我没听清。", None, rid
            new_name = m.group(1)
            return ("「" + new_name + "」…真好听。\n以后我就这么叫你啦，" + new_name + "。",
                    new_name, rid)
        if rid == "hi":
            h = time.localtime().tm_hour
            greet = "早上好呀～" if h < 11 else ("下午好～" if h < 18 else "晚上好呀～")
            return greet + "\n我刚在桌面上发呆呢。", None, rid
        return (body(raw, ctx) if callable(body) else body), None, rid

    return random.choice(FALLBACK), None, "fallback"


def reply(text, pet_name, user_name=""):
    """兼容旧调用：返回 (回复文本, 新用户名字或 None)。"""
    out, new_name, _ = _dispatch(text, pet_name, user_name)
    return out, new_name


# ============================================================
# P0 情绪记忆：默认状态 / 时间衰减 / 互动增量 / 主动问候
# 全部为纯函数（同样输入得同样输出），便于确定性单测。
# ============================================================
DEFAULT_MOOD = 65
DEFAULT_BOND = 30
NEUTRAL_MOOD = 50
NEUTRAL_BOND = 30
DECAY_AFTER_HOURS = 6.0     # 离线超过 6 小时才开始衰减
DECAY_PER_HOUR = 2.0        # 之后每小时向中性回归点数

# 规则 id -> (心情增量, 亲昵增量)；不在表内的规则不改变情绪
RID_DELTA = {
    "pet": (6, 4), "soft": (5, 3), "praise": (6, 3), "love": (7, 5),
    "feed": (5, 2), "taste": (3, 1), "thanks": (3, 2), "play": (6, 3),
    "start": (5, 2), "hi": (2, 1), "come_more": (2, 2), "accompany": (3, 3),
    "sad": (-3, 2), "mood": (-1, 1), "bye": (0, 1), "story": (2, 2),
    "warm": (4, 3), "spin": (3, 1),
}


def emotion_default():
    """新用户的初始情绪状态。"""
    return {"mood": DEFAULT_MOOD, "bond": DEFAULT_BOND, "last_seen": None}


def emotion_sanitize(em, now=None):
    """把配置里读到的情绪字段夹到合法区间；缺失字段补默认值。"""
    now = time.time() if now is None else now
    src = em if isinstance(em, dict) else {}

    def num(key, default, lo, hi):
        try:
            v = float(src.get(key, default))
        except (TypeError, ValueError):
            v = default
        return max(lo, min(hi, int(round(v))))

    ts = src.get("last_seen")
    if not isinstance(ts, (int, float)) or ts <= 0:
        ts = now
    return {"mood": num("mood", DEFAULT_MOOD, 0, 100),
            "bond": num("bond", DEFAULT_BOND, 0, 100),
            "last_seen": float(ts)}


def emotion_decay(em, now=None):
    """纯函数：离线超过阈值后，心情与亲昵按小时向中性回归。"""
    now = time.time() if now is None else now
    out = emotion_sanitize(em, now)
    hours = max(0.0, (now - out["last_seen"]) / 3600.0)
    effective = max(0.0, hours - DECAY_AFTER_HOURS)
    if effective <= 0:
        return out
    steps = min(effective * DECAY_PER_HOUR, 100.0)

    def toward(value, neutral):
        if value > neutral:
            return max(neutral, value - steps)
        if value < neutral:
            return min(neutral, value + steps)
        return value

    out["mood"] = int(round(toward(out["mood"], NEUTRAL_MOOD)))
    out["bond"] = int(round(toward(out["bond"], NEUTRAL_BOND)))
    out["last_seen"] = now
    return out


def emotion_apply(em, delta, now=None):
    """纯函数：先衰减再叠加本次互动增量，最后刷新时间戳。"""
    now = time.time() if now is None else now
    out = emotion_decay(em, now)
    dm, db = delta if delta else (0, 0)

    def clamp(v):
        return max(0, min(100, v))

    out["mood"] = clamp(out["mood"] + int(dm))
    out["bond"] = clamp(out["bond"] + int(db))
    out["last_seen"] = now
    return out


def mood_word(em):
    """当前心情的中文描述，供回复里引用。"""
    m = (em or {}).get("mood", DEFAULT_MOOD)
    try:
        m = int(m)
    except (TypeError, ValueError):
        m = DEFAULT_MOOD
    return "亮亮的" if m >= 75 else ("软软的" if m >= 50 else "有点闷")


def greeting(em, pet_name, user_name=""):
    """久别重逢时的主动状态问候，按当前心情分三档。"""
    m = (em or {}).get("mood", DEFAULT_MOOD)
    try:
        m = int(m)
    except (TypeError, ValueError):
        m = DEFAULT_MOOD
    who = user_name or "你"
    if m >= 75:
        return who + "回来啦！" + pet_name + "刚在数窗外的云，数着数着就在等你。"
    if m >= 45:
        return who + "，你来了。我趴在门口，尾巴还没停。"
    return "（慢慢抬起头）" + who + "…我等了一会儿。你来了就好。"


def reply_ex(text, pet_name, user_name="", emotion=None, now=None):
    """扩展版：返回 (回复, 新用户名, 情绪增量, 规则 id)。

    危机表述优先兜底（规则 id=crisis），保证不进入娱乐化回复。
    """
    raw = (text or "").strip()
    level = crisis_level(raw)
    if level:
        return (CRISIS_REPLY[level], None, (0, 2), "crisis")
    out, new_name, rid = _dispatch(raw, pet_name, user_name, emotion)
    return out, new_name, RID_DELTA.get(rid, (0, 0)), rid


# ============================================================
# P3 安全兜底：危机关键词识别（克制词表，不误伤日常口语）
# ============================================================
_CRISIS_HIGH = re.compile(
    r"自杀|自伤|伤害自己|结束(自己的)?生命|不想活了?|活不下去|了结自己|割腕|跳楼|服毒|自残")
_CRISIS_MILD = re.compile(r"活着没(意思|意义)|没有意义|想消失|撑不下去|看不到希望")


def crisis_level(text):
    """纯函数：0=无风险，1=需要温和提示，2=需要立即引导求助。"""
    t = re.sub(r"\s+", "", text or "")
    if _CRISIS_HIGH.search(t):
        return 2
    if _CRISIS_MILD.search(t):
        return 1
    return 0


CRISIS_REPLY = {
    1: "（轻轻靠过来）\n你这样说，我想认真听。\n如果这不是玩笑，找身边信任的人聊聊，"
       "或拨打心理援助热线。我在这儿陪你。",
    2: "（放下所有动作，认真看着你）\n这很重要：我只是一只桌宠，不是专业帮助。\n"
       "请现在就联系身边的人，或拨打当地心理援助热线。\n我会安静陪着你，但你需要真人来帮你。",
}


# ============================================================
# P2 舒缓引导：呼吸与 5-4-3-2-1 锚定，逐句纯文本步骤
# ============================================================
_BREATH_KEYS = ("呼吸", "喘不过气", "焦虑", "紧张", "心慌", "睡不着", "压力", "静一静", "冷静")
_GROUND_KEYS = ("5-4-3-2-1", "54321", "锚定", "走神", "发慌", "胡思乱想", "分心")

SUPPORT_STEPS = {
    "breathe": [
        "先坐直一点点，跟着我来。",
        "吸气——数四下，一、二、三、四。",
        "屏住——数七下，慢慢数。",
        "呼气——数八下，把肩膀一起放下来。",
        "再来一轮：吸四、屏七、呼八。",
        "最后一次。你会发现，呼吸比刚才长了。",
    ],
    "grounding": [
        "我们把注意力拉回这里，慢慢看一圈。",
        "说出你看到的五样东西，心里数就行。",
        "再摸到四样：桌沿、衣角、椅子…都可以。",
        "听一听，找出三种声音。",
        "闻一闻两种气味，再尝一尝一种味道。",
        "好了，你回到了现在。我一直在这儿。",
    ],
}

SUPPORT_INTERVAL = {"breathe": 4.2, "grounding": 5.0}   # 每步间隔（秒）


def support_kind(text):
    """纯函数：识别该启动哪种舒缓流程，None 表示不启动。"""
    t = (text or "").lower()
    if any(k in t for k in _GROUND_KEYS):
        return "grounding"
    if any(k in t for k in _BREATH_KEYS):
        return "breathe"
    return None


# ============================================================
# P1 心情打卡：日志聚合纯函数（IO 由调用方负责）
# ============================================================
MOOD_LABELS = ((5, "很好"), (4, "不错"), (3, "还行"), (2, "不太好"), (1, "很糟"))
MOOD_KEEP_DAYS = 90


def mood_log_filter(entries, now=None, days=7):
    """纯函数：只保留最近 days 天、分数合法的打卡记录。"""
    now = time.time() if now is None else now
    cutoff = now - max(1, days) * 86400
    out = []
    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict):
            continue
        ts, score = e.get("ts"), e.get("score")
        if not isinstance(ts, (int, float)) or ts < cutoff or ts > now + 300:
            continue
        try:
            score = int(score)
        except (TypeError, ValueError):
            continue
        if 1 <= score <= 5:
            out.append({"ts": float(ts), "score": score})
    return out


def mood_daily_avg(entries, now=None, days=7):
    """纯函数：按本地日历日聚合最近 days 天的平均分，无数据的日子为 None。"""
    now = time.time() if now is None else now
    valid = mood_log_filter(entries, now, days)
    buckets = {}
    for e in valid:
        day = time.strftime("%Y-%m-%d", time.localtime(e["ts"]))
        buckets.setdefault(day, []).append(e["score"])
    out = []
    for i in range(max(1, days) - 1, -1, -1):
        day = time.strftime("%Y-%m-%d", time.localtime(now - i * 86400))
        vals = buckets.get(day)
        out.append((day, round(sum(vals) / len(vals), 2) if vals else None))
    return out
