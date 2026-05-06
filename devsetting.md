# Dev 환경 세팅

작업자가 보고 따라하면 바로 동작하도록 작성. 환경변수 설정/secret 발급 같은 사전 작업 없음.

---

## 1. 사전 요구사항

| 도구 | 버전 | 확인 명령 (터미널에 입력) |
|---|---|---|
| **Docker Desktop** | 최신 (Compose v2 포함) | `docker compose version` |
| **Node.js** | 20 이상 | `node -v` |
| **JDK** | 17 (Eclipse Temurin 권장) | `java -version` |
| **Git** | 최신 | `git --version` |

> 터미널: Windows는 **PowerShell** (시작 메뉴 → "PowerShell"), Mac은 **Terminal**.
>
> JDK 경로는 [/backend/gradle.properties:1](C:/Users/hwaso/OneDrive/바탕 화면/shwa/mohani/backend/gradle.properties:1)에 하드코딩되어 있습니다 (`org.gradle.java.home`). 다른 PC에서는 본인 JDK 17 설치 경로로 바꿔야 합니다.

---

## 2. 한 줄로 시작

### Step 1. 레포 받기 (1회만)

원하는 폴더(예: `C:\dev`)에서 터미널 열고:

```bash
git clone https://github.com/Hwasowl/mohani.git
cd mohani
```

이 시점부터 **현재 폴더가 `mohani` 폴더**입니다 — 아래 명령은 모두 이 `mohani` 폴더 안에서 실행합니다 (`cd ..`로 빠져나가지 않기). 이 글에서 "**프로젝트 폴더**"라고 하면 바로 이 `mohani` 폴더를 가리킵니다.

> 이미 받았으면: 받아둔 `mohani` 폴더로 이동해서 `git pull` 후 진행.

### Step 2. 의존성 설치 (1회만)

`mohani` 폴더 안에서:

```bash
npm install              # root concurrently 설치
npm run install:all      # agent + electron 의존성 설치
```

### Step 3. 실행

`mohani` 폴더 안에서:

```bash
npm run dev
```

이 한 줄이 다음을 한 번에 띄웁니다:

1. **Postgres + Redis** (도커 컴포즈, healthcheck 통과까지 대기)
2. **Spring Boot** 백엔드 (`:8080`)
3. **에이전트 데몬** (`:24555`)
4. **Electron + Vite** UI (`:5173`)

`Ctrl+C` 한 번에 자식 프로세스(2~4) 모두 종료. 도커는 그대로 떠 있음 — 끄려면 `npm run infra:down`.

> 첫 실행 시 도커 이미지 pull + 마이그레이션(Flyway) 때문에 1~2분 소요. 이후엔 ~10초.

---

## 3. 비밀값(secret/password)이 왜 안 필요한가

[/backend/src/main/resources/application.yml](C:/Users/hwaso/OneDrive/바탕 화면/shwa/mohani/backend/src/main/resources/application.yml):

```yaml
password: ${SPRING_DATASOURCE_PASSWORD:mohani}
secret:   ${MOHANI_JWT_SECRET:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}
```

- **로컬**: 환경변수 없으면 `:` 뒤 default 사용 (`mohani`, `aaaa..`). 도커 컴포즈의 Postgres 비번도 `mohani`로 맞춰져 있어 그대로 접속됨.
- **prod (Render)**: Render Web Service에 설정된 `SPRING_DATASOURCE_PASSWORD` / `MOHANI_JWT_SECRET` 환경변수가 default를 덮어씀. **Render 추가 설정 변경 불필요**.
- prod 보안 가드: [/backend/src/main/java/com/mohani/global/auth/JwtService.java:21-37](C:/Users/hwaso/OneDrive/바탕 화면/shwa/mohani/backend/src/main/java/com/mohani/global/auth/JwtService.java:21) — `dev-secret`/`change-me`/`example` 등 약한 패턴은 부팅 거부 + 32바이트 미만도 거부. 약한 default가 prod로 새지 않습니다.

---

## 4. 분리 실행 (IDE 디버깅 / 부분 재기동)

`npm run dev`가 한 번에 띄워주지만, IntelliJ에서 백엔드 디버깅하거나 일부만 재기동하고 싶을 때.

각 명령은 **새 터미널을 하나씩 열어서** 실행 — 모두 시작 위치는 `mohani` 폴더입니다.

| 터미널 | 시작 폴더 | 명령 | 포트 |
|---|---|---|---|
| 인프라 (1회) | `mohani/` | `npm run infra:up` | Postgres `:5432`, Redis `:6379` |
| 백엔드 | `mohani/backend/` | `gradlew.bat bootRun` *(or IDE Run)* | `:8080` |
| 에이전트 | `mohani/agent/` | `npm start` | `:24555` |
| Electron | `mohani/electron/` | `npm run dev` | Vite `:5173` + Electron HMR |

폴더 이동은 `cd` 명령 — 예: `mohani` 폴더에서 백엔드 폴더로 가려면 `cd backend`. 다른 폴더로 가기 전에 `cd ..`로 한 단계 위로 올라간 뒤 이동.

**인프라가 이미 떠 있을 때**: `mohani` 폴더에서 `npm run dev:no-infra` (도커 부분 스킵, 나머지 3개만 띄움)

---

## 5. 자주 헷갈리는 포인트

- **`mohani start` ≠ `npm start`**
  - `mohani start`는 npm 전역 설치된 사용자용 CLI 진입점 (배포된 패키지)
  - 개발 중엔 `agent/`에서 `npm start`로 데몬 직접 실행 — 코드 수정 즉시 반영, `npm link` 불필요
- **빌드 디렉토리 우회**: `C:/tmp/mohani-build` — OneDrive 한글 경로 회피용. [/backend/build.gradle](C:/Users/hwaso/OneDrive/바탕 화면/shwa/mohani/backend/build.gradle)에서 Windows 한정 적용
- **도커 컨테이너 이름 충돌**: 다른 mohani 인스턴스가 떠 있으면 `mohani-postgres` 컨테이너명 충돌 — `docker rm -f mohani-postgres mohani-redis`

---

## 6. 끄기 / 리셋

아래 명령은 모두 **`mohani` 폴더**에서 실행:

| 목적 | 명령 |
|---|---|
| 통합 실행 종료 | 실행 중인 터미널에서 `Ctrl+C` (concurrently `-k`로 자식 일괄 정리) |
| 도커만 종료 | `npm run infra:down` |
| **DB 초기화** (마이그레이션 다시) | `npm run infra:reset` (볼륨까지 삭제) |

---

## 7. Render 배포 영향

이번 application.yml 변경(`${VAR:default}` 문법 도입)은 Render 측 설정 변경 **불필요**:

- Render는 Web Service의 환경변수 `SPRING_DATASOURCE_PASSWORD`, `MOHANI_JWT_SECRET`를 이미 주입 중
- Spring PropertySource 우선순위: **OS 환경변수 > application.yml** — env가 있으면 default를 덮어씀
- 검증: 배포 후 `/actuator/health` UP 확인하면 끝
