@echo off
setlocal
set "NODE_DIR=C:\Users\DoungDucThang\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] Starte sync-axonity-produktion >> logs\sync-produktion.log
echo ---- sync-axonity-produktion startet - Fortschritt erscheint hier UND in logs\sync-produktion.log ----
powershell -NoProfile -Command "node src\sync-axonity-produktion.js | ForEach-Object { $_; Add-Content -Path 'logs\sync-produktion.log' -Value $_ -Encoding UTF8 }; exit $LASTEXITCODE"
echo [%date% %time%] Ende, Exit-Code %errorlevel% >> logs\sync-produktion.log
echo. >> logs\sync-produktion.log
