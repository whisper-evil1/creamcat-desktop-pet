@echo off
cd /d "%~dp0"
python "%~dp0open_page.py" "house2d/index.html" 2>nul
if errorlevel 1 start "" "%~dp0house2d\index.html"
exit
