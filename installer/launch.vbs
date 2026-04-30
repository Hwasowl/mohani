' Mohani 무콘솔 실행 스텁 — Mohani.exe 가 wscript로 호출.
' Run 두 번째 인자 0 = 윈도우 숨김. 세 번째 False = 자식 종료 대기 안 함.
CreateObject("WScript.Shell").Run "cmd /c mohani start", 0, False
