import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDeviceId, load, save } from '../src/config-store.js';

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
});
