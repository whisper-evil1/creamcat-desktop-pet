# -*- coding: utf-8 -*-
"""后台启动桌宠：用 DETACHED_PROCESS 真正脱离当前终端，关掉终端也不会退出。

用法： py -3 tools/launch.py [宠物id]
不带宠物 id 时沿用 config.json 里记住的那只。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYW = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
if not os.path.exists(PYW):
    PYW = sys.executable
args = [PYW, os.path.join(ROOT, "pet_app.py")]
if len(sys.argv) > 1:
    args += ["--pet", sys.argv[1]]

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
log = open(os.path.join(ROOT, "debug", "launch.log"), "w", encoding="utf-8")
subprocess.Popen(args, cwd=ROOT, close_fds=True, stdout=log, stderr=log,
                 creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
print("launched:", " ".join(args))
