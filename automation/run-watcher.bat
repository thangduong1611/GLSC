@echo off
setlocal
set "NODE_DIR=C:\Users\DoungDucThang\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
title GLSC Filial Radar - Watcher (bitte offen lassen)
node src\watch-and-sync.js
pause
