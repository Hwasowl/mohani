# Mohani launcher script — invoked by Mohani.exe (NSIS) via wscript or directly.
#
# Behavior:
#   1) If Mohani Electron already running -> bring its window to front, exit
#   2) Otherwise kill zombie processes, spawn `mohani start` detached, exit
#
# Updates are NOT done here (auto-update on every launch caused npm race conditions).
# To update: re-run Mohani-Setup.exe.
#
# Setup.exe pre-install call: -ForceKill -SkipLaunch
#   -> kill everything including Mohani.exe launcher to free file locks for npm.

param(
  [switch]$ForceKill,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'SilentlyContinue'
Write-Output "[1/4] launcher start"

$mutex = New-Object System.Threading.Mutex($false, "Global\Mohani.Launcher.Mutex")
if (-not $mutex.WaitOne(0)) {
  Write-Output "[skip] another instance is running"
  exit 0
}

try {
  if ($ForceKill) {
    Write-Output "[force] killing all mohani processes (incl. launcher)"
    Get-Process node, electron, Mohani -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -match 'mohani' -or $_.Name -eq 'Mohani' } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    if ($SkipLaunch) {
      Write-Output "[force] SkipLaunch set, exit"
      return
    }
  }

  Write-Output "[2/4] checking existing Mohani window..."
  $existing = Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -match 'mohani' -and $_.MainWindowTitle -eq 'Mohani' } |
    Select-Object -First 1

  if ($existing -and $existing.MainWindowHandle -ne 0) {
    Write-Output "  -> already running (PID $($existing.Id)), bringing to front"
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    [Win]::ShowWindow($existing.MainWindowHandle, 9) | Out-Null
    [Win]::SetForegroundWindow($existing.MainWindowHandle) | Out-Null
    Write-Output "[done]"
    return
  }
  Write-Output "  -> not running, will start fresh"

  if (-not $ForceKill) {
    Write-Output "[3/4] cleaning zombie processes..."
    $zombies = Get-Process node, electron -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -match 'mohani' }
    if ($zombies) {
      Write-Output "  -> killing $($zombies.Count) zombies"
      $zombies | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    } else {
      Write-Output "  -> none"
    }
  }

  Write-Output "[4/4] spawning 'mohani start' detached, no console..."
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c mohani start'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $proc = [System.Diagnostics.Process]::Start($psi)
  Write-Output "  -> spawned PID $($proc.Id)"
  Write-Output "[done] Mohani window will appear shortly"
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
