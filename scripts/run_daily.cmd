@echo off
REM run_daily.cmd - entry point the scheduled task calls at 07:00 HKT.
REM Runs fetch_data.mjs, logs the run, then publishes the refreshed snapshot
REM to GitHub Pages. Uses labels (not nested if-blocks) because cmd.exe is
REM unreliable with multi-line parenthesised blocks.
REM Exit code passes through: 1 means the run was degraded (see fetch_data.mjs).
REM NOTE: every redirection below keeps a space before ">>" so cmd.exe does not
REM mistake a trailing digit (e.g. exit 0) for a stream handle.

setlocal
cd /d "%~dp0.."
chcp 65001 >nul

if not exist "logs" mkdir "logs"

echo. >> "logs\fetch.log"
echo [%DATE% %TIME%] run start >> "logs\fetch.log"

node "scripts\fetch_data.mjs" >> "logs\fetch.log" 2>&1
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" echo [%DATE% %TIME%] DEGRADED RUN, exit %CODE% >> "logs\fetch.log"

REM Never publish a degraded snapshot: partial data is worse than yesterday's.
if not "%CODE%"=="0" goto degraded

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto nogit

git add -A >> "logs\fetch.log" 2>&1
git diff --cached --quiet
if not errorlevel 1 goto nochange

git commit -m "data: daily recap refresh %DATE% %TIME%" >> "logs\fetch.log" 2>&1
if errorlevel 1 goto commitfail

git push origin main >> "logs\fetch.log" 2>&1
if errorlevel 1 goto pushfail

echo [%DATE% %TIME%] published to GitHub Pages >> "logs\fetch.log"
goto end

:degraded
echo [%DATE% %TIME%] degraded run, snapshot not published >> "logs\fetch.log"
goto end

:nogit
echo [%DATE% %TIME%] git unavailable, skipping publish >> "logs\fetch.log"
goto end

:nochange
echo [%DATE% %TIME%] no changes to publish >> "logs\fetch.log"
goto end

:commitfail
echo [%DATE% %TIME%] commit failed, skipping push >> "logs\fetch.log"
goto end

:pushfail
echo [%DATE% %TIME%] push failed, will retry next run >> "logs\fetch.log"
goto end

:end
echo [%DATE% %TIME%] run end, exit code %CODE% >> "logs\fetch.log"
exit /b %CODE%
