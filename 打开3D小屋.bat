@echo off
cd /d "%~dp0"
python "%~dp0open_page.py" "room3d/index.html" 2>nul
if errorlevel 1 start "" "%~dp0room3d\index.html"
exit
