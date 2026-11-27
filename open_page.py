# -*- coding: utf-8 -*-
"""统一的网页打开器。

为什么不用 os.startfile：.html 的系统关联可能被装机软件改成下载器 / 编辑器 /
很老的 IE，表现就是「点了没反应」「白屏」「变成下载」。这里直接点名 Chrome / Edge，
找不到才退回系统默认。

用法：
    python open_page.py room3d/index.html
    python open_page.py --check            # 只打印诊断信息，不开页
"""

import os
import subprocess
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))

# 按优先级排：能跑 WebGL 的都在前面
CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\EdgeWebView\Application\msedge.exe",
]


def find_browsers():
    out = []
    for p in CANDIDATES:
        if p and os.path.exists(p) and p not in out:
            out.append(p)
    return out


def to_url(path):
    p = os.path.abspath(path).replace("\\", "/")
    if not p.startswith("/"):
        p = "/" + p
    # 只转义真正会出问题的字符，保留中文
    for ch, rep in ((" ", "%20"), ("#", "%23"), ("?", "%3F")):
        p = p.replace(ch, rep)
    return "file://" + p


def open_page(relpath, new_window=False):
    """打开 ROOT 下的页面，返回 (是否成功, 用的方式)。

    relpath 支持 "showcase/home.html" 这种正斜杠写法。
    """
    page = os.path.join(ROOT, *relpath.replace("\\", "/").split("/"))
    if not os.path.exists(page):
        return False, "文件不存在：" + page

    url = to_url(page)
    args = ["--new-window"] if new_window else []

    for exe in find_browsers():
        try:
            # Chrome/Edge 多实例时会把手上的参数转给已有进程，正常会开新标签
            subprocess.Popen([exe] + args + [url], close_fds=True)
            return True, os.path.basename(exe)
        except Exception:
            continue

    # 没有 Chrome/Edge 才走系统默认（可能被关联到奇怪的程序）
    try:
        if hasattr(os, "startfile"):
            os.startfile(page)
        else:
            webbrowser.open(url)
        return True, "系统默认程序"
    except Exception as e:
        return False, "打开失败：" + str(e)


def serve_and_open(relpath, port=8765):
    """兜底方案：起一个本地 http 服务再打开。

    少数电脑上浏览器策略会拦 file:// 的本地资源，这时用 http 打开一定能过。
    """
    page = os.path.join(ROOT, *relpath.replace("\\", "/").split("/"))
    if not os.path.exists(page):
        return False, "文件不存在：" + page

    url = "http://127.0.0.1:%d/%s" % (port, relpath.replace("\\", "/"))

    # 已经在跑就不再起第二个
    import socket
    probe = socket.socket()
    probe.settimeout(0.35)
    alive = probe.connect_ex(("127.0.0.1", port)) == 0
    probe.close()

    if not alive:
        kwargs = {}
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            subprocess.Popen(
                [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **kwargs
            )
        except Exception as e:
            return False, "本地服务起不来：" + str(e)
        import time
        for _ in range(20):
            s = socket.socket()
            s.settimeout(0.2)
            ok = s.connect_ex(("127.0.0.1", port)) == 0
            s.close()
            if ok:
                break
            time.sleep(0.15)

    for exe in find_browsers():
        try:
            subprocess.Popen([exe, url], close_fds=True)
            return True, os.path.basename(exe) + " + 本地服务 :%d" % port
        except Exception:
            continue

    try:
        webbrowser.open(url)
        return True, "系统默认程序 + 本地服务 :%d" % port
    except Exception as e:
        return False, "打开失败：" + str(e)


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0

    if args[0] in ("--check", "-c"):
        print("项目目录 :", ROOT)
        bs = find_browsers()
        print("可用浏览器:", bs if bs else "未找到 Chrome / Edge（会退回系统默认）")
        for rel in ("showcase/home.html", "showcase/index.html", "room3d/index.html"):
            page = os.path.join(ROOT, *rel.split("/"))
            print("  {:<24} {}".format(rel, "OK" if os.path.exists(page) else "缺失"))
        return 0

    if "--serve" in args:
        rel = args[0]
        ok, how = serve_and_open(rel)
        print(("已用 %s 打开 http://127.0.0.1:8765/%s" % (how, rel)) if ok else how)
        return 0 if ok else 1

    ok, how = open_page(args[0], new_window="--new" in args)
    print(("已用 %s 打开 %s" % (how, args[0])) if ok else how)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
