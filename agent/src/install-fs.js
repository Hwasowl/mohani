// 파일시스템 I/O — install/uninstall 스크립트와 fs 통합 테스트가 공유한다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mergeMohaniHooks, removeMohaniHooks } from './install-utils.js';

export function defaultSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

// 백업 파일명 충돌 방지: ms 정밀도만으로는 같은 틱에 둘이 떨어질 수 있어
// (CI 빠른 환경, 또는 install+uninstall 연속) 6자 랜덤 접미사로 유일성 강제.
function nowStamp() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${iso}-${rand}`;
}

function ensureDir(file) {
  const d = dirname(file);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function readJsonOrEmpty(path) {
  if (!existsSync(path)) return { settings: {}, existed: false, raw: '' };
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return { settings: {}, existed: true, raw };
  try {
    return { settings: JSON.parse(raw), existed: true, raw };
  } catch (err) {
    throw new Error(`settings.json is not valid JSON: ${err.message}`);
  }
}

function backup(path, raw) {
  const backupPath = `${path}.mohani-backup-${nowStamp()}`;
  writeFileSync(backupPath, raw, 'utf8');
  return backupPath;
}

function writeJsonPretty(path, obj) {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Install: backup, merge mohani hooks, write back.
 * Returns { backupPath, mode: 'created' | 'merged' | 'no-op' }.
 *
 * Calling forms:
 *   installToSettings()                              // default path, default 'mohani-hook' prefix
 *   installToSettings('/custom/path/settings.json')  // custom path (legacy form)
 *   installToSettings({ path?, commandPrefix? })     // options form (dev mode passes commandPrefix)
 */
export function installToSettings(arg) {
  const opts = typeof arg === 'string' ? { path: arg } : (arg || {});
  const path = opts.path || defaultSettingsPath();
  const { settings, existed, raw } = readJsonOrEmpty(path);
  const backupPath = existed && raw ? backup(path, raw) : null;

  const merged = mergeMohaniHooks(settings, { commandPrefix: opts.commandPrefix });

  if (existed && JSON.stringify(merged) === JSON.stringify(settings)) {
    return { backupPath, mode: 'no-op', path };
  }

  writeJsonPretty(path, merged);
  return { backupPath, mode: existed ? 'merged' : 'created', path };
}

/**
 * Uninstall: backup, remove mohani hooks only, write back.
 */
export function uninstallFromSettings(path = defaultSettingsPath()) {
  if (!existsSync(path)) return { backupPath: null, mode: 'no-op', path };

  const { settings, raw } = readJsonOrEmpty(path);
  const backupPath = backup(path, raw);

  const cleaned = removeMohaniHooks(settings);

  if (JSON.stringify(cleaned) === JSON.stringify(settings)) {
    return { backupPath, mode: 'no-op', path };
  }

  writeJsonPretty(path, cleaned);
  return { backupPath, mode: 'cleaned', path };
}

export const _internals = { readJsonOrEmpty, backup, writeJsonPretty };
