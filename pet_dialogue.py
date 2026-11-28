# -*- coding: utf-8 -*-
"""星宠语 · 上下文对话引擎。

分层设计：
  1. 本地上下文引擎：意图识别 + 记忆 + 追问 + 情绪状态，离线可用；
  2. 可选真实大模型：在 config.json 填 OpenAI 兼容接口，或设置
     PET_LLM_BASE_URL / PET_LLM_API_KEY / PET_LLM_MODEL 环境变量。

所有网络失败都会静默回落到本地引擎，不影响桌宠桌面交互。
对话记忆写在 conversation.json（隐私数据，不入库）。
"""
import json
import os
import random
import re
import time
import urllib.request

import pet_chat

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(ROOT, "conversation.json")
CONFIG_PATH = os.path.join(ROOT, "config.json")

NAME_RE = re.compile(r"(?:我(?:叫|是)|叫我)\s*([^\s，,。！!？?、]{1,8})")
LIKE_RE = re.compile(r"我(?:最)?(?:喜欢|爱)\s*([^\s，,。！!？?、]{1,10})")
DISLIKE_RE = re.compile(r"我(?:最)?(?:讨厌|不喜欢)\s*([^\s，,。！!？?、]{1,10})")
FEEL_RE = re.compile(r"我(?:(?:现在|今天|最近|有点|好|很|特别|真的|太)){0,3}\s*"
                     r"(难过|伤心|累|疲惫|烦|焦虑|紧张|开心|高兴|快乐|失落|孤独|生气|压力)")

GREET = re.compile(r"你好|您好|嗨|hi|hello|在吗|在么|早安|晚安|早上好|下午好|晚上好")
BYE = re.compile(r"再见|拜拜|走了|下线|先走")
THANKS = re.compile(r"谢谢|感谢|谢啦")
PRAISE = re.compile(r"可爱|漂亮|好看|好乖|真乖|厉害|喜欢你|爱你|宝贝")
NO_MAP = re.compile(r"回主界面|主界面|小窝|展厅|3d|3D|图鉴|睡觉|休息|走走|换一只|换宠")
ASK_NAME = re.compile(r"你叫什么|你是谁|名字")
ASK_YOU = re.compile(r"你(?:怎么样|好吗|好么|心情|开心吗|累吗)")
REMEMBER = re.compile(r"记得|还记得|说过|刚才|之前")

POS_WORDS = ("开心", "高兴", "快乐", "不错", "很好", "顺利", "喜欢", "爱", "棒", "好")
NEG_WORDS = ("难过", "伤心", "累", "疲惫", "烦", "焦虑", "紧张", "压力", "失落", "孤独", "生气", "糟")

FOLLOWUPS = {
    "setname": ["今天想让我陪你聊点什么？", "我们就算认识啦，对吧？"],
    "greet": ["今天过得怎么样？", "想跟我聊点什么？"],
    "emotion": ["是今天遇到什么了吗？", "要不要跟我说说，发生了什么？"],
    "preference": ["它最吸引你的是什么？", "那你会常去看它吗？"],
    "question": ["你问这个，是在意什么呢？", "你想知道哪一部分？"],
    "action": ["还有别的想让我做的吗？", "要我陪你过去看看吗？"],
    "smalltalk": ["然后呢？", "你呢，最近怎么样？"],
    "memory": ["还有什么是我应该记住的？", "你想让我把它记在哪里？"],
    "crisis": ["我想认真听你说，好吗？"],
    "support": ["现在的一个小动作，想先从哪里开始？"],
}


def _load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else default
    except Exception:
        return default


def _safe_text(text, limit=160):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text[:limit]


def _sentiment(text):
    pos = sum(1 for w in POS_WORDS if w in text)
    neg = sum(1 for w in NEG_WORDS if w in text)
    if re.search(r"不(?:开心|高兴|好)", text):
        neg += 1
    if pos > neg:
        return 1
    if neg > pos:
        return -1
    return 0


