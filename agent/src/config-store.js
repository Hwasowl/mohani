// ~/.mohani/config.json — 백엔드 URL, 토큰, deviceId, 비공개 토글, 디렉토리 블랙리스트.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
}

/**
 * Returns the persisted deviceId, generating one if none exists.
 * Caller may persist via save() if they choose to.
 */
export function ensureDeviceId(config) {
  if (config.deviceId && typeof config.deviceId === 'string') return config;
  return { ...config, deviceId: randomUUID() };
}

export const PATHS = { DEFAULT_DIR, DEFAULT_FILE };
