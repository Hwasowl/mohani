@echo off
title Mohani Install
echo === Mohani Install ===
echo.
echo If Mohani is currently running, please close it first.
echo (Close the Mohani UI window and the start.bat console.)
echo.
pause
echo.

echo Step 1: Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20+ required.
  echo Download from: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
echo Node.js found.
echo.

echo Step 2: Installing mohani...
call npm install -g mohani
if errorlevel 1 (
  echo.
  echo [ERROR] Install failed. See messages above.
  echo If "EBUSY" was shown: Mohani is still running. Close it and re-run.
  echo.
  pause
  exit /b 1
)

echo.
echo === Install complete ===
echo Now double-click mohani-start.bat to launch Mohani.
echo.
pause
