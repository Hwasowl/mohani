# 배포 가이드

세 가지를 각자 배포해야 한다:
1. **백엔드** (Spring Boot + Postgres + Redis) — 친구들이 공유하는 서버
2. **에이전트** (`@mohani/agent` npm 패키지) — 친구들 PC에 설치
3. **Electron 앱** — 친구들이 다운로드해서 실행

## 1. 백엔드 배포

### 옵션 A — Fly.io (무료 티어 가능, 제일 쉬움)

```bash
# 1) Fly CLI 설치 + 로그인
curl -L https://fly.io/install.sh | sh
fly auth signup   # 또는 fly auth login

# 2) backend 디렉토리에서 앱 생성
cd backend
fly launch --no-deploy   # 앱 이름·리전만 정하고 deploy는 보류

# 3) 시크릿 설정
fly secrets set MOHANI_JWT_SECRET="$(openssl rand -hex 32)"

# 4) Postgres + Redis attach (Fly의 관리형 서비스)
fly postgres create --name mohani-db
fly postgres attach mohani-db   # DATABASE_URL 자동 설정
fly redis create                # REDIS_URL 자동 설정

# 5) application.yml에 환경변수 매핑이 들어가도록 한 번 더 설정
#    Spring은 SPRING_DATASOURCE_URL / SPRING_DATA_REDIS_HOST 를 자동으로 읽음
fly deploy
```

도메인은 `https://<앱이름>.fly.dev`. WebSocket(STOMP)도 그대로 작동한다.

### 옵션 B — VPS + Docker (자기 서버)

`backend/docker-compose.prod.yml` + `Dockerfile` + `Caddyfile` 이미 준비됨. Caddy가 Let's Encrypt로 HTTPS 자동.

```bash
# 1) DNS A 레코드: mohani.example.com → 서버 IP

# 2) 서버에 코드 업로드 후
cd backend
cat > .env <<EOF
MOHANI_DOMAIN=mohani.example.com
MOHANI_JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
EOF

# 3) 빌드 + 실행
docker compose -f docker-compose.prod.yml up -d --build

# 4) 로그
docker compose -f docker-compose.prod.yml logs -f app
```

### 옵션 C — Railway / Render / DigitalOcean App Platform

`Dockerfile` 하나만 있으면 자동 빌드·배포해준다. Postgres/Redis는 각 플랫폼의 관리형 인스턴스 attach. 환경변수 `SPRING_DATASOURCE_URL`, `SPRING_DATA_REDIS_HOST/PORT`, `MOHANI_JWT_SECRET`만 잘 매핑하면 된다.

### 백엔드 환경변수 정리

| 변수 | 의미 | 필수? |
|---|---|---|
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://host:5432/mohani` | ✓ |
| `SPRING_DATASOURCE_USERNAME` | DB 유저 | ✓ |
| `SPRING_DATASOURCE_PASSWORD` | DB 비밀번호 | ✓ |
| `SPRING_DATA_REDIS_HOST` | Redis 호스트 | ✓ |
| `SPRING_DATA_REDIS_PORT` | Redis 포트 | (default 6379) |
| `MOHANI_JWT_SECRET` | JWT 서명 키 (32바이트+) | ✓ |
| `SERVER_PORT` | 앱 포트 | (default 8080) |

## 2. 에이전트 배포 (npm)

친구들이 한 줄로 설치할 수 있도록 npm registry에 publish.

```bash
cd agent
# package.json의 name이 "@mohani/agent" — npm scope. npm signup + 조직 생성 필요
npm login
npm publish --access public

# 친구는 이렇게 설치:
npm install -g @mohani/agent
mohani hooks install      # ~/.claude/settings.json에 hook 등록
mohani-agent              # 데몬 실행 (백그라운드)
```

**대안**: GitHub Releases에 tarball만 올리고 친구들이 `npm install -g <tarball-url>` 하는 방식도 가능. npm 계정 없어도 됨.

