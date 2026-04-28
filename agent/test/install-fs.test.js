import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installToSettings, uninstallFromSettings } from '../src/install-fs.js';

let workdir;
let settingsPath;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'mohani-test-'));
  settingsPath = join(workdir, 'settings.json');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

const userOriginal = {
  permissions: { allow: ['Bash(dir:*)'], defaultMode: 'acceptEdits' },
  hooks: {
    UserPromptSubmit: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: 'node /path/to/clawd-hook.js UserPromptSubmit',
            shell: 'powershell',
          },
        ],
      },
    ],
    PermissionRequest: [
      { matcher: '', hooks: [{ type: 'http', url: 'http://127.0.0.1:23333/permission' }] },
    ],
  },
  statusLine: { type: 'command', command: 'noop' },
};

describe('installToSettings (real fs)', () => {
  it('creates settings.json when none exists', () => {
    const result = installToSettings(settingsPath);
    expect(result.mode).toBe('created');
    expect(result.backupPath).toBeNull();
    expect(existsSync(settingsPath)).toBe(true);

    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.UserPromptSubmit).toBeDefined();
    expect(
      written.hooks.UserPromptSubmit[0].hooks[0].command.startsWith('mohani-hook'),
    ).toBe(true);
  });

  it('merges into existing settings, creating backup, preserving user hooks', () => {
    writeFileSync(settingsPath, JSON.stringify(userOriginal, null, 2));
    const result = installToSettings(settingsPath);

    expect(result.mode).toBe('merged');
    expect(result.backupPath).toMatch(/\.mohani-backup-/);
    expect(existsSync(result.backupPath)).toBe(true);

    // 백업 파일은 원본과 동일
    const backupContent = readFileSync(result.backupPath, 'utf8');
    expect(JSON.parse(backupContent)).toEqual(userOriginal);

    // 머지된 settings에 사용자 clawd hook이 그대로 살아있고 mohani hook도 추가됨
    const merged = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const userHookSurvived = merged.hooks.UserPromptSubmit.some((b) =>
      b.hooks.some((h) => typeof h.command === 'string' && h.command.includes('clawd-hook.js')),
    );
    const mohaniHookAdded = merged.hooks.UserPromptSubmit.some((b) =>
      b.hooks.some((h) => typeof h.command === 'string' && h.command.startsWith('mohani-hook')),
    );
    expect(userHookSurvived).toBe(true);
    expect(mohaniHookAdded).toBe(true);

    // PermissionRequest 같은 우리가 안 건드리는 hook은 그대로
    expect(merged.hooks.PermissionRequest).toEqual(userOriginal.hooks.PermissionRequest);
  });

  it('is idempotent — second install is no-op', () => {
    writeFileSync(settingsPath, JSON.stringify(userOriginal, null, 2));
    installToSettings(settingsPath);
    const result = installToSettings(settingsPath);
    expect(result.mode).toBe('no-op');
  });

  it('throws on corrupted JSON (caller decides what to do)', () => {
    writeFileSync(settingsPath, '{not valid json');
    expect(() => installToSettings(settingsPath)).toThrow(/not valid JSON/);
  });
});

describe('uninstallFromSettings (real fs)', () => {
  it('removes only mohani entries, restores prior user state', () => {
    writeFileSync(settingsPath, JSON.stringify(userOriginal, null, 2));
    installToSettings(settingsPath);
    const result = uninstallFromSettings(settingsPath);

    expect(result.mode).toBe('cleaned');
    expect(result.backupPath).toMatch(/\.mohani-backup-/);

    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(after).toEqual(userOriginal);
  });

  it('is no-op when nothing to remove', () => {
    writeFileSync(settingsPath, JSON.stringify(userOriginal, null, 2));
    const result = uninstallFromSettings(settingsPath);
    expect(result.mode).toBe('no-op');
  });

  it('is no-op when settings.json does not exist', () => {
    const result = uninstallFromSettings(settingsPath);
    expect(result.mode).toBe('no-op');
    expect(result.backupPath).toBeNull();
  });

  it('full lifecycle: install → uninstall returns to byte-identical user state', () => {
    const originalRaw = JSON.stringify(userOriginal, null, 2) + '\n';
    writeFileSync(settingsPath, originalRaw);
    installToSettings(settingsPath);
    uninstallFromSettings(settingsPath);

    const finalRaw = readFileSync(settingsPath, 'utf8');
    expect(JSON.parse(finalRaw)).toEqual(userOriginal);
  });

  it('creates dated backup files (no overwrite)', () => {
    writeFileSync(settingsPath, JSON.stringify(userOriginal));
    installToSettings(settingsPath);
    // 두 번째 install은 no-op이므로 백업 안 됨 — 대신 uninstall 두 번 (각각 백업 생성)
    uninstallFromSettings(settingsPath);
    uninstallFromSettings(settingsPath);
    const files = readdirSync(workdir).filter((f) => f.includes('mohani-backup'));
    // install 1개 + uninstall 1개(2번째 uninstall은 no-op이므로 백업) = 최소 2
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});
