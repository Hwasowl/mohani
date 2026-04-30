; Mohani Setup (Mohani-Setup.exe) — 친구가 한 번만 받아 실행하는 설치 프로그램
; 더블클릭 시:
;   1. Node.js 20+ 검사
;   2. 기존 mohani 프로세스 모두 정리 (kill-mohani.ps1)
;   3. npm install -g mohani@latest
;   4. Mohani.exe + launch.vbs + kill-mohani.ps1 을 INSTDIR에 배치
;   5. 시작메뉴 / 바탕화면 단축키 생성 → Mohani.exe 가리킴
;   6. launch.vbs 직접 실행 (이번엔 중복 npm install 회피)
;
; 빌드 전 mohani-launcher.nsi 를 먼저 빌드해서 Mohani.exe 가 같은 디렉토리에 있어야 함.

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
VIAddVersionKey "LegalCopyright" "MIT License"
VIAddVersionKey "FileVersion" "0.1.0"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Section "Install"
  SetOutPath "$INSTDIR"

  ; ─── 1. Node.js 검사 ────────────────────────────────────────────
  DetailPrint "Node.js 설치 여부 확인 중..."
  nsExec::ExecToStack 'where node'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Mohani를 실행하려면 Node.js 20 이상이 필요합니다.$\n$\n[확인]을 누르면 다운로드 페이지를 엽니다." \
      IDOK openNodeSite IDCANCEL abortInstall
    openNodeSite:
      ExecShell "open" "https://nodejs.org/ko/download"
    abortInstall:
      Abort
  ${EndIf}
  DetailPrint "Node.js 확인됨."

  ; ─── 2. 기존 mohani 프로세스 정리 (kill-mohani.ps1) ──────────
  ; -IncludeLauncher : Mohani.exe 까지 같이 죽임 (재설치 시 파일 락 해제 위해 필요)
  DetailPrint "기존 Mohani 프로세스 정리 중..."
  File "kill-mohani.ps1"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\kill-mohani.ps1" -IncludeLauncher'

  ; ─── 3. npm 으로 mohani 최신 버전 설치 ─────────────────────────
  DetailPrint "Mohani 최신 버전 설치 중... (이미 최신이면 즉시 통과)"
  nsExec::ExecToStack 'cmd.exe /c npm install -g mohani@latest 2^>^&1'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "설치 실패 (exit $0):$\n$\n$1"
    Abort
  ${EndIf}
  DetailPrint "Mohani 설치 완료."

  ; ─── 4. Mohani.exe + launch.vbs 배치 ──────────────────────────
  DetailPrint "Mohani.exe 설치 중..."
  File "Mohani.exe"
  File "launch.vbs"

  ; ─── 5. 시작메뉴 / 바탕화면 단축키 ────────────────────────────
  DetailPrint "단축키 생성 중..."
  CreateShortcut "$SMPROGRAMS\Mohani.lnk" "$INSTDIR\Mohani.exe" "" "$INSTDIR\Mohani.exe" 0
  CreateShortcut "$DESKTOP\Mohani.lnk" "$INSTDIR\Mohani.exe" "" "$INSTDIR\Mohani.exe" 0

  ; ─── 6. launch.vbs 직접 실행 (Mohani.exe 우회 — 방금 install했으니 중복 npm 회피) ─
  DetailPrint "Mohani 실행..."
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\launch.vbs"'

  Sleep 800
SectionEnd
