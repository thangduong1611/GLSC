@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%date% %time%] ══ Startup-Catchup: alle vier Sync-Skripte ══ >> logs\catchup.log

rem Reihenfolge bewusst: welo-personal + umsatz zuerst (schnell, stabil),
rem die zwei Axonity-Skripte zuletzt (aktuell instabil/langsam bei Fehlern
rem mit Retries) — so haengt wichtige Mitarbeiterdaten nicht hinter kaputten
rem Axonity-Laeufen fest, falls die Session vorher endet.
call run-sync-welo-personal.bat
call run-sync-umsatz.bat
call run-sync-produktion.bat
call run-sync-bestellungen.bat

echo [%date% %time%] ══ Startup-Catchup fertig ══ >> logs\catchup.log
echo. >> logs\catchup.log
