@echo off
title Mohani Install
echo === Mohani Install ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20+ required.
  echo Download: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
echo Node.js OK
echo.

powershell -NoProfile -Command "if (Get-Process electron,node -EA SilentlyContinue | Where-Object { $_.Path -match 'mohani' }) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo [WARN] Mohani is currently running.
  echo Please close the Mohani window (and the start.bat console) first,
  echo then re-run this installer.
  echo.
  pause
  exit /b 1
)

echo Running: npm install -g mohani
echo.
call npm install -g mohani
if errorlevel 1 (
  echo.
  echo [ERROR] Install failed. See messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo === Install complete ===
echo Run mohani-start.bat to launch Mohani.
echo.
pause
