@echo off
REM Roja Clinic on this computer: double-click to start it and open it in the browser.
REM It serves this folder at http://127.0.0.1:4174 (tools\preview.cjs); the camera
REM works there because a browser trusts its own computer. Nothing leaves the laptop.
title Roja Clinic
cd /d "%~dp0"
set "PORT=4174"
set "URL=http://127.0.0.1:%PORT%/"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install the LTS version from https://nodejs.org
  echo   then double-click start-clinic.cmd again.
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

REM Already running in another window: just open it.
netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  call :open
  exit /b 0
)

echo.
echo   Roja Clinic is running at  %URL%
echo.
echo   Keep this window open while you use it.
echo   Close it (or press Ctrl+C) to stop.
echo.

REM The browser a moment after the server is listening: Chrome if it is installed,
REM otherwise the default browser.
start /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; try { Start-Process chrome '%URL%' -ErrorAction Stop } catch { Start-Process '%URL%' }"

node tools\preview.cjs

echo.
echo   Roja Clinic stopped.
pause
exit /b 0

:open
powershell -NoProfile -WindowStyle Hidden -Command "try { Start-Process chrome '%URL%' -ErrorAction Stop } catch { Start-Process '%URL%' }"
exit /b 0
