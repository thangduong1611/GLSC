@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] == Startup-Catchup: alle vier Sync-Skripte == >> logs\catchup.log
echo ==== GLSC Filial Radar - Catchup (4 Sync-Skripte) ====
echo Fenster bitte offen lassen - jedes Skript zeigt seinen Fortschritt direkt hier.
echo.

rem Reihenfolge bewusst: welo-personal + umsatz zuerst (schnell, stabil),
rem die zwei Axonity-Skripte zuletzt (aktuell instabil/langsam bei Fehlern
rem mit Retries) - so haengt wichtige Mitarbeiterdaten nicht hinter kaputten
rem Axonity-Laeufen fest, falls die Session vorher endet.
echo [1/4] sync-welo-personal (Mitarbeiter, Urlaub, Tagesziel)...
call run-sync-welo-personal.bat
echo.
echo [2/4] sync-welo-umsatz...
call run-sync-umsatz.bat
echo.
echo [3/4] sync-axonity-produktion...
call run-sync-produktion.bat
echo.
echo [4/4] sync-axonity-bestellungen...
call run-sync-bestellungen.bat

echo [%date% %time%] == Startup-Catchup fertig == >> logs\catchup.log
echo. >> logs\catchup.log
echo.
echo ==== Alle 4 Sync-Skripte fertig. Dieses Fenster kann jetzt geschlossen werden. ====
pause
