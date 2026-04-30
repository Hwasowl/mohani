; Mohani.exe — 더블클릭 시 mohani start 실행, 끝.
Name "Mohani"
OutFile "Mohani.exe"
SilentInstall silent
RequestExecutionLevel user
Unicode True

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani"
VIAddVersionKey "FileVersion" "0.1.0"

Section
  Exec '"$SYSDIR\wscript.exe" "$EXEDIR\launch.vbs"'
SectionEnd
