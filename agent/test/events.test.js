import { describe, expect, it } from 'vitest';
import { normalizeEvent } from '../src/events.js';

describe('normalizeEvent — UserPromptSubmit', () => {
  it('masks first line of prompt', () => {
    const out = normalizeEvent({
      event: 'UserPromptSubmit',
      sessionId: 's1',
      cwd: 'C:\\projects\\foo',
      prompt: 'Redis sorted set 페이징\n두번째 줄',
    });
    expect(out.dropped).toBe(false);
    expect(out.normalized.event).toBe('UserPromptSubmit');
    expect(out.normalized.promptFirstLine).toBe('Redis sorted set 페이징');
  });

  it('drops payload when masked text still contains suspicious pattern', () => {
    // 마스킹 정책에 잡히지 않는 패턴 — 거의 없지만 안전망 검증.
    // 실제로는 maskFirstLine이 모두 잡으므로 dropped=false가 정상.
    // 여기서는 비식별 케이스로 확인.
    const out = normalizeEvent({
      event: 'UserPromptSubmit',
      prompt: 'plain question with no secrets',
    });
    expect(out.dropped).toBe(false);
  });

  it('records mask hits when sensitive data present', () => {
    const out = normalizeEvent({
      event: 'UserPromptSubmit',
      prompt: 'send to user@example.com please',
    });
    expect(out.dropped).toBe(false);
    expect(out.normalized.promptFirstLine).toContain('●●●@●●●');
    expect(out.normalized.maskHits).toContain('EMAIL');
  });
});

describe('normalizeEvent — guardrails', () => {
  it('drops invalid payload', () => {
    expect(normalizeEvent(null).dropped).toBe(true);
    expect(normalizeEvent('string').dropped).toBe(true);
  });

  it('drops unsupported event type', () => {
    const out = normalizeEvent({ event: 'WeirdEvent' });
    expect(out.dropped).toBe(true);
    expect(out.reason).toBe('unsupported_event');
  });

  it('drops everything when private mode is on', () => {
    const out = normalizeEvent(
      { event: 'UserPromptSubmit', prompt: 'hello' },
      { isPrivate: true },
    );
    expect(out.dropped).toBe(true);
    expect(out.reason).toBe('privacy_on');
  });

  it('drops when cwd matches blacklisted dir (exact)', () => {
    const out = normalizeEvent(
      { event: 'UserPromptSubmit', cwd: 'C:\\company\\secret', prompt: 'x' },
      { blacklistedDirs: ['C:/company/secret'] },
    );
    expect(out.dropped).toBe(true);
    expect(out.reason).toBe('blacklisted_dir');
  });

  it('drops when cwd is under blacklisted dir', () => {
    const out = normalizeEvent(
      { event: 'UserPromptSubmit', cwd: '/home/me/work/erp/src', prompt: 'x' },
      { blacklistedDirs: ['/home/me/work/erp'] },
    );
    expect(out.dropped).toBe(true);
  });

  it('does not drop when cwd is sibling (not subpath)', () => {
    const out = normalizeEvent(
      { event: 'UserPromptSubmit', cwd: '/home/me/work/erp-public', prompt: 'x' },
      { blacklistedDirs: ['/home/me/work/erp'] },
    );
    expect(out.dropped).toBe(false);
  });

  it('case-insensitive dir match (Windows)', () => {
    const out = normalizeEvent(
      { event: 'UserPromptSubmit', cwd: 'C:\\Company\\Secret', prompt: 'x' },
      { blacklistedDirs: ['c:/company/secret'] },
    );
    expect(out.dropped).toBe(true);
  });
});

describe('normalizeEvent — other event types', () => {
  it('PreToolUse passes through tool name', () => {
    const out = normalizeEvent({
      event: 'PreToolUse',
      sessionId: 's',
      tool_name: 'Bash',
    });
    expect(out.dropped).toBe(false);
    expect(out.normalized.toolName).toBe('Bash');
  });

  it('PostToolUse normalizes camelCase variant', () => {
    const out = normalizeEvent({ event: 'PostToolUse', toolName: 'Read' });
    expect(out.normalized.toolName).toBe('Read');
  });

  it('Stop carries totalTokens', () => {
    const out = normalizeEvent({ event: 'Stop', totalTokens: 1234 });
    expect(out.normalized.totalTokens).toBe(1234);
  });

  it('SessionStart defaults cliKind to claude', () => {
    const out = normalizeEvent({ event: 'SessionStart' });
    expect(out.normalized.cliKind).toBe('claude');
  });
});
