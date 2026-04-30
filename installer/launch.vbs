' Mohani 무콘솔 실행 — Mohani.exe / Mohani-Setup.exe 가 wscript로 호출.
' powershell.exe를 -WindowStyle Hidden 으로 띄워 mohani-run.ps1 실행.
Dim sh, ps1
Set sh = CreateObject("WScript.Shell")
ps1 = Replace(WScript.ScriptFullName, "launch.vbs", "mohani-run.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
