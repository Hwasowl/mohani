# Dev 환경 실행

## 한 줄

레포 루트에서:

```bash
npm run dev
```

인프라(Postgres + Redis 도커) + 에이전트 + 백엔드(톰캣) + Electron 한 번에 기동. 정의는 [package.json](../package.json)의 `scripts.dev`.

이미 도커가 떠있으면:

```bash
npm run dev:no-infra
```

## 분리 실행 (각 터미널)

| 터미널 | 명령 | 비고 |
|---|---|---|
| 인프라 (1회) | `cd backend && docker compose up -d` | Postgres :5432 + Redis :6379 |
| 백엔드 (톰캣) | `cd backend && gradlew.bat bootRun` | :8080 listen |
| 에이전트 (데몬) | `cd agent && npm start` | :24555 listen — `mohani start` 아님 |
| Electron | `cd electron && npm run dev` | Vite :5173 + Electron HMR |

## 자주 헷갈리는 포인트

- **`mohani start` ≠ `npm start`**
  - `mohani start`는 npm 전역 설치된 사용자용 CLI 진입점
  - 개발 중엔 `agent/`에서 `npm start`로 데몬 직접 실행 (코드 수정 즉시 반영, `npm link` 불필요)
- **빌드 디렉토리 우회**: `C:/tmp/mohani-build` — OneDrive 한글 경로 회피용. [build.gradle](./build.gradle)에서 Windows 한정 적용
- **Java 17 필수** — `gradle.properties`에 JDK 17 경로 지정
- **인프라 리셋이 필요할 때**: 루트에서 `npm run infra:reset` (볼륨까지 날림 → 첫 실행처럼 마이그레이션 다시)

## 끄기

- 통합 실행(`npm run dev`)은 Ctrl+C 한 번에 자식 프로세스 모두 종료 (concurrently `-k` 옵션)
- 인프라만 따로 끄려면: `cd backend && docker compose down`
