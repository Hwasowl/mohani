import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransport, toBackendDto } from '../src/transport.js';

describe('toBackendDto', () => {
  it('maps normalized event fields to backend DTO shape', () => {
    const dto = toBackendDto({
      event: 'UserPromptSubmit',
      sessionId: 's1',
      cwd: '/tmp',
      promptFirstLine: 'hello',
      toolName: null,
      occurredAt: '2026-04-28T01:00:00Z',
    });
    expect(dto).toMatchObject({
      event: 'UserPromptSubmit',
      sessionId: 's1',
      cwd: '/tmp',
      promptFirstLine: 'hello',
      occurredAt: '2026-04-28T01:00:00Z',
    });
  });

  it('forwards questionHidden/answerHidden flags so backend can mark redacted rows', () => {
    const dto = toBackendDto({
      event: 'Stop',
      assistantPreview: null,
      assistantFull: null,
      answerHidden: true,
      occurredAt: 'now',
    });
    expect(dto.answerHidden).toBe(true);
    expect(dto.questionHidden).toBe(false);
  });

  it('defaults questionHidden/answerHidden to false when missing', () => {
    const dto = toBackendDto({ event: 'UserPromptSubmit', occurredAt: 'now' });
    expect(dto.questionHidden).toBe(false);
    expect(dto.answerHidden).toBe(false);
  });
});

describe('createTransport', () => {
  let cfg;
  let originalFetch;

  beforeEach(() => {
    cfg = { backendUrl: 'http://localhost:8080', token: 'tok' };
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('sends successfully when backend OK', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, headers: { get: () => 'application/json' }, json: async () => ({ accepted: true }),
    });
    const t = createTransport({ getConfig: () => cfg });
    const res = await t.send({ event: 'Stop', occurredAt: 'now' });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/agent/events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports unauthorized without queueing on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'no auth', headers: { get: () => '' },
    });
    const t = createTransport({ getConfig: () => cfg });
    const res = await t.send({ event: 'Stop', occurredAt: 'now' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unauthorized');
    expect(t.queueDepth()).toBe(0);
  });

  it('reports not_authenticated when no token', async () => {
    cfg = { backendUrl: 'http://x', token: null };
    const t = createTransport({ getConfig: () => cfg });
    const res = await t.send({ event: 'Stop', occurredAt: 'now' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_authenticated');
  });

  it('queues event on network error and retries on drain', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('network'));
      return Promise.resolve({
        ok: true, headers: { get: () => '' }, text: async () => '',
      });
    });

    const t = createTransport({ getConfig: () => cfg });
    const res = await t.send({ event: 'Stop', occurredAt: 'now' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('queued');
    expect(t.queueDepth()).toBe(1);

    const drained = await t._drain();
    expect(drained).toBe(true);
    expect(t.queueDepth()).toBe(0);
  });

  it('caps queue at MAX_QUEUE (oldest dropped)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const t = createTransport({ getConfig: () => cfg });
    for (let i = 0; i < 60; i++) {
      await t.send({ event: 'Stop', seq: i, occurredAt: 'now' });
    }
    expect(t.queueDepth()).toBe(50);
  });
});
