; Mohani.exe — 진행창 보이는 런처. 모든 로직은 mohani-run.ps1.
; 더블클릭 → 작은 진행 창 + 단계별 로그 → 완료 시 창 자동 종료 → mohani 창만 남음.

!include "MUI2.nsh"

Name "Mohani"
OutFile "Mohani.exe"
Unicode True
RequestExecutionLevel user
ShowInstDetails show
BrandingText "Mohani"
AutoCloseWindow true       ; 완료 시 자동 닫힘 (Finish 버튼 X)

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani"
VIAddVersionKey "FileDescription" "Mohani"
VIAddVersionKey "FileVersion" "0.1.0"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Section
  IfFileExists "$EXEDIR\mohani-run.ps1" run notFound
  notFound:
    MessageBox MB_OK|MB_ICONSTOP \
      "mohani-run.ps1을 찾을 수 없습니다 ($EXEDIR).$\nMohani-Setup.exe를 다시 실행해주세요."
    Abort

  run:
    DetailPrint "Mohani 시작 중..."
    ; nsExec::ExecToLog 가 PowerShell 출력을 그대로 진행창에 보여줌
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$EXEDIR\mohani-run.ps1"'
    Pop $0
    DetailPrint "exit code: $0"
SectionEnd
