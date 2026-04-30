; Mohani 일상 런처 (Mohani.exe) — 모든 로직은 mohani-run.ps1 에 있음.
; 더블클릭 → wscript launch.vbs → powershell mohani-run.ps1 (hidden)

Name "Mohani"
OutFile "Mohani.exe"
SilentInstall silent
RequestExecutionLevel user
Unicode True

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani"
VIAddVersionKey "FileDescription" "Mohani"
VIAddVersionKey "FileVersion" "0.1.0"

Section
  ; launch.vbs 가 같은 디렉토리에 있어야 함 (Setup.exe가 같이 배포)
  IfFileExists "$EXEDIR\launch.vbs" run notFound
  notFound:
    MessageBox MB_OK|MB_ICONSTOP \
      "launch.vbs를 찾을 수 없습니다 ($EXEDIR).$\nMohani-Setup.exe를 다시 실행해주세요."
    Quit
  run:
    ExecShell "open" "$SYSDIR\wscript.exe" '"$EXEDIR\launch.vbs"' SW_HIDE
SectionEnd
