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

echo Stopping running Mohani processes (only mohani-related node/electron)...
powershell -NoProfile -Command "Get-Process electron,node -EA SilentlyContinue | Where-Object { $_.Path -match 'mohani' } | Stop-Process -Force -EA SilentlyContinue"
timeout /t 1 /nobreak >nul
echo OK
echo.

echo Running: npm install -g mohani
echo.
call npm install -g mohani
if errorlevel 1 (
  echo.
  echo [ERROR] Install failed. See messages above.
  echo If EBUSY: close Mohani UI window, then re-run this bat.
  echo.
  pause
  exit /b 1
)

echo.
echo === Install complete ===
echo Run mohani-start.bat to launch Mohani.
echo.
pause
