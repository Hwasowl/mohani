# Mohani 단일 진입 — 모든 런처 로직.
# Write-Output 출력은 NSIS 진행창에 그대로 표시됨 (디버그·진행상황 시각화).
#
# 일반 호출 (Mohani.exe 더블클릭, Setup.exe 마지막):
#   1) 이미 떠있으면 → 그 창만 앞으로 가져오고 종료
#   2) 안 떠있으면 → 좀비 정리 + npm 업데이트 + mohani start 분리 실행
#
# Setup.exe pre-install 호출 시: -ForceKill -SkipLaunch
#   → Mohani.exe 까지 포함해 전부 죽이고 종료

param(
  [switch]$ForceKill,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Continue'
Write-Output "[1/5] Mohani 런처 시작"

$mutex = New-Object System.Threading.Mutex($false, "Global\Mohani.Launcher.Mutex")
if (-not $mutex.WaitOne(0)) {
  Write-Output "[skip] 다른 인스턴스가 이미 실행 중"
  exit 0
}

try {
  # ── ForceKill 모드 ──────────────────────────────────────────
  if ($ForceKill) {
    Write-Output "[force] 모든 mohani 프로세스 종료 중..."
    Get-Process node, electron, Mohani -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -match 'mohani' -or $_.Name -eq 'Mohani' } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    if ($SkipLaunch) {
      Write-Output "[force] SkipLaunch — 종료"
      return
    }
  }

  # ── 1. 이미 실행 중인지 확인 ─────────────────────────────
  Write-Output "[2/5] 기존 Mohani 창 검색..."
  $existing = Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -match 'mohani' -and $_.MainWindowTitle -eq 'Mohani' } |
    Select-Object -First 1

  if ($existing -and $existing.MainWindowHandle -ne 0) {
    Write-Output "[2/5] 이미 실행 중 (PID $($existing.Id)) — 창 앞으로 가져옴"
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    [Win]::ShowWindow($existing.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
    [Win]::SetForegroundWindow($existing.MainWindowHandle) | Out-Null
    Write-Output "[done] 완료"
    return
  }
  Write-Output "[2/5] 실행 중 mohani 없음 → 새로 시작"

  # ── 3. 좀비 프로세스 정리 ────────────────────────────────
  if (-not $ForceKill) {
    Write-Output "[3/5] 좀비 프로세스 정리..."
    $zombies = Get-Process node, electron -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -match 'mohani' }
    if ($zombies) {
      Write-Output "  → $($zombies.Count)개 종료"
      $zombies | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    } else {
      Write-Output "  → 없음"
    }
  }

  # ── 4. npm 자동 업데이트 ─────────────────────────────────
  Write-Output "[4/5] npm install -g mohani@latest (이미 최신이면 빠르게 통과)"
  $logFile = "$env:TEMP\mohani-update.log"
  & cmd /c "npm install -g mohani@latest > `"$logFile`" 2>&1"
  $npmExit = $LASTEXITCODE
  Write-Output "  → exit $npmExit (로그: $logFile)"

  # ── 5. mohani start 백그라운드 실행 ─────────────────────
  Write-Output "[5/5] mohani start 백그라운드 실행..."
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c mohani start'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $proc = [System.Diagnostics.Process]::Start($psi)
  Write-Output "  → PID $($proc.Id) 시작"
  Write-Output "[done] 완료 — Mohani 창이 곧 뜹니다"
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
