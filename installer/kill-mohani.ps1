# mohani 관련 프로세스 정확히 죽이기 — npm install 시 파일 락 방지.
# 다른 Node/Electron 앱은 건드리지 않음 (Path / CommandLine로 'mohani' 문자열 필터링).

# 1) Path 기반: 실행 파일이 mohani의 node_modules 안에 있는 프로세스
Get-Process -Name node, electron, Mohani -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -match 'mohani' -or $_.Name -eq 'Mohani' } |
  Stop-Process -Force -ErrorAction SilentlyContinue

# 2) CommandLine 기반: 실행 파일은 시스템 위치지만 인자에 mohani가 있는 프로세스
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -eq 'node.exe'     -and $_.CommandLine -match 'mohani') -or
  ($_.Name -eq 'electron.exe' -and $_.CommandLine -match 'mohani') -or
  ($_.Name -eq 'wscript.exe'  -and $_.CommandLine -match 'launch\.vbs')
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# 파일 핸들 OS 레벨 해제까지 잠깐 대기
Start-Sleep -Milliseconds 800
