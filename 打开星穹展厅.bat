@echo off
cd /d "%~dp0"
python "%~dp0open_page.py" "showcase/index.html" 2>nul
if errorlevel 1 start "" "%~dp0showcase\index.html"
exit
