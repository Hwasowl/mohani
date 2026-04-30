; Mohani 일상 런처 (Mohani.exe)
; 더블클릭 시:
;   1. npm install -g mohani@latest 실행 (이미 최신이면 즉시 통과, ~1초)
;   2. wscript로 launch.vbs 호출 → 콘솔 없이 mohani start
;   3. 즉시 종료
;
; SilentInstall silent → NSIS 인스톨 UI 안 뜸 (에러 시에만 메시지)
; launch.vbs는 Mohani.exe와 같은 디렉토리에 있어야 함 (Setup.exe가 같이 배포)

!include "LogicLib.nsh"

Name "Mohani"
OutFile "Mohani.exe"
SilentInstall silent
RequestExecutionLevel user
Unicode True

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani"
VIAddVersionKey "FileDescription" "Mohani"
VIAddVersionKey "FileVersion" "0.1.0"
VIAddVersionKey "LegalCopyright" "MIT License"

Section
  ; ─── 1. 최신 버전 자동 업데이트 ─────────────────────────────
  ; npm install이 같은 버전이면 ~1초, 새 버전이면 ~5~10초.
  ; 실패해도 (오프라인 등) 기존 버전으로 그냥 실행 시도.
  nsExec::ExecToStack 'cmd.exe /c npm install -g mohani@latest 2^>^&1'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "Mohani 자동 업데이트 실패 (계속 진행):$\n$\n$1$\n$\n기존 버전으로 시작합니다."
  ${EndIf}

  ; ─── 2. mohani start 무콘솔 실행 ───────────────────────────
  ; launch.vbs는 Mohani.exe 와 같은 디렉토리.
  ${IfNot} ${FileExists} "$EXEDIR\launch.vbs"
    MessageBox MB_OK|MB_ICONSTOP \
      "launch.vbs를 찾을 수 없습니다.$\nMohani-Setup.exe를 다시 실행해주세요."
    Abort
  ${EndIf}
  Exec '"$SYSDIR\wscript.exe" "$EXEDIR\launch.vbs"'
SectionEnd
