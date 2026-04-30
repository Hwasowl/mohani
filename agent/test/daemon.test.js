import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
// config-store.save가 실제 ~/.mohani에 쓰지 않도록 mock — 사용자 환경 보호
vi.mock('../src/config-store.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, save: vi.fn() };
});
import { createApp, listenWithFallback } from '../src/daemon.js';

// H1 — 모든 보호 endpoint에 secret 헤더 필요. 테스트 헬퍼로 일관 주입.
const TEST_SECRET = 'test-local-secret-32-bytes-padding-padding';

// state에 localSecret 자동 주입. createApp이 원본 state에 mutation(lastEvent 등)하므로 spread 대신 mutate.
function appWithSecret(state = {}) {
  const userGetConfig = state.getConfig;
  state.getConfig = () => ({ localSecret: TEST_SECRET, ...(userGetConfig ? userGetConfig() : {}) });
  return createApp(state);
}

function authed(req) {
  return req.set('authorization', `Bearer ${TEST_SECRET}`);
}

describe('daemon — /health', () => {
  it('returns ok (no auth required)', async () => {
    const app = appWithSecret();
    const res = await request(app).get('/health'); // 인증 미요구
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('daemon — H1 local secret auth', () => {
  it('rejects /state without secret header (401)', async () => {
    const app = appWithSecret();
    const res = await request(app).get('/state');
    expect(res.status).toBe(401);
  });

  it('rejects /state with wrong secret (401)', async () => {
    const app = appWithSecret();
    const res = await request(app).get('/state').set('authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
  });

  it('rejects /state/session without secret (401) — CSRF 차단', async () => {
    const app = appWithSecret();
    const res = await request(app).post('/state/session').send({ token: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects /agent/event without secret (401)', async () => {
    const app = appWithSecret();
    const res = await request(app).post('/agent/event').send({ event: 'UserPromptSubmit' });
    expect(res.status).toBe(401);
  });

  it('returns 503 when daemon has no secret configured (fail-closed)', async () => {
    // localSecret 없는 상태 — 비정상이지만 절대 통과되면 안 됨.
    const app = createApp({ getConfig: () => ({}) });
    const res = await request(app).get('/state');
    expect(res.status).toBe(503);
  });

  it('accepts request with valid secret', async () => {
    const app = appWithSecret();
    const res = await authed(request(app).get('/state'));
    expect(res.status).toBe(200);
  });
});

describe('daemon — /agent/event', () => {
  it('accepts UserPromptSubmit and returns masked event', async () => {
    const app = appWithSecret();
    const res = await authed(request(app)
      .post('/agent/event'))
      .send({
        event: 'UserPromptSubmit',
        sessionId: 's1',
        cwd: 'C:\\projects\\foo',
        prompt: 'help me with redis sorted set\nsecond line ignored',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dropped).toBeUndefined();
    expect(res.body.normalized.promptFirstLine).toBe('help me with redis sorted set');
  });

  it('drops payload when in private mode', async () => {
    const app = appWithSecret({ getConfig: () => ({ isPrivate: true, blacklistedDirs: [] }) });
    const res = await authed(request(app)
      .post('/agent/event'))
      .send({ event: 'UserPromptSubmit', prompt: 'whatever' });
    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
    expect(res.body.reason).toBe('privacy_on');
  });

  it('drops payload from blacklisted dir', async () => {
    const app = appWithSecret({ getConfig: () => ({ isPrivate: false, blacklistedDirs: ['/work/erp'] }) });
    const res = await authed(request(app)
      .post('/agent/event'))
      .send({ event: 'UserPromptSubmit', cwd: '/work/erp/src', prompt: 'x' });
    expect(res.body.dropped).toBe(true);
    expect(res.body.reason).toBe('blacklisted_dir');
  });

  it('drops unsupported event types silently', async () => {
    const app = appWithSecret();
    const res = await authed(request(app).post('/agent/event')).send({ event: 'Garbage' });
    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
  });

  it('records lastEvent on shared state', async () => {
    const state = {};
    const app = appWithSecret(state);
    await authed(request(app)
      .post('/agent/event'))
      .send({ event: 'UserPromptSubmit', prompt: 'hello' });
    expect(state.lastEvent.promptFirstLine).toBe('hello');
  });

  it('invokes onEvent callback for non-dropped events', async () => {
    const seen = [];
    const app = appWithSecret({ onEvent: (e) => seen.push(e) });
    await authed(request(app)
      .post('/agent/event'))
      .send({ event: 'PreToolUse', tool_name: 'Bash' });
    expect(seen).toHaveLength(1);
    expect(seen[0].toolName).toBe('Bash');
  });

  it('first event has no durationDeltaSec; subsequent events accumulate gap', async () => {
    const seen = [];
    const app = appWithSecret({ onEvent: (e) => seen.push(e) });
    await authed(request(app).post('/agent/event')).send({ event: 'UserPromptSubmit', prompt: 'a' });
    await new Promise((r) => setTimeout(r, 1100));
    await authed(request(app).post('/agent/event')).send({ event: 'PreToolUse', tool_name: 'Read' });
    expect(seen[0].durationDeltaSec).toBeUndefined();
    expect(seen[1].durationDeltaSec).toBeGreaterThanOrEqual(1);
    expect(seen[1].durationDeltaSec).toBeLessThanOrEqual(2);
  });

  it('Stop event reads transcript file to set accurate totalTokens', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'mohani-test-'));
    const transcriptPath = join(dir, 'conv.jsonl');
    writeFileSync(transcriptPath, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', usage: { input_tokens: 1500, output_tokens: 250 } },
      }),
    ].join('\n'));

    const seen = [];
    const app = appWithSecret({ onEvent: (e) => seen.push(e) });
    await authed(request(app).post('/agent/event')).send({
      event: 'Stop',
      session_id: 'sess-tok',
      transcript_path: transcriptPath,
    });
    expect(seen[0].totalTokens).toBe(1750); // 1500 + 250
  });

  it('Stop event with no transcript file leaves totalTokens null (no double-count)', async () => {
    const seen = [];
    const app = appWithSecret({ onEvent: (e) => seen.push(e) });
    await authed(request(app).post('/agent/event')).send({
      event: 'Stop',
      session_id: 'sess-x',
      transcript_path: '/non/existent/path.jsonl',
    });
    // 파일을 못 읽으면 raw.totalTokens fallback (null) — 토큰 누적 안 됨
    expect(seen[0].totalTokens).toBeNull();
  });
});

describe('daemon — /state/session (Electron 토큰 동기화)', () => {
  it('persists token + refreshes config; reports loggedIn=true', async () => {
    const refreshes = [];
    const state = {
      getConfig: () => ({ backendUrl: 'http://x' }),
      refreshConfig: () => refreshes.push(1),
    };
    const app = appWithSecret(state);
    const res = await authed(request(app)
      .post('/state/session'))
      .send({ token: 'abc', userId: 7, displayName: '화소' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.loggedIn).toBe(true);
    expect(res.body.userId).toBe(7);
    expect(refreshes).toHaveLength(1);
  });

  it('reports loggedIn=false when no token in body or cfg', async () => {
    const state = { getConfig: () => ({}), refreshConfig: () => {} };
    const app = appWithSecret(state);
    const res = await authed(request(app).post('/state/session')).send({});
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(false);
  });

  it('preserves existing cfg fields when body omits them', async () => {
    let savedSnapshot = null;
    // mock save를 통해 실제 저장된 객체 검증
    const cs = await import('../src/config-store.js');
    cs.save.mockImplementationOnce((next) => { savedSnapshot = next; });

    const state = {
      getConfig: () => ({ backendUrl: 'http://orig', token: 'old', userId: 1, isPrivate: true }),
      refreshConfig: () => {},
    };
    const app = appWithSecret(state);
    await authed(request(app)
      .post('/state/session'))
      .send({ token: 'newtok', userId: 2, displayName: 'Z' }); // backendUrl 누락

    expect(savedSnapshot.token).toBe('newtok');
    expect(savedSnapshot.userId).toBe(2);
    expect(savedSnapshot.displayName).toBe('Z');
    expect(savedSnapshot.backendUrl).toBe('http://orig'); // 기존값 유지
    expect(savedSnapshot.isPrivate).toBe(true); // 다른 필드 유지
  });
});

describe('daemon — port fallback', () => {
  it('falls back to next port when primary is occupied', async () => {
    const blocker = appWithSecret();
    const blocked = await listenWithFallback(blocker, [34555, 34556, 34557]);
    try {
      const app = appWithSecret();
      const result = await listenWithFallback(app, [blocked.port, 34556, 34557]);
      try {
        expect(result.port).not.toBe(blocked.port);
        expect([34556, 34557]).toContain(result.port);
      } finally {
        await new Promise((r) => result.server.close(r));
      }
    } finally {
      await new Promise((r) => blocked.server.close(r));
    }
  });

  // C1 회귀 — LAN(0.0.0.0) 바인딩되면 같은 LAN 공격자가 토큰/backendUrl 덮어쓰기 가능했음.
  it('binds only to 127.0.0.1 (not all interfaces)', async () => {
    const app = appWithSecret();
    const { server, port } = await listenWithFallback(app, [44555, 44556, 44557]);
    try {
      const addr = server.address();
      expect(addr.address).toBe('127.0.0.1');
      expect(addr.port).toBe(port);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