class DialogueEngine:
    def __init__(self, state_path=STATE_PATH):
        self.state_path = state_path
        default = {
            "turns": [],
            "facts": {"name": "", "likes": [], "dislikes": [], "topic": ""},
            "pending": "",
            "count": 0,
        }
        self.state = _load_json(state_path, default)
        for key, value in default.items():
            self.state.setdefault(key, value)
        self.state["facts"].setdefault("name", "")
        self.state["facts"].setdefault("likes", [])
        self.state["facts"].setdefault("dislikes", [])
        self.state["facts"].setdefault("topic", "")

    def save(self):
        try:
            with open(self.state_path, "w", encoding="utf-8") as f:
                json.dump(self.state, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def remember(self, role, text):
        self.state.setdefault("turns", []).append(
            {"role": role, "text": _safe_text(text), "ts": time.time()})
        self.state["turns"] = self.state["turns"][-20:]

    def context_lines(self, limit=6):
        out = []
        for t in self.state.get("turns", [])[-limit:]:
            who = "你" if t.get("role") == "user" else "我"
            out.append(who + "：" + t.get("text", ""))
        return out

    # ---------- 意图：不是一问一答脚本，而是按语义分帧后组合 ----------
    def _intent(self, text):
        t = text.strip().lower()
        if NAME_RE.search(text):
            return "setname"
        if GREET.search(t):
            return "greet"
        if BYE.search(t):
            return "bye"
        if THANKS.search(t):
            return "thanks"
        if PRAISE.search(t):
            return "affection"
        if ASK_NAME.search(t):
            return "ask_name"
        if ASK_YOU.search(t):
            return "ask_mood"
        if REMEMBER.search(t):
            return "memory"
        if LIKE_RE.search(text) or DISLIKE_RE.search(text):
            return "preference"
        if FEEL_RE.search(text):
            return "emotion"
        if NO_MAP.search(t):
            return "action"
        if re.search(r"[?？]|为什么|怎么|什么|哪里|谁|吗|呢", text):
            return "question"
        if len(text) <= 4 and re.search(r"^(嗯|对|好|是的|真的|然后呢|为什么)", text):
            return "followup"
        return "smalltalk"

    def _extract_facts(self, text, user_name):
        facts = self.state["facts"]
        new_name = None
        m = NAME_RE.search(text)
        if m:
            new_name = m.group(1)
            facts["name"] = new_name
        elif user_name and not facts.get("name"):
            facts["name"] = user_name
        m = LIKE_RE.search(text)
        if m:
            item = m.group(1)
            if item not in facts["likes"]:
                facts["likes"].append(item)
            facts["topic"] = item
        m = DISLIKE_RE.search(text)
        if m:
            item = m.group(1)
            if item not in facts["dislikes"]:
                facts["dislikes"].append(item)
            facts["topic"] = item
        m = FEEL_RE.search(text)
        if m:
            facts["topic"] = m.group(1)
        return new_name

    def _compose_local(self, text, pet_name, user_name, emotion, intent):
        facts = self.state["facts"]
        user = user_name or facts.get("name") or "你"
        mood = pet_chat.mood_word(emotion)
        bond = int((emotion or {}).get("bond", pet_chat.DEFAULT_BOND))
        senti = _sentiment(text)
        topic = facts.get("topic", "")

        # 先回应，再复述/联系记忆，最后自然追问；片段按状态组合，不固定一问一答。
        if intent == "setname":
            who = facts.get("name") or user_name or "你"
            ack = "「" + who + "」…真好听。\n以后我就这么叫你啦，" + who + "。"
        elif intent == "greet":
            hour = time.localtime().tm_hour
            head = "早上好呀～" if hour < 11 else ("下午好～" if hour < 18 else "晚上好呀～")
            ack = head + "我刚在这儿发呆呢。"
        elif intent == "bye":
            ack = "好，那我先守着这里。"
        elif intent == "thanks":
            ack = "不用谢呀，" + user + "。"
        elif intent == "affection":
            ack = "（尾巴轻轻晃了一下）\n我也很想一直陪着你。"
        elif intent == "ask_name":
            ack = "我叫" + pet_name + "呀，就住在你的桌面上。"
        elif intent == "ask_mood":
            ack = "我有点" + mood + "，因为你在嘛。"
        elif intent == "memory":
            ack = "我记得呀。"
            if topic:
                ack += "你上次说的是「" + topic + "」。"
        elif intent == "preference":
            ack = "我记住了。"
            if topic:
                ack += "你喜欢「" + topic + "」这件事，我放在心里了。"
        elif intent == "emotion":
            ack = ("（轻轻靠近一点）\n听你这么说，我有点心疼。" if senti <= 0
                   else "听起来很不错呀，我也替你高兴。")
        elif intent == "action":
            ack = "好呀，我陪你。"
        elif intent == "question":
            ack = "嗯，我想想…"
        else:
            ack = random.choice(["我在听呢。", "嗯？", "你说。"])

        # 记忆联系：只有真的记住过才提，避免假装记得。
        memory_line = ""
        likes = facts.get("likes") or []
        if likes and intent not in ("memory", "preference"):
            memory_line = "我记得你还喜欢「" + likes[-1] + "」。"

        follow = ""
        if intent == "followup":
            prev = ""
            for turn in reversed(self.state.get("turns", [])):
                if turn.get("role") == "assistant":
                    prev = turn.get("text", "")
                    break
            follow = prev if prev.endswith("？") else "你想让我怎么陪你？"
        else:
            follow = random.choice(FOLLOWUPS.get(intent, FOLLOWUPS["smalltalk"]))

        parts = [ack]
        if memory_line and bond >= 35 and random.random() < 0.6:
            parts.append(memory_line)
        parts.append(follow)
        reply = "\n".join(p for p in parts if p)
        return _safe_text(reply, 220)

    # ---------- 可选真实大模型（OpenAI 兼容） ----------
    def _llm_config(self, cfg=None):
        if cfg is None:
            cfg = _load_json(CONFIG_PATH, {})
        base = os.environ.get("PET_LLM_BASE_URL") or cfg.get("llm_base_url") or ""
        key = os.environ.get("PET_LLM_API_KEY") or cfg.get("llm_api_key") or ""
        model = os.environ.get("PET_LLM_MODEL") or cfg.get("llm_model") or "gpt-4o-mini"
        if not base or not key:
            return None
        return {"base": base.rstrip("/"), "key": key, "model": model}

    def llm_enabled(self, cfg=None):
        return bool(self._llm_config(cfg))

    def _llm_call(self, text, pet_name, user_name, emotion, cfg=None):
        conf = self._llm_config(cfg)
        if not conf:
            return None
        facts = self.state["facts"]
        system = (
            "你在模拟一只叫「%s」的桌面宠物，语气软、好奇、会记事情。"
            "用户叫「%s」。当前心情%s，亲昵度%s/100。"
            "请结合下面的近期对话和记忆，接着当前话题自然回复，"
            "可以追问，不要像客服，不要写固定台词，不要自称 AI，不要长篇大论。"
            "如果用户提到自伤或危机，要温柔地引导联系身边真人和当地心理援助热线，"
            "并明确你不是专业帮助。"
        ) % (pet_name, user_name or facts.get("name") or "你",
             pet_chat.mood_word(emotion), int((emotion or {}).get("bond", 30)))
        messages = [{"role": "system", "content": system}]
        messages += [{"role": "assistant" if t.get("role") == "assistant" else "user",
                      "content": t.get("text", "")}
                     for t in self.state.get("turns", [])[-6:]]
        messages.append({"role": "user", "content": text})
        body = json.dumps({
            "model": conf["model"],
            "messages": messages,
            "temperature": 0.85,
            "max_tokens": 180,
        }).encode("utf-8")
        req = urllib.request.Request(
            conf["base"] + "/chat/completions", data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + conf["key"]})
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
            choices = data.get("choices") or []
            content = choices[0].get("message", {}).get("content", "") if choices else ""
            content = _safe_text(content, 220)
            return content or None
        except Exception:
            return None

    def reply(self, text, pet_name, user_name="", emotion=None, cfg=None, online=True):
        """返回 dict(reply,new_name,delta,rid,support,source)。"""
        raw = (text or "").strip()
        if not raw:
            return {"reply": "你说话呀，我在听呢。", "new_name": None,
                    "delta": (0, 0), "rid": "empty", "support": None, "source": "local"}

        level = pet_chat.crisis_level(raw)
        if level:
            return {"reply": pet_chat.CRISIS_REPLY[level], "new_name": None,
                    "delta": (0, 2), "rid": "crisis", "support": None, "source": "local"}

        new_name = self._extract_facts(raw, user_name)
        intent = self._intent(raw)
        support = pet_chat.support_kind(raw) if intent != "crisis" else None
        local = self._compose_local(raw, pet_name, user_name, emotion, intent)

        source = "local"
        reply_text = local
        if online and intent not in ("crisis",):
            remote = self._llm_call(raw, pet_name, user_name, emotion, cfg)
            if remote:
                reply_text = remote
                source = "llm"

        self.remember("user", raw)
        self.remember("assistant", reply_text)
        self.state["count"] = int(self.state.get("count", 0)) + 1
        self.save()

        delta = pet_chat.RID_DELTA.get(intent, (0, 0))
        if intent == "emotion":
            delta = (-1, 2) if _sentiment(raw) <= 0 else (3, 2)
        if intent == "affection":
            delta = (7, 5)
        if intent == "preference":
            delta = (2, 2)
        if intent == "question":
            delta = (1, 1)
        return {"reply": reply_text, "new_name": new_name, "delta": delta,
                "rid": intent, "support": support, "source": source}
