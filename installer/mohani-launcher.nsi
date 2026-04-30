; Mohani 일상 런처 (Mohani.exe)
; 더블클릭 시:
;   1. Mutex로 동시 실행 차단 (이미 실행 중이면 즉시 종료)
;   2. 기존 Mohani 프로세스(이전 인스턴스의 데몬+Electron) 정리
;   3. npm install -g mohani@latest 자동 업데이트 (실패해도 다이얼로그 없음, 로그만)
;   4. wscript로 launch.vbs 호출 → 콘솔 없이 mohani start
;   5. 즉시 종료
;
; SilentInstall silent → NSIS 인스톨 UI 안 뜸. 다이얼로그는 치명적 오류(launch.vbs 없음)에만.

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Mohani"
OutFile "Mohani.exe"
SilentInstall silent
RequestExecutionLevel user
Unicode True

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Mohani"
VIAddVersionKey "FileDescription" "Mohani"
VIAddVersionKey "FileVersion" "0.1.0"
VIAddVersionKey "LegalCopyright" "MIT License"

Section
  ; ─── 1. Mutex 단일 인스턴스 보장 ─────────────────────────────
  ; 이미 다른 Mohani.exe가 실행 중이면 (예: 사용자 더블클릭 두 번) 즉시 종료.
  ; ERROR_ALREADY_EXISTS = 183
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "Global\Mohani.Launcher.Mutex") p .r0 ?e'
  Pop $1
  ${If} $1 == 183
    Quit
  ${EndIf}

  ; ─── 2. 이전 Mohani 프로세스 정리 (파일 락 방지) ──────────────
  ; 이전 더블클릭으로 띄운 daemon/Electron이 살아있으면 npm이 파일 못 덮어씀.
  ${If} ${FileExists} "$EXEDIR\kill-mohani.ps1"
    nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$EXEDIR\kill-mohani.ps1"'
  ${EndIf}

  ; ─── 3. 자동 업데이트 (실패해도 silent fallback) ─────────────
  ; 출력은 로그 파일로 — 다이얼로그 노출 X. 디버그 필요 시 %TEMP%\mohani-update.log 확인.
  nsExec::Exec 'cmd.exe /c npm install -g mohani@latest > "%TEMP%\mohani-update.log" 2>&1'

  ; ─── 4. mohani 무콘솔 실행 ───────────────────────────────────
  ${IfNot} ${FileExists} "$EXEDIR\launch.vbs"
    MessageBox MB_OK|MB_ICONSTOP \
      "Mohani 설치 손상: launch.vbs를 찾을 수 없습니다.$\nMohani-Setup.exe를 다시 실행해주세요."
    Quit
  ${EndIf}
  Exec '"$SYSDIR\wscript.exe" "$EXEDIR\launch.vbs"'
SectionEnd
