@echo off
setlocal
set "NODE_DIR=C:\Users\DoungDucThang\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
if not exist logs mkdir logs
set "NODE_EXTRA_CA_CERTS=%~dp0certs\globalsign-gcc-r6-alphassl-ca-2025.pem"
echo [%date% %time%] Starte sync-welo-umsatz >> logs\sync-umsatz.log
echo ---- sync-welo-umsatz startet - Fortschritt erscheint hier UND in logs\sync-umsatz.log ----
powershell -NoProfile -Command "node src\sync-welo-umsatz.js | ForEach-Object { $_; Add-Content -Path 'logs\sync-umsatz.log' -Value $_ -Encoding UTF8 }; exit $LASTEXITCODE"
echo [%date% %time%] Ende, Exit-Code %errorlevel% >> logs\sync-umsatz.log
echo. >> logs\sync-umsatz.log
