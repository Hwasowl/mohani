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
