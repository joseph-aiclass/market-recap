@echo off
REM run_daily.cmd — the entry point the scheduled task calls at 07:00 HKT.
REM Wraps fetch_data.mjs so every run leaves a line in logs\fetch.log, then
REM publishes the refreshed snapshot to GitHub Pages.
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

if not "%CODE%"=="0" (
  echo [%DATE% %TIME%] DEGRADED RUN, exit %CODE% >> "logs\fetch.log"
)

REM --- publish to GitHub Pages -------------------------------------------
REM Only when the data actually changed. A failed push must never block the
REM next run, so failures are logged and the script still exits with CODE.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] git not available, skipping publish >> "logs\fetch.log"
) else (
  git add -A >> "logs\fetch.log" 2>&1
  git diff --cached --quiet
  if errorlevel 1 (
    git commit -m "data: daily recap refresh %DATE% %TIME%" >> "logs\fetch.log" 2>&1
    if errorlevel 1 (
      echo [%DATE% %TIME%] commit failed, skipping push >> "logs\fetch.log"
    ) else (
      git push origin main >> "logs\fetch.log" 2>&1
      if errorlevel 1 (
        echo [%DATE% %TIME%] push failed, will retry next run >> "logs\fetch.log"
      ) else (
        echo [%DATE% %TIME%] published to GitHub Pages >> "logs\fetch.log"
      )
    )
  ) else (
    echo [%DATE% %TIME%] no changes to publish >> "logs\fetch.log"
  )
)

echo [%DATE% %TIME%] run end, exit %CODE% >> "logs\fetch.log"
exit /b %CODE%
