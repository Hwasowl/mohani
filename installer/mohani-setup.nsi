; Mohani Setup (Mohani-Setup.exe) — 첫 설치 + 단축키 생성.
; 더블클릭 시:
;   1. Node.js 20+ 검사
;   2. mohani-run.ps1 -ForceKill -SkipLaunch : 기존 mohani 모두 정리
;   3. npm install -g mohani@latest
;   4. Mohani.exe + launch.vbs + mohani-run.ps1 을 INSTDIR에 배치
;   5. 시작메뉴 / 바탕화면 단축키 생성 → Mohani.exe 가리킴
;   6. wscript launch.vbs : 정상 흐름으로 mohani 실행

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Mohani Setup"
OutFile "Mohani-Setup.exe"
Unicode True
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Mohani"
ShowInstDetails show
BrandingText "Mohani"

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani Setup"
VIAddVersionKey "FileDescription" "Mohani 설치 프로그램"
VIAddVersionKey "FileVersion" "0.1.0"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Section "Install"
  SetOutPath "$INSTDIR"

  ; 1. Node.js 검사
  DetailPrint "Node.js 확인 중..."
  nsExec::ExecToStack 'where node'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Node.js 20 이상이 필요합니다.$\n[확인]을 누르면 다운로드 페이지를 엽니다." \
      IDOK openSite IDCANCEL abortInstall
    openSite:
      ExecShell "open" "https://nodejs.org/ko/download"
    abortInstall:
      Abort
  ${EndIf}

  ; 2. mohani-run.ps1 배치 후 -ForceKill -SkipLaunch 로 사전 정리
  File "mohani-run.ps1"
  DetailPrint "기존 Mohani 프로세스 정리 중..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\mohani-run.ps1" -ForceKill -SkipLaunch'

  ; 3. npm install
  DetailPrint "Mohani 설치 중..."
  nsExec::Exec 'cmd.exe /c npm install -g mohani@latest > "$TEMP\mohani-install.log" 2>&1'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP \
      "Mohani 설치 실패 (exit $0).$\n자세한 내용: %TEMP%\mohani-install.log"
    Abort
  ${EndIf}
  DetailPrint "Mohani 설치 완료."

  ; 4. 런처 파일 배치
  DetailPrint "런처 파일 배치 중..."
  File "Mohani.exe"
  File "launch.vbs"

  ; 5. 단축키
  DetailPrint "단축키 생성 중..."
  CreateShortcut "$SMPROGRAMS\Mohani.lnk" "$INSTDIR\Mohani.exe" "" "$INSTDIR\Mohani.exe" 0
  CreateShortcut "$DESKTOP\Mohani.lnk" "$INSTDIR\Mohani.exe" "" "$INSTDIR\Mohani.exe" 0

  ; 6. mohani 실행 (정상 플로우)
  DetailPrint "Mohani 실행..."
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\launch.vbs"'

  Sleep 800
SectionEnd
