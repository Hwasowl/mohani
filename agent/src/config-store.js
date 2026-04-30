// ~/.mohani/config.json — 백엔드 URL, 토큰, deviceId, 비공개 토글, 디렉토리 블랙리스트, 로컬 secret.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const DEFAULT_DIR = join(homedir(), '.mohani');
const DEFAULT_FILE = join(DEFAULT_DIR, 'config.json');

const DEFAULTS = Object.freeze({
  backendUrl: 'http://localhost:8080',
  deviceId: null,
  token: null,
  userId: null,
  displayName: null,
  isPrivate: false,
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
  // POSIX에서만 0600. Windows는 ACL이 있어 chmod 무의미하지만 fs.chmod는 no-op처럼 동작 → 안전.
  if (platform() !== 'win32') {
    try { chmodSync(path, 0o600); } catch {}
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
