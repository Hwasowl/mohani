@echo off
chcp 65001 >nul
title Mohani 설치
echo === Mohani 설치 ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20 이상이 필요합니다.
  echo https://nodejs.org/ko/download 에서 LTS 다운로드 후 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

echo Node.js 확인됨.
echo npm install -g mohani 실행 중...
echo.
call npm install -g mohani
if errorlevel 1 (
  echo.
  echo [ERROR] 설치 실패. 위 메시지 확인.
  echo.
  pause
  exit /b 1
)

echo.
echo === 설치 완료 ===
echo mohani-start.bat 을 더블클릭하면 Mohani가 시작됩니다.
echo.
pause
