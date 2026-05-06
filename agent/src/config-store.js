// ~/.mohani/config.json — 백엔드 URL, 토큰, deviceId, 비공개 토글, 디렉토리 블랙리스트, 로컬 secret.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DEFAULT_DIR = join(homedir(), '.mohani');
const DEFAULT_FILE = join(DEFAULT_DIR, 'config.json');

const DEFAULTS = Object.freeze({
  backendUrl: 'http://localhost:8080',
  deviceId: null,
  token: null,
  userId: null,
  displayName: null,
  isPrivate: false,
  // 본문 숨김 토글 — 활동 자체는 송신하되 prompt/answer 본문만 null로 redact.
  // 영구 저장 — 한 번 켜두고 잊어도 새 활동에 자동 적용 (보안 fail-safe).
  hideQuestion: false,
  hideAnswer: false,
  blacklistedDirs: [],
  // H1: 로컬 데몬 endpoint 인증용 무작위 secret. 첫 기동 시 생성.
  // 같은 머신의 Electron만 (preload IPC 통해) 알 수 있어 LAN/CSRF 공격 차단.
  localSecret: null,
});

function ensureDir(file) {
  const d = dirname(file);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function load(path = DEFAULT_FILE) {
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(config, path = DEFAULT_FILE) {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  if (platform() === 'win32') {
    // M2 (0.1.12): 같은 머신의 다른 사용자가 localSecret/JWT를 평문으로 못 읽도록 ACL을 owner-only로 잠근다.
    // 멀티유저 PC, 가족 공용, RDP 공유 시나리오에서의 secret 노출을 차단.
    // icacls는 Windows 10/11 기본 포함. 실패해도 정상 동작은 막지 않음(파일은 이미 저장됨).
    lockdownWindowsAcl(path);
  } else {
    try { chmodSync(path, 0o600); } catch {}
  }
}

// 사용자명에 영숫자/도메인 구분자만 허용 — execFile 인자라 shell injection은 없지만
// icacls가 받아들이는 형식만 통과시켜 옵션 인젝션도 차단.
const SAFE_USERNAME_RE = /^[A-Za-z0-9._\- ]{1,128}$/;

function lockdownWindowsAcl(path) {
  const user = process.env.USERNAME;
  if (!user || !SAFE_USERNAME_RE.test(user)) return;
  try {
    // /inheritance:r — 부모로부터 상속된 ACE 제거. /grant:r — 기존 ACE 교체.
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    });
  } catch {
    // icacls 부재/실패 — secret 보호가 약해지지만 데몬 동작은 유지.
  }
}

/**
 * Returns the persisted deviceId, generating one if none exists.
 * Caller may persist via save() if they choose to.
 */
export function ensureDeviceId(config) {
  if (config.deviceId && typeof config.deviceId === 'string') return config;
  return { ...config, deviceId: randomUUID() };
}

/**
 * H1: 로컬 데몬 인증용 secret. 없으면 32바이트 random hex로 생성.
 * Caller가 save()로 영속화해야 한다.
 */
export function ensureLocalSecret(config) {
  if (config.localSecret && typeof config.localSecret === 'string' && config.localSecret.length >= 32) {
    return config;
  }
  return { ...config, localSecret: randomBytes(32).toString('hex') };
}

/**
 * load + ensureDeviceId + ensureLocalSecret + save. 부팅 시 1회 호출하면
 * config.json이 항상 일관 상태 (deviceId/localSecret 보장).
 */
export function loadAndPrime(path = DEFAULT_FILE) {
  let cfg = load(path);
  const before = JSON.stringify(cfg);
  cfg = ensureDeviceId(cfg);
  cfg = ensureLocalSecret(cfg);
  if (JSON.stringify(cfg) !== before) save(cfg, path);
  return cfg;
}

export const PATHS = { DEFAULT_DIR, DEFAULT_FILE };
