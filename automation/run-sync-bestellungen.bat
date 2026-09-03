@echo off
setlocal
set "NODE_DIR=C:\Users\DoungDucThang\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] Starte sync-axonity-bestellungen >> logs\sync-bestellungen.log
echo ---- sync-axonity-bestellungen startet - Fortschritt erscheint hier UND in logs\sync-bestellungen.log ----
powershell -NoProfile -Command "node src\sync-axonity-bestellungen.js | ForEach-Object { $_; Add-Content -Path 'logs\sync-bestellungen.log' -Value $_ -Encoding UTF8 }; exit $LASTEXITCODE"
echo [%date% %time%] Ende, Exit-Code %errorlevel% >> logs\sync-bestellungen.log
echo. >> logs\sync-bestellungen.log
