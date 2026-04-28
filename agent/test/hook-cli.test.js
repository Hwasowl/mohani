import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, listenWithFallback } from '../src/daemon.js';
import { buildPayload, sendToDaemon } from '../src/hook-cli.js';

describe('hook-cli buildPayload', () => {
  it('parses snake_case fields from Claude Code', () => {
    const raw = JSON.stringify({
      session_id: 'abc',
      cwd: '/tmp',
      prompt: 'hello',
      tool_name: 'Read',
      total_tokens: 42,
    });
    const p = buildPayload('UserPromptSubmit', raw);
    expect(p).toEqual({
      event: 'UserPromptSubmit',
      sessionId: 'abc',
      cwd: '/tmp',
      prompt: 'hello',
      toolName: 'Read',
      totalTokens: 42,
      cliKind: 'claude',
    });
  });

  it('handles empty stdin', () => {
    const p = buildPayload('SessionStart', '');
    expect(p.event).toBe('SessionStart');
    expect(p.sessionId).toBeNull();
  });

  it('handles malformed JSON gracefully', () => {
    const p = buildPayload('Stop', 'not-json');
    expect(p.event).toBe('Stop');
    expect(p.sessionId).toBeNull();
  });
});

describe('hook-cli sendToDaemon — end-to-end', () => {
  let server;
  let port;
  const seen = [];

  beforeAll(async () => {
    const app = createApp({ onEvent: (e) => seen.push(e) });
    const result = await listenWithFallback(app, [44555, 44556, 44557]);
    server = result.server;
    port = result.port;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('posts payload to daemon and receives ok', async () => {
    const payload = buildPayload(
      'UserPromptSubmit',
      JSON.stringify({ session_id: 'x1', prompt: 'first line\nsecond' }),
    );
    const result = await sendToDaemon(payload, [port]);
    expect(result.ok).toBe(true);
    expect(seen.at(-1)?.promptFirstLine).toBe('first line');
  });

  it('returns ok=false when no port is reachable', async () => {
    const result = await sendToDaemon({ event: 'Stop' }, [55001]);
    expect(result.ok).toBe(false);
  });
});
