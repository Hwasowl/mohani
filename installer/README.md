# Mohani Launcher (NSIS 부트스트랩)

`Mohani-Setup.exe` 빌드용 NSIS 스크립트.

## 동작

1. Node.js 20+ 설치 여부 확인 → 없으면 안내 후 nodejs.org 오픈
2. `npm install -g mohani@latest` — 최신 버전 설치/업데이트
3. 시작메뉴 단축키 생성 (한 번만)
4. `mohani` 실행 → 런처 종료

매 더블클릭마다 자동 업데이트 — npm이 같은 버전이면 즉시 skip.

## 로컬 빌드

### Windows
```powershell
winget install NSIS.NSIS
makensis installer/mohani.nsi
# → installer/Mohani-Setup.exe
```

### Linux / macOS
```bash
# Ubuntu
sudo apt-get install -y nsis

# macOS
brew install makensis

makensis installer/mohani.nsi
```

## 테스트 시나리오

| 상태 | 기대 동작 |
|---|---|
| Node 미설치 | "Node.js 20+ 필요" 메시지 + nodejs.org 오픈 후 종료 |
| mohani 미설치 | npm install 진행바 표시 → 시작메뉴 단축키 생성 → mohani 실행 |
| mohani 이미 최신 | npm 즉시 skip → mohani 실행 (체감 ~1초) |
| 구버전 설치됨 | npm install이 자동 업데이트 → 새 버전으로 실행 |

로컬에서 `mohani` 미설치 상태 만들기:
```bash
npm uninstall -g mohani
```

## 자동 빌드 (CI)

`release-*` 태그 push 시 GitHub Actions(`.github/workflows/release-installer.yml`)가
Ubuntu 러너에서 makensis 실행 → GitHub Releases에 `Mohani-Setup.exe` 자동 첨부.

```bash
git tag release-0.1.0
git push origin release-0.1.0
```

## 알려진 이슈

- **SmartScreen 경고**: 코드 서명 안 된 exe라 첫 실행 시 "Windows protected your PC"
  → "추가 정보 → 실행" 클릭. 추후 OV 인증서로 서명 예정 (W6).
- **AV 오탐**: 일부 무료 백신이 NSIS + 네트워크 다운로드 패턴을 휴리스틱으로 차단할 수 있음.