자동 시작(부팅 시 데몬 자동 실행)은 별도 작업이 필요 — Windows는 작업 스케줄러, macOS는 launchd plist. MVP는 사용자가 매번 실행.

## 3. Electron 앱 배포

### 3-1) 빌드 시 백엔드 URL 주입

```bash
cd electron
# 패키지 빌드 시 환경변수로 prod URL 박아넣기
VITE_MOHANI_BACKEND_URL=https://mohani.example.com npm run dist:win
# 산출물: electron/release/Mohani-Setup-0.1.0.exe
```

이렇게 하면 사용자가 첫 실행에서 백엔드 URL을 입력할 필요 없음. 사용자 설정으로 덮을 수도 있게 [api.js:23](electron/src/api.js:23) — 사용자가 고급 설정에서 다른 URL 입력하면 localStorage에 저장되어 우선 적용.

### 3-2) Windows 빌드

```bash
cd electron
npm install   # electron-builder 설치
npm run dist:win
```

산출물 `electron/release/Mohani-Setup-{version}.exe` — 친구들에게 그대로 공유 또는 GitHub Releases.

NSIS 설치기 옵션 (package.json `build.nsis`):
- `oneClick: false` — 설치 위치 선택 가능
- `createDesktopShortcut: true` — 바탕화면 바로가기 자동
- 코드 사인은 안 됨 → Windows SmartScreen 경고 뜸. 해결하려면 EV 코드사인 인증서 (~$200/년)

### 3-3) macOS 빌드

```bash
npm run dist:mac
# arm64(M1+) + x64 둘 다 생성 (Universal)
```

`Mohani-{version}-{arch}.dmg`. 사인 안 하면 Gatekeeper가 "확인되지 않은 개발자" 경고. 해결: Apple Developer 가입 ($99/년) + notarization.

### 3-4) GitHub Releases로 배포

```bash
# 태그 만들고 push
git tag v0.1.0
git push origin v0.1.0

# 빌드 산출물을 GitHub Releases에 업로드
# (gh CLI 사용)
gh release create v0.1.0 \
    electron/release/Mohani-Setup-0.1.0.exe \
    electron/release/Mohani-0.1.0-arm64.dmg \
    --title "v0.1.0" --notes "초기 베타"
```

또는 GitHub Actions로 자동화 — `.github/workflows/release.yml`에서 태그 push 시 빌드+업로드.

## 친구 온보딩 흐름 (TL;DR)

```
1. https://github.com/Hwasowl/mohani/releases 에서 Mohani-Setup-0.1.0.exe 다운 → 설치
2. 터미널에서:
     npm install -g @mohani/agent
     mohani hooks install
     mohani-agent &     (또는 별도 터미널에서 그냥 실행)
3. Mohani 앱 실행 → 시작하기 → 팀 코드 입력
4. Claude Code에서 평소처럼 작업하면 자동으로 친구한테 보임
```

## 보안 체크리스트

- [ ] `MOHANI_JWT_SECRET`은 32바이트 이상 랜덤 (openssl rand -hex 32)
- [ ] Postgres 비밀번호 강력하게 (운영 도메인 노출 시)
- [ ] Caddy/Nginx로 HTTPS 강제 — `ws://` 대신 `wss://` 사용 필수
- [ ] `application.yml`의 `dev-secret-change-me-...` 기본값이 prod에 들어가지 않도록 환경변수 강제
- [ ] CORS `setAllowedOriginPatterns(List.of("*"))` 는 dev 편의용 — prod는 도메인 화이트리스트로 좁히기 ([SecurityConfig.java:47](backend/src/main/java/com/mohani/global/config/SecurityConfig.java:47))

## 모니터링

- 백엔드 로그: `docker compose logs app -f`
- 활동 로그 dump: Postgres `SELECT * FROM activity_log ORDER BY occurred_at DESC LIMIT 50`
- Redis 키 확인: `redis-cli` → `KEYS mohani:*`
- 마스킹 우회 시도: 백엔드 로그에서 `suspicious_after_mask` grep
