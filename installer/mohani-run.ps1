# Mohani 단일 진입 — 모든 런처 로직.
#
# 일반 호출 (Mohani.exe 더블클릭, Setup.exe 마지막):
#   1) 이미 떠있으면 → 그 창만 앞으로 가져오고 종료 (빠름)
#   2) 안 떠있으면 → 좀비 정리 + npm 업데이트 + mohani start 분리 실행
#
# Setup.exe pre-install 호출 시: -ForceKill -SkipLaunch
#   → Mohani.exe 까지 포함해 전부 죽이고 종료 (npm install 위해 락 해제)

param(
  [switch]$ForceKill,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'SilentlyContinue'
$mutex = New-Object System.Threading.Mutex($false, "Global\Mohani.Launcher.Mutex")
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  # ── ForceKill 모드: 무조건 모든 mohani 프로세스 정리 ───────
  if ($ForceKill) {
    Get-Process node, electron, Mohani |
      Where-Object { $_.Path -match 'mohani' -or $_.Name -eq 'Mohani' } |
      Stop-Process -Force
    Start-Sleep -Milliseconds 800
    if ($SkipLaunch) { return }
  }

  # ── 1. 이미 실행 중인지 확인 ─────────────────────────────
  $existing = Get-Process electron |
    Where-Object { $_.Path -match 'mohani' -and $_.MainWindowTitle -eq 'Mohani' } |
    Select-Object -First 1

  if ($existing -and $existing.MainWindowHandle -ne 0) {
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
    return
  }

  # ── 2. 좀비(메인 창 죽고 자식만 남은) 정리 ────────────────
  if (-not $ForceKill) {
    Get-Process node, electron |
      Where-Object { $_.Path -match 'mohani' } |
      Stop-Process -Force
    Start-Sleep -Milliseconds 500
  }

  # ── 3. npm 자동 업데이트 (silent, 실패해도 계속) ──────────
  & cmd /c "npm install -g mohani@latest > `"$env:TEMP\mohani-update.log`" 2>&1" | Out-Null

  # ── 4. mohani start 백그라운드 실행 (콘솔 창 X) ──────────
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c mohani start'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [System.Diagnostics.Process]::Start($psi) | Out-Null
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
