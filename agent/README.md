# mohani

친구가 AI CLI(Claude Code 등)에서 무슨 작업하고 있는지 한눈에 보는 데스크톱 SNS.

## 설치

```bash
npm install -g mohani
mohani start
```

`npm install`이 끝나면 `~/.claude/settings.json`에 hook이 자동 등록됩니다 (기존 hook 보존).
`mohani start`는 데몬 + Electron UI를 한 번에 실행해요. 창을 닫으면 모두 종료됩니다.

## 다음 단계 — 팀 가입

UI에서:
1. **시작하기** → 자동 가입 (deviceId 기반 익명 계정, 닉네임은 `친구-XXXX`로 자동 생성)
2. 우측 상단 메뉴 → **닉네임 변경**으로 원하는 이름으로
3. 헤더 좌측 팀 칩 → **+ 팀 만들기/가입하기** → 친구가 준 6자리 코드 입력

이후 Claude Code에서 평소처럼 작업하면 hook을 통해 자동으로 친구 화면에 떠요.

## 프라이버시

- 기본: 프롬프트 **첫 줄 200자**만 공유 (3중 마스킹 — API 키/이메일/홈 경로 자동 가림)
- 비공개 모드: 우측 상단 메뉴 → "비공개로 전환" — 즉시 송신 차단
- 블랙리스트 디렉토리: `~/.mohani/config.json`의 `blacklistedDirs`에 등록한 경로에서 작업하면 hook 자체가 차단됨

## CLI 명령어

```
mohani start                 데몬 + UI 한 번에 실행 (가장 일반적)
mohani hooks status          현재 등록된 mohani hook 확인
mohani hooks uninstall       제거 — mohani hook만, 다른 hook은 보존
mohani privacy on|off        비공개 모드
mohani status                현재 설정 + 로그인 상태
```

## 제거

```bash
npm uninstall -g mohani
```

`preuninstall` 스크립트가 자동으로 hook을 정리합니다 (mohani hook만 — 다른 도구의 hook은 그대로).

## 구성 파일

- `~/.mohani/config.json` — 토큰, 백엔드 URL, 비공개 토글, 블랙리스트
- `~/.claude/settings.json` — Claude Code hooks (mohani가 자동 머지)
- `~/.claude/settings.json.mohani-backup-{timestamp}` — 자동 백업 (수동 복구용)

## License

MIT
