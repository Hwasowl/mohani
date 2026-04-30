# mohani 관련 프로세스 정확히 죽이기 — npm install 시 파일 락 방지.
# 다른 Node/Electron 앱은 건드리지 않음.
#
# 호출자별 차이:
#   - Mohani.exe (런처) : 자기 자신은 죽이면 안 됨 → 기본 동작 (node/electron만)
#   - Mohani-Setup.exe  : Mohani.exe 도 죽여야 npm 가능 → -IncludeLauncher 인자

param(
  [switch]$IncludeLauncher
)

# 1) Path 기반: 실행 파일이 mohani의 node_modules 안에 있는 node/electron
Get-Process -Name node, electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -match 'mohani' } |
  Stop-Process -Force -ErrorAction SilentlyContinue

# 2) CommandLine 기반: 인자에 mohani가 들어있는 node/electron + launch.vbs 띄운 wscript
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -eq 'node.exe'     -and $_.CommandLine -match 'mohani') -or
  ($_.Name -eq 'electron.exe' -and $_.CommandLine -match 'mohani') -or
  ($_.Name -eq 'wscript.exe'  -and $_.CommandLine -match 'launch\.vbs')
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# 3) Mohani.exe 런처 자체 — Setup.exe 가 호출할 때만 죽임
if ($IncludeLauncher) {
  Get-Process -Name Mohani -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

# 파일 핸들 OS 레벨 해제까지 잠깐 대기
Start-Sleep -Milliseconds 800
