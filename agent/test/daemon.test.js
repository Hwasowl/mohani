import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
// config-store.save가 실제 ~/.mohani에 쓰지 않도록 mock — 사용자 환경 보호
vi.mock('../src/config-store.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, save: vi.fn() };
});
import { createApp, listenWithFallback } from '../src/daemon.js';

describe('daemon — /health', () => {
  it('returns ok', async () => {
    const app = createApp({});
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('daemon — /agent/event', () => {
  it('accepts UserPromptSubmit and returns masked event', async () => {
    const app = createApp({});
    const res = await request(app)
      .post('/agent/event')
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
    const app = createApp({ getConfig: () => ({ isPrivate: true, blacklistedDirs: [] }) });
    const res = await request(app)
      .post('/agent/event')
      .send({ event: 'UserPromptSubmit', prompt: 'whatever' });
    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
    expect(res.body.reason).toBe('privacy_on');
  });

  it('drops payload from blacklisted dir', async () => {
    const app = createApp({ getConfig: () => ({ isPrivate: false, blacklistedDirs: ['/work/erp'] }) });
    const res = await request(app)
      .post('/agent/event')
      .send({ event: 'UserPromptSubmit', cwd: '/work/erp/src', prompt: 'x' });
    expect(res.body.dropped).toBe(true);
    expect(res.body.reason).toBe('blacklisted_dir');
  });

  it('drops unsupported event types silently', async () => {
    const app = createApp({});
    const res = await request(app).post('/agent/event').send({ event: 'Garbage' });
    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
  });

  it('records lastEvent on shared state', async () => {
    const state = {};
    const app = createApp(state);
    await request(app)
      .post('/agent/event')
      .send({ event: 'UserPromptSubmit', prompt: 'hello' });
    expect(state.lastEvent.promptFirstLine).toBe('hello');
  });

  it('invokes onEvent callback for non-dropped events', async () => {
    const seen = [];
    const app = createApp({ onEvent: (e) => seen.push(e) });
    await request(app)
      .post('/agent/event')
      .send({ event: 'PreToolUse', tool_name: 'Bash' });
    expect(seen).toHaveLength(1);
    expect(seen[0].toolName).toBe('Bash');
  });
});

describe('daemon — /state/session (Electron 토큰 동기화)', () => {
  it('persists token + refreshes config; reports loggedIn=true', async () => {
    const refreshes = [];
    const state = {
      getConfig: () => ({ backendUrl: 'http://x' }),
      refreshConfig: () => refreshes.push(1),
    };
    const app = createApp(state);
    const res = await request(app)
      .post('/state/session')
      .send({ token: 'abc', userId: 7, displayName: '화소' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.loggedIn).toBe(true);
    expect(res.body.userId).toBe(7);
    expect(refreshes).toHaveLength(1);
  });

  it('reports loggedIn=false when no token in body or cfg', async () => {
    const state = { getConfig: () => ({}), refreshConfig: () => {} };
    const app = createApp(state);
    const res = await request(app).post('/state/session').send({});
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
    const app = createApp(state);
    await request(app)
      .post('/state/session')
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
    const blocker = createApp({});
    const blocked = await listenWithFallback(blocker, [34555, 34556, 34557]);
    try {
      const app = createApp({});
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
});
