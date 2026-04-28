import { describe, expect, it } from 'vitest';
import {
  countMohaniHooks,
  MOHANI_EVENTS,
  mergeMohaniHooks,
  removeMohaniHooks,
} from '../src/install-utils.js';

// 사용자의 실제 settings.json을 단순화한 fixture (clawd-on-desk 7개 + PermissionRequest)
function userFixture() {
  const clawd = (event) => ({
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: `& "node" "C:/Users/hwaso/OneDrive/바탕 화면/clawd-on-desk/hooks/clawd-hook.js" ${event}`,
        shell: 'powershell',
      },
    ],
  });

  return {
    permissions: { allow: ['Bash(dir:*)'], defaultMode: 'acceptEdits' },
    hooks: {
      SessionStart: [clawd('SessionStart')],
      SessionEnd: [clawd('SessionEnd')],
      UserPromptSubmit: [clawd('UserPromptSubmit')],
      PreToolUse: [clawd('PreToolUse')],
      PostToolUse: [clawd('PostToolUse')],
      Stop: [clawd('Stop')],
      PermissionRequest: [
        {
          matcher: '',
          hooks: [{ type: 'http', url: 'http://127.0.0.1:23333/permission', timeout: 600 }],
        },
      ],
    },
    statusLine: { type: 'command', command: 'noop' },
  };
}

describe('mergeMohaniHooks', () => {
  it('adds mohani hook to all 6 events', () => {
    const out = mergeMohaniHooks(userFixture());
    for (const event of MOHANI_EVENTS) {
      expect(out.hooks[event]).toBeDefined();
      const allCommands = out.hooks[event].flatMap((b) => b.hooks.map((h) => h.command));
      expect(allCommands.some((c) => c.startsWith('mohani-hook'))).toBe(true);
    }
    expect(countMohaniHooks(out)).toBe(MOHANI_EVENTS.length);
  });

  it('preserves all existing user hook entries (clawd-on-desk untouched)', () => {
    const before = userFixture();
    const after = mergeMohaniHooks(before);

    // clawd hook은 모든 이벤트에서 그대로
    for (const event of [
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Stop',
    ]) {
      const clawdSurvived = after.hooks[event].some((b) =>
        b.hooks.some((h) => typeof h.command === 'string' && h.command.includes('clawd-hook.js')),
      );
      expect(clawdSurvived).toBe(true);
    }

    // PermissionRequest hook은 우리가 등록 안 함 → 그대로 유지
    expect(after.hooks.PermissionRequest).toEqual(before.hooks.PermissionRequest);

    // permissions/statusLine 같은 다른 키도 그대로
    expect(after.permissions).toEqual(before.permissions);
    expect(after.statusLine).toEqual(before.statusLine);
  });

  it('is idempotent — running twice does not duplicate', () => {
    const once = mergeMohaniHooks(userFixture());
    const twice = mergeMohaniHooks(once);
    expect(countMohaniHooks(twice)).toBe(countMohaniHooks(once));
  });

  it('handles empty settings (no hooks key)', () => {
    const out = mergeMohaniHooks({});
    expect(out.hooks).toBeDefined();
    expect(countMohaniHooks(out)).toBe(MOHANI_EVENTS.length);
  });

  it('handles null/undefined settings', () => {
    const out = mergeMohaniHooks(null);
    expect(out.hooks).toBeDefined();
    expect(countMohaniHooks(out)).toBe(MOHANI_EVENTS.length);
  });

  it('does not mutate input', () => {
    const input = userFixture();
    const snapshot = JSON.stringify(input);
    mergeMohaniHooks(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('removeMohaniHooks', () => {
  it('removes only mohani entries, preserves everything else', () => {
    const merged = mergeMohaniHooks(userFixture());
    expect(countMohaniHooks(merged)).toBe(6);

    const cleaned = removeMohaniHooks(merged);
    expect(countMohaniHooks(cleaned)).toBe(0);
    expect(cleaned).toEqual(userFixture());
  });

  it('idempotent — removing twice leaves clean state', () => {
    const merged = mergeMohaniHooks(userFixture());
    const once = removeMohaniHooks(merged);
    const twice = removeMohaniHooks(once);
    expect(twice).toEqual(once);
  });

  it('does not modify other hook event keys (PermissionRequest, etc.)', () => {
    const merged = mergeMohaniHooks(userFixture());
    const cleaned = removeMohaniHooks(merged);
    expect(cleaned.hooks.PermissionRequest).toEqual(userFixture().hooks.PermissionRequest);
  });

  it('removes empty matcher blocks but keeps event key if other hooks remain', () => {
    const settings = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: 'mohani-hook --event=UserPromptSubmit' },
              { type: 'command', command: 'other-tool --action=log' },
            ],
          },
        ],
      },
    };
    const cleaned = removeMohaniHooks(settings);
    expect(cleaned.hooks.UserPromptSubmit).toHaveLength(1);
    expect(cleaned.hooks.UserPromptSubmit[0].hooks).toHaveLength(1);
    expect(cleaned.hooks.UserPromptSubmit[0].hooks[0].command).toBe('other-tool --action=log');
  });

  it('drops event key entirely when only mohani hook was present', () => {
    const settings = {
      hooks: {
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'mohani-hook --event=Stop' }] }],
      },
    };
    const cleaned = removeMohaniHooks(settings);
    expect(cleaned.hooks.Stop).toBeUndefined();
  });

  it('handles null/undefined settings safely', () => {
    expect(removeMohaniHooks(null)).toBe(null);
    expect(removeMohaniHooks(undefined)).toBe(undefined);
  });
});

describe('integration — full lifecycle preserves user state', () => {
  it('install → uninstall returns to exact original state', () => {
    const original = userFixture();
    const originalJson = JSON.stringify(original);

    const installed = mergeMohaniHooks(original);
    const uninstalled = removeMohaniHooks(installed);

    expect(JSON.stringify(uninstalled)).toBe(originalJson);
  });

  it('install → install → uninstall still returns to original (idempotency)', () => {
    const original = userFixture();
    const originalJson = JSON.stringify(original);

    const after = removeMohaniHooks(mergeMohaniHooks(mergeMohaniHooks(original)));

    expect(JSON.stringify(after)).toBe(originalJson);
  });
});
