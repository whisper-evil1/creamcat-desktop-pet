# -*- coding: utf-8 -*-
"""星宠语 · 桌宠语音（edge-tts 合成 + Windows MCI 播放）。

设计要点：
  - 合成在后台线程跑，不阻塞 tkinter 主线程；
  - 合成结果按「文本+音色+参数」哈希缓存到 assets/voice_cache/，重复台词不再联网；
  - 播放用 Windows 自带 winmm.mciSendStringW，零额外依赖，不需要 ffmpeg；
  - 断网或 edge-tts 不可用时静默降级（气泡照常显示），不影响桌宠主流程。
"""
import asyncio
import ctypes
import hashlib
import os
import threading
from ctypes import wintypes

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(ROOT, "assets", "voice_cache")

# 音色：晓晓——温柔自然的女声；略降速、微升调，听感更甜
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-5%"
PITCH = "+2Hz"
VOLUME = "+0%"

_ALIAS = "creamcat_voice"
_winmm = None
try:
    _winmm = ctypes.WinDLL("winmm", use_last_error=True)
    _winmm.mciSendStringW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.UINT, wintypes.HWND
    ]
    _winmm.mciSendStringW.restype = wintypes.UINT
except Exception:
    _winmm = None


def _mci(cmd):
    if _winmm is None:
        return 1
    buf = ctypes.create_unicode_buffer(256)
    return _winmm.mciSendStringW(cmd, buf, 256, 0)


def _cache_path(text, voice=VOICE, rate=RATE, pitch=PITCH):
    key = f"{voice}|{rate}|{pitch}|{text}"
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
    return os.path.join(CACHE_DIR, h + ".mp3")


class VoiceEngine:
    """每只桌宠一个实例。所有失败都吞掉，只通过 callback(ok) 告知结果。"""

    def __init__(self, root):
        self.root = root
        self.enabled = True
        self._gen = 0            # 请求代号：新请求让旧结果作废，避免抢话
        self._playing = False

    async def _synth(self, text, path):
        import edge_tts
        comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH, volume=VOLUME)
        await comm.save(path)

    def speak(self, text, callback=None):
        """后台合成并播放。callback(ok) 会被切回主线程调用。"""
        if not self.enabled or not text or not text.strip():
            if callback:
                self.root.after(0, lambda: callback(False))
            return
        # 气泡是短句；换行改逗号、限长，避免长文本合成超时
        text = text.replace("\n", "，").strip()[:180]
        self._gen += 1
        gen = self._gen
        path = _cache_path(text)

        def worker():
            try:
                if not os.path.exists(path):
                    os.makedirs(CACHE_DIR, exist_ok=True)
                    asyncio.run(asyncio.wait_for(self._synth(text, path), 25))
                ok = True
            except Exception:
                ok = False            # 断网 / 未装 edge-tts：静默降级
            if gen != self._gen:
                return
            if ok:
                ok = self._play(path)
            if callback:
                self.root.after(0, lambda: callback(ok))

        threading.Thread(target=worker, daemon=True).start()

    def _play(self, path):
        self.stop()
        try:
            if _mci(f'open "{path}" type mpegvideo alias {_ALIAS}') != 0:
                return False
            self._playing = True
            if _mci(f"play {_ALIAS}") != 0:
                self.stop()
                return False
            return True
        except Exception:
            return False

    def stop(self):
        try:
            if self._playing:
                _mci(f"stop {_ALIAS}")
                _mci(f"close {_ALIAS}")
                self._playing = False
        except Exception:
            pass

    def shutdown(self):
        self.enabled = False
        self._gen += 1
        self.stop()
