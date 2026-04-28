# Mohani (뭐하니)

친구가 팀 코드로 모여, 각자 AI CLI(Claude Code, 향후 Codex/Aider)에서 무슨 작업하는지 **프롬프트 첫 줄만** 공유하고 토큰·시간·랭킹을 SNS처럼 보는 데스크톱 앱.

## 모노레포 구조
- `backend/` — Spring Boot 3.4.3 + Redis + PostgreSQL
- `agent/` — Node 20 글로벌 npm `@mohani/agent` (Claude Code hooks 수신, 마스킹, 백엔드 송신)
- `electron/` — Electron + React (친구 활동 뷰어)

## 핵심 약속
- **공유 레벨 L3**: 프롬프트 첫 줄만 (200자 컷, 마스킹 적용)
- **3중 마스킹 안전망**: AWS/GCP 키, JWT, 이메일, password, 홈경로 등 자동 ●●● 처리
- **디렉토리 블랙리스트**: 회사 프로젝트 자동 제외
- **비공개 토글**: `Ctrl+Shift+P` 즉시 차단
- **사용자의 기존 `~/.claude/settings.json` hook 절대 미수정** — 안전 머지 후 정확한 제거

## 빌드/실행
- 인프라: `cd backend && docker compose up -d`
- 백엔드: `cd backend && ./gradlew.bat bootRun`
- 에이전트: `cd agent && pnpm install && pnpm test && pnpm start`
- 클라이언트: `cd electron && pnpm install && pnpm dev`

## 진행 상황 (W1)
- [ ] 워크스페이스 + 모노레포 초기화
- [ ] Agent: 마스킹 라이브러리 + 20+ 테스트
- [ ] Agent: 데몬(:24555) hook 수신
- [ ] Agent: hook-cli 진입점
- [ ] Agent: postinstall/preuninstall + 안전성 테스트
- [ ] Backend: Spring 골격 + docker compose + 헬스 테스트

자세한 계획: [l3-frolicking-castle.md](../../../.claude/plans/l3-frolicking-castle.md)
