@echo off
rem 静默启动：真正的启动逻辑在 VBS 里（隐藏窗口，不弹终端黑框）。
rem 这一行把 cmd 窗口的存活时间压到最短，然后立即退出。
start "" wscript.exe "%~dp0启动桌宠.vbs" pet
exit /b 0
