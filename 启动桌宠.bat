@echo off
cd /d "%~dp0"
rem 优先用 py -3 对应的 pythonw，避免弹出黑色控制台窗口
set "PYW="
for /f "delims=" %%i in ('py -3 -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2^>nul') do if not defined PYW set "PYW=%%i"
if not exist "%PYW%" set "PYW=pythonw"
rem 只启动一个实例（宠物由 config.json 记住，不再传 --pet）
start "" "%PYW%" "%~dp0pet_app.py"
exit
