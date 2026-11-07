@echo off
REM run_daily.cmd — the entry point a scheduler calls at 07:00 HKT.
REM Wraps fetch_data.mjs so every run leaves a line in logs/fetch.log.
REM Appends, never truncates, so a history of runs survives.
REM Exit code is passed through: 1 means the run was degraded (see fetch_data.mjs).

setlocal
cd /d "%~dp0.."
chcp 65001 >nul

if not exist "logs" mkdir "logs"

echo. >> "logs\fetch.log"
echo [%DATE% %TIME%] run start >> "logs\fetch.log"

node "scripts\fetch_data.mjs" >> "logs\fetch.log" 2>&1
set "CODE=%ERRORLEVEL%"

echo [%DATE% %TIME%] run end, exit %CODE% >> "logs\fetch.log"

if not "%CODE%"=="0" (
  echo [%DATE% %TIME%] DEGRADED RUN, exit %CODE% >> "logs\fetch.log"
)

exit /b %CODE%
