# Mohani (뭐하니)

> 친구가 팀 코드로 모여, 각자 AI CLI(Claude Code 등)에서 무슨 작업하는지
> **프롬프트 첫 줄만** 공유하고 토큰·시간을 SNS처럼 보는 데스크톱 앱.

## 모노레포 구조

| 폴더 | 무엇 | 핵심 |
|---|---|---|
| `backend/` | Spring Boot 3.4.3 + Redis + PostgreSQL | 인증·팀·활동·STOMP |
| `agent/` | Node 20 글로벌 npm `@mohani/agent` | hook 수신·마스킹·백엔드 송신·CLI |
| `electron/` | Electron + Vite + React + STOMP.js | 친구 그리드·피드·비공개 토글 |

## 약속 (프라이버시)

- **L3 정책**: 프롬프트 **첫 줄 + 200자 컷 + 마스킹**만 공유 — 코드 본문·파일 경로·도구 인자 X
- **3중 마스킹**: AWS/GCP 키, JWT, password, 이메일, 홈 경로 자동 ●●● + 서버 재검증 + 200자 hard-cut
- **디렉토리 블랙리스트**: 회사 프로젝트 영구 제외
- **비공개 토글**: 일렉트론 우상단 버튼 — 즉시 송신 차단
- **사용자의 기존 `~/.claude/settings.json` hook 절대 미수정** — 안전 머지 + 정확한 제거

---

## 데모 실행 (5분)

### 0) 사전 준비
- Java 17, Node 20+, Docker 필요
- 윈도우는 PowerShell 또는 Git Bash

### 1) 인프라 (Postgres + Redis)
```bash
cd backend
docker compose up -d
```

### 2) 백엔드
```bash
cd backend
./gradlew.bat bootRun
# → http://localhost:8080 에서 listen
```

### 3) 에이전트 (글로벌 설치 OR 로컬 실행)

**옵션 A — 로컬 개발 모드 (권장, 데모용)**
```bash
cd agent
npm install
npm start          # → 데몬이 :24555 에서 listen
```

별도 터미널에서:
```bash
node agent/src/cli.js login --name=화소
node agent/src/cli.js team create "데모팀"
# → "team code: ABC123" 출력 — 친구한테 공유
```

**옵션 B — 글로벌 설치 (실사용 모드)**
```bash
cd agent
npm pack
npm install -g ./mohani-agent-0.1.0.tgz   # postinstall이 ~/.claude/settings.json 안전 머지
mohani login --name=화소
mohani team create "데모팀"
```

### 4) Claude Code hook 등록 (옵션 A에서만 수동)
글로벌 설치(B)는 자동이지만, 로컬 모드(A)는 hook을 한 번 등록해야 합니다.

`~/.claude/settings.json`의 `hooks.UserPromptSubmit` 배열에 다음 추가:
```json
{
  "matcher": "",
  "hooks": [{
    "type": "command",
    "command": "node \"<레포경로>/mohani/agent/src/hook-cli.js\" --event=UserPromptSubmit"
  }]
}
```
같은 방식으로 `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Stop` 추가.

### 5) Electron 앱
```bash
cd electron
npm install
npm run dev        # Vite + Electron 동시 실행
```
앱 창에서:
1. 닉네임 입력 → **시작하기** (데몬 로그인과 별개로 UI 세션 — 같은 deviceId 쓰면 같은 사용자)
2. 자동으로 본인 팀이 보임 (CLI에서 만든 팀)
3. 친구 그리드 + 라이브 피드 표시

### 6) 친구 사용자 (다른 PC 또는 다른 OS 계정)
- 1)~3) 똑같이 실행 (단, login 시 `--backend=http://친구가-띄운-IP:8080`)
- `mohani team join ABC123` 으로 팀 가입
- Electron 켜면 친구 그리드에 동시 표시

### 7) 데모 시나리오
- A의 Claude Code에서 "redis sorted set 페이징 알려줘" 입력
- B의 Electron 그리드 → A의 카드가 활성, 첫 줄 표시, 토큰 카운트 증가
- A가 우상단 **비공개 모드** 클릭 → B 화면에서 A 카드가 idle로 전환
- A가 다시 비공개 해제 → 다음 프롬프트부터 다시 표시

---

## 테스트

```bash
cd backend && ./gradlew.bat test       # Spring 테스트 (현재 31건)
cd agent   && npm test                 # Node 테스트 (현재 89건)
```

전체 120건 테스트 중 마스킹·정책·인증·팀·ingest·transport·install 안전성 모두 커버.

---

## 환경 / 빌드 메모

- 빌드 디렉토리는 `C:/tmp/mohani-build` 로 우회 (OneDrive 한글 경로 이슈)
- 데몬 포트: 24555 → 24556 → 24557 자동 폴백 (기존 23333과 충돌 회피)
- JDK 17 경로: `C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot` (gradle.properties)
- 백엔드 환경변수:
  - `MOHANI_JWT_SECRET` (운영, 32바이트 이상)
- 에이전트 환경변수:
  - `MOHANI_BACKEND_URL` (CLI/데몬 default backend)
  - `MOHANI_LOG=verbose` (데몬 디버그 로그)
  - `MOHANI_SKIP_HOOK_INSTALL=1` (글로벌 설치 시 hook 등록 건너뛰기)

## 진행 상황

- [x] W1 — agent 마스킹/데몬/install + backend 골격
- [x] W2 — auth/team/activity ingest + STOMP 브로드캐스트 + Redis 통계
- [x] W3 — Electron 미니 데모 UI
- [ ] W4 — Windows installer 패키징 + 친구 5명 dogfood

자세한 계획: `~/.claude/plans/l3-frolicking-castle.md`
