# Mohani Installer (NSIS)

두 개의 exe로 구성:

| 파일 | 역할 | UI |
|---|---|---|
| **Mohani-Setup.exe** | 첫 설치 — Node 검사 + npm install + Mohani.exe 배치 + 단축키 | 설치 진행 창 |
| **Mohani.exe** | 일상 런처 — 매 실행 시 자동 업데이트 + 무콘솔 mohani 실행 | 무 (silent) |

`launch.vbs` 는 Mohani.exe 와 같은 디렉토리에서 wscript로 호출되어 cmd 창 노출 없이
`mohani start` 를 띄우는 헬퍼.

## 동작 시나리오

### 첫 설치 (Mohani-Setup.exe)
1. Node.js 20+ 검사 — 없으면 nodejs.org 안내 후 종료
2. 기존 mohani / electron 프로세스 종료 (파일 락 방지)
3. `npm install -g mohani@latest`
4. `Mohani.exe` + `launch.vbs` 를 `%LOCALAPPDATA%\Mohani\` 에 배치
5. 시작메뉴 + 바탕화면에 단축키 생성 (Mohani.exe 가리킴)
6. Mohani.exe 즉시 실행 → 종료

### 일상 실행 (Mohani.exe — 단축키 더블클릭)
1. silent 모드로 시작 (인스톨러 UI 안 뜸)
2. `npm install -g mohani@latest` — 같은 버전이면 ~1초 skip, 새 버전이면 ~5~10초 업데이트
3. wscript로 `launch.vbs` 호출 → cmd 창 없이 `mohani start` 실행
4. 즉시 종료 (mohani 데몬+UI는 백그라운드로 살아남음)
5. 업데이트 실패해도 (오프라인 등) 기존 버전으로 진행 시도

## 로컬 빌드

빌드 순서가 중요 — Mohani-Setup.exe는 Mohani.exe 를 임베드하므로 launcher를 먼저 빌드.

### Windows
```powershell
winget install NSIS.NSIS
cd installer
makensis mohani-launcher.nsi      # → Mohani.exe (~50KB)
makensis mohani-setup.nsi         # → Mohani-Setup.exe (~110KB, Mohani.exe 임베드됨)
```

### Linux / macOS
```bash
sudo apt-get install -y nsis      # Ubuntu
brew install makensis             # macOS

cd installer
makensis mohani-launcher.nsi
makensis mohani-setup.nsi
```

## 테스트 시나리오

| 상태 | 기대 동작 |
|---|---|
| Node 미설치 + Setup.exe 실행 | "Node.js 20+ 필요" 메시지 + nodejs.org 오픈 후 종료 |
| 첫 Setup.exe 실행 | npm install 로그 → Mohani.exe 배치 → 단축키 생성 → mohani 실행 |
| Mohani.exe 더블클릭 (정상) | 무 UI, ~1~10초 후 Mohani 창만 뜸 |
| Mohani.exe 더블클릭 (오프라인) | "업데이트 실패" 메시지 박스 → 확인 후 기존 버전으로 시작 |
| Setup.exe 재실행 (이미 설치됨) | npm 업데이트 → Mohani.exe 갱신 → 실행 |

로컬에서 mohani 미설치 상태 만들기:
```bash
npm uninstall -g mohani
```

## 자동 빌드 (CI)

`release-*` 태그 push → `.github/workflows/release-installer.yml` 가 Ubuntu 러너에서
`mohani-launcher.nsi` → `mohani-setup.nsi` 순으로 빌드 후 GitHub Releases에 업로드.

```bash
git tag release-0.1.0
git push origin release-0.1.0
```

GitHub Releases 페이지에 `Mohani-Setup.exe` 첨부됨 (Mohani.exe는 안에 임베드).
친구한테 그 한 파일만 공유.

## 알려진 이슈

- **SmartScreen 경고**: 코드 서명 안 된 exe → 첫 실행 시 "Windows protected your PC"
  → "추가 정보 → 실행" 클릭. 추후 OV 인증서로 서명 (W6).
- **AV 오탐**: NSIS + 네트워크 다운로드 패턴이 휴리스틱에 걸릴 수 있음.
- **npm 권한**: `npm config get prefix` 가 `Program Files` 안이면 admin 필요 → 사용자에게
  `npm config set prefix "%APPDATA%\npm"` 안내 필요.
