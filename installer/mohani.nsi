; Mohani 부트스트랩 런처
; 더블클릭 → Node 검사 → npm으로 mohani 최신 버전 설치/업데이트 → mohani 실행
;
; 빌드: makensis mohani.nsi  (Linux/Windows 양쪽 가능)
; 산출물: Mohani-Setup.exe (~1.5MB)

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Mohani"
OutFile "Mohani-Setup.exe"
Unicode True
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Mohani"
ShowInstDetails show
BrandingText "Mohani Launcher"

; 추후 .ico 추가 시 활성화
; Icon "icon.ico"

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani Launcher"
VIAddVersionKey "FileDescription" "Mohani 자동 설치/실행 런처"
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
      "Mohani를 실행하려면 Node.js 20 이상이 필요합니다.$\n$\n[확인]을 누르면 설치 페이지를 엽니다." \
      IDOK openNodeSite IDCANCEL abortInstall
    openNodeSite:
      ExecShell "open" "https://nodejs.org/ko/download"
    abortInstall:
      Abort
  ${EndIf}
  DetailPrint "Node.js 확인됨."

  ; ─── 2. mohani 최신 버전 설치/업데이트 ────────────────────────
  DetailPrint "Mohani 최신 버전 설치 중... (이미 최신이면 즉시 통과)"
  nsExec::ExecToLog 'cmd.exe /c npm install -g mohani@latest'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP \
      "Mohani 설치에 실패했습니다.$\n$\n네트워크 연결 또는 npm 권한을 확인해주세요.$\n명령: npm install -g mohani@latest"
    Abort
  ${EndIf}
  DetailPrint "Mohani 설치/업데이트 완료."

  ; ─── 3. 시작메뉴 단축키 (한 번만 생성) ────────────────────────
  ${IfNot} ${FileExists} "$SMPROGRAMS\Mohani.lnk"
    DetailPrint "시작메뉴 단축키 생성 중..."
    CreateShortcut "$SMPROGRAMS\Mohani.lnk" "$EXEPATH" "" "$EXEPATH" 0
  ${EndIf}

  ; ─── 4. mohani 실행 ────────────────────────────────────────────
  DetailPrint "Mohani 실행..."
  Exec '"$SYSDIR\cmd.exe" /c start "" /B mohani'

  ; 짧게 대기 후 종료 — 사용자가 진행 로그를 잠깐 볼 수 있게
  Sleep 800
SectionEnd
