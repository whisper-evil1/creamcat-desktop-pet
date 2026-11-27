@echo off
cd /d "%~dp0"
echo ==== 打开环境检查 ====
python "%~dp0open_page.py" --check
echo.
echo 如果上面显示“可用浏览器”却还是打不开，用本地服务方式再试：
echo     python open_page.py --serve room3d/index.html
echo.
pause
