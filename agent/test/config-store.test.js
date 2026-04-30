import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDeviceId, ensureLocalSecret, load, loadAndPrime, save } from '../src/config-store.js';

let dir;
let path;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mohani-cfg-'));
  path = join(dir, 'config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('config-store', () => {
  it('returns defaults when file missing', () => {
    const cfg = load(path);
    expect(cfg.backendUrl).toBe('http://localhost:8080');
    expect(cfg.token).toBeNull();
    expect(cfg.isPrivate).toBe(false);
    expect(cfg.blacklistedDirs).toEqual([]);
  });

  it('roundtrips save and load', () => {
    save({ backendUrl: 'http://x', token: 'tok', userId: 5, displayName: 'Z',
           deviceId: 'dev', isPrivate: true, blacklistedDirs: ['/a'] }, path);
    expect(existsSync(path)).toBe(true);
    const cfg = load(path);
    expect(cfg.token).toBe('tok');
    expect(cfg.isPrivate).toBe(true);
    expect(cfg.blacklistedDirs).toEqual(['/a']);
  });

  it('falls back to defaults on corrupted file', () => {
    writeFileSync(path, '{not json');
    const cfg = load(path);
    expect(cfg.token).toBeNull();
  });

  it('ensureDeviceId generates UUID when missing', () => {
    const cfg = ensureDeviceId({ deviceId: null });
    expect(cfg.deviceId).toMatch(/[0-9a-f]{8}-/);
  });

  it('ensureDeviceId preserves existing deviceId', () => {
    const cfg = ensureDeviceId({ deviceId: 'existing' });
    expect(cfg.deviceId).toBe('existing');
  });

  // H1 — localSecret 자동 생성
  it('ensureLocalSecret generates 64-char hex when missing', () => {
    const cfg = ensureLocalSecret({});
    expect(cfg.localSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ensureLocalSecret preserves existing valid secret', () => {
    const existing = 'a'.repeat(64);
    const cfg = ensureLocalSecret({ localSecret: existing });
    expect(cfg.localSecret).toBe(existing);
  });

  it('ensureLocalSecret regenerates if too short', () => {
    const cfg = ensureLocalSecret({ localSecret: 'tooshort' });
    expect(cfg.localSecret.length).toBeGreaterThanOrEqual(64);
    expect(cfg.localSecret).not.toBe('tooshort');
  });

  it('loadAndPrime creates and persists deviceId + localSecret on first run', () => {
    const cfg = loadAndPrime(path);
    expect(cfg.deviceId).toMatch(/[0-9a-f]{8}-/);
    expect(cfg.localSecret).toMatch(/^[0-9a-f]{64}$/);
    // 영속화 검증 — 다시 load 했을 때 같은 값
    const reload = load(path);
    expect(reload.deviceId).toBe(cfg.deviceId);
    expect(reload.localSecret).toBe(cfg.localSecret);
  });

  it('loadAndPrime is idempotent — second call returns same values', () => {
    const first = loadAndPrime(path);
    const second = loadAndPrime(path);
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.localSecret).toBe(first.localSecret);
  });
});
