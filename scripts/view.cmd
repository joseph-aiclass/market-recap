@echo off
REM view.cmd — open the dashboard without typing a command.
REM Starts a local static server if one isn't already running, then opens the
REM browser. The server window stays minimized; close it to stop serving.

setlocal
cd /d "%~dp0.."
chcp 65001 >nul

set "PORT=8080"
if not "%~1"=="" set "PORT=%~1"
set "URL=http://127.0.0.1:%PORT%/"
set "PROBE=%URL%data/latest.json"

REM 1. Already serving this dashboard? Just open it.
powershell -NoProfile -Command "try { if ((Invoke-WebRequest '%PROBE%' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { exit 0 } } catch { }; exit 1"
if not errorlevel 1 (
  echo Dashboard already running at %URL%
  start "" "%URL%"
  exit /b 0
)

REM 2. Find a Python 3 to run the static server.
where py >nul 2>&1 && set "PYEXE=py"
if not defined PYEXE (
  where python >nul 2>&1 && set "PYEXE=python"
)
if not defined PYEXE (
  echo Python 3 was not found on PATH.
  echo Install Python 3, or serve this folder with any static file server.
  echo.
  pause
  exit /b 1
)

REM 3. Start it minimized, in this folder, so data/latest.json is reachable.
start "Market Recap server - close this window to stop" /min cmd /c "%PYEXE% -m http.server %PORT%"

REM 4. Wait for the port to answer before opening the browser.
powershell -NoProfile -Command "$u='%PROBE%'; for ($i=0; $i -lt 25; $i++) { try { if ((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200) { exit 0 } } catch { }; Start-Sleep -Milliseconds 400 }; exit 1"
if errorlevel 1 (
  echo Started the server but it did not answer at %URL%
  echo If port %PORT% is taken by another app, close that app and run this again.
  echo.
  pause
  exit /b 1
)

start "" "%URL%"
exit /b 0
