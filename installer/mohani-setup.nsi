; Mohani-Setup.exe — npm i -g mohani 한 번 + 단축키 + 첫 실행.

!include "MUI2.nsh"

Name "Mohani Setup"
OutFile "Mohani-Setup.exe"
Unicode True
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Mohani"
ShowInstDetails show

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani Setup"
VIAddVersionKey "FileVersion" "0.1.0"

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Section
  SetOutPath "$INSTDIR"

  DetailPrint "npm install -g mohani"
  nsExec::Exec 'cmd.exe /c npm install -g mohani > "$TEMP\mohani-install.log" 2>&1'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK "npm install 실패. %TEMP%\mohani-install.log 참고."
    Abort
  ${EndIf}

  File "Mohani.exe"
  File "launch.vbs"

  CreateShortcut "$SMPROGRAMS\Mohani.lnk" "$INSTDIR\Mohani.exe" "" "$INSTDIR\Mohani.exe" 0
  CreateShortcut "$DESKTOP\Mohani.lnk"    "$INSTDIR\Mohani.exe" "" "$INSTDIR\Mohani.exe" 0

  DetailPrint "설치 완료. 시작메뉴/바탕화면의 Mohani 단축키로 실행하세요."
SectionEnd
