import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodexWatcher } from '../src/codex-watcher.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mohani-codex-'));
}

function writeJsonlLines(file, entries) {
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(file, lines);
}

function makeUserMessage(message, timestampMs) {
  return {
    timestamp: new Date(timestampMs).toISOString(),
    type: 'event_msg',
    payload: { type: 'user_message', message, images: [], local_images: [], text_elements: [] },
  };
}

describe('codex-watcher', () => {
  let tempRoot;
  let sessionDir;
  let sessionFile;

  beforeEach(() => {
    tempRoot = makeTempDir();
    // ~/.codex/sessions/2026/04/29 흉내
    sessionDir = path.join(tempRoot, '2026', '04', '29');
    fs.mkdirSync(sessionDir, { recursive: true });
    sessionFile = path.join(sessionDir, 'rollout-2026-04-29T10-00-00-test.jsonl');
    // 빈 파일로 미리 생성 — 첫 tick에서 size=0 baseline이 잡혀야 그 후 추가된 라인이 처리됨.
    fs.writeFileSync(sessionFile, '');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('워처 시작 후 새로 추가된 user_message만 콜백된다', async () => {
    // 시작 전 파일에 이미 메시지가 있음 (= baseline)
    writeJsonlLines(sessionFile, [
      makeUserMessage('이전 메시지 — 무시되어야 함', Date.now() - 1000),
    ]);

    const handler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: handler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
    });
    await watcher._tick(); // baseline 등록

    // 새 메시지 추가
    const startMs = Date.now();
    writeJsonlLines(sessionFile, [
      makeUserMessage('새 메시지', startMs + 100),
    ]);
    await watcher._tick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message).toBe('새 메시지');
    watcher.stop();
  });

  it('user_message가 아닌 이벤트는 무시', async () => {
    const handler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: handler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
    });
    await watcher._tick();

    writeJsonlLines(sessionFile, [
      { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_message', text: '응답' } },
      { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: new Date().toISOString(), type: 'response_item', payload: {} },
      { timestamp: new Date().toISOString(), type: 'session_meta', payload: { cwd: '/x' } },
    ]);
    await watcher._tick();

    expect(handler).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('워처 시작 이전 timestamp의 메시지는 무시 (재전송 방지)', async () => {
    const handler = vi.fn();
    // now()를 고정 → startedAt 명확히 통제
    const fakeStart = 1_000_000_000_000;
    const watcher = createCodexWatcher({
      onUserMessage: handler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
      now: () => fakeStart,
    });
    await watcher._tick();

    // 시작 시각보다 이른 timestamp 메시지를 새로 추가 (예: 시계 차이)
    writeJsonlLines(sessionFile, [
      makeUserMessage('과거 메시지', fakeStart - 5000),
    ]);
    await watcher._tick();

    expect(handler).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('빈 message나 잘못된 JSON은 건너뛴다', async () => {
    const handler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: handler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
    });
    await watcher._tick();

    fs.appendFileSync(sessionFile, '{not valid json\n');
    fs.appendFileSync(sessionFile,
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg',
        payload: { type: 'user_message', message: '' } }) + '\n');
    fs.appendFileSync(sessionFile,
      JSON.stringify(makeUserMessage('정상', Date.now() + 100)) + '\n');
    await watcher._tick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message).toBe('정상');
    watcher.stop();
  });

  it('여러 세션 파일을 동시에 추적', async () => {
    const file2 = path.join(sessionDir, 'rollout-2026-04-29T11-00-00-second.jsonl');
    fs.writeFileSync(file2, '');

    const handler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: handler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
    });
    await watcher._tick();

    writeJsonlLines(sessionFile, [makeUserMessage('A', Date.now() + 100)]);
    writeJsonlLines(file2, [makeUserMessage('B', Date.now() + 200)]);
    await watcher._tick();

    expect(handler).toHaveBeenCalledTimes(2);
    const messages = handler.mock.calls.map((c) => c[0].message).sort();
    expect(messages).toEqual(['A', 'B']);
    watcher.stop();
  });

  function makeAgentMessage(text, timestampMs) {
    return {
      timestamp: new Date(timestampMs).toISOString(),
      type: 'event_msg',
      payload: { type: 'agent_message', message: text },
    };
  }

  it('한 turn 안의 여러 agent_message는 마지막 것만 송신 (다음 user_message가 트리거)', async () => {
    const userHandler = vi.fn();
    const assistantHandler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: userHandler,
      onAssistantMessage: assistantHandler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
      assistantTurnEndMs: 999999, // 타임아웃은 막아두고 user_message 트리거만 검증
    });
    await watcher._tick();

    const t0 = Date.now() + 100;
    writeJsonlLines(sessionFile, [
      makeUserMessage('첫 질문', t0),
      makeAgentMessage('중간 답변 1', t0 + 1000),
      makeAgentMessage('중간 답변 2', t0 + 2000),
      makeAgentMessage('최종 답변', t0 + 3000),
      makeUserMessage('두번째 질문', t0 + 4000),
    ]);
    await watcher._tick();

    // user_message 2번 (질문 + 다음 질문)
    expect(userHandler).toHaveBeenCalledTimes(2);
    // assistant는 마지막 것만 1번 (다음 user_message가 들어오면서 flush)
    expect(assistantHandler).toHaveBeenCalledTimes(1);
    expect(assistantHandler.mock.calls[0][0].message).toBe('최종 답변');
    watcher.stop();
  });

  it('침묵 타임아웃이 지나면 마지막 agent_message를 flush', async () => {
    const assistantHandler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: vi.fn(),
      onAssistantMessage: assistantHandler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
      assistantTurnEndMs: 50, // 50ms 후 타임아웃
    });
    await watcher._tick();

    const t0 = Date.now() + 100;
    writeJsonlLines(sessionFile, [
      makeAgentMessage('답변 A', t0),
      makeAgentMessage('답변 B (최종)', t0 + 10),
    ]);
    await watcher._tick();

    // 즉시 송신되지 않음 (타임아웃 대기 중)
    expect(assistantHandler).not.toHaveBeenCalled();

    // 타임아웃 지나면 송신
    await new Promise((r) => setTimeout(r, 100));
    expect(assistantHandler).toHaveBeenCalledTimes(1);
    expect(assistantHandler.mock.calls[0][0].message).toBe('답변 B (최종)');
    watcher.stop();
  });

  it('stop() 시 버퍼된 답변 flush — 손실 방지', async () => {
    const assistantHandler = vi.fn();
    const watcher = createCodexWatcher({
      onUserMessage: vi.fn(),
      onAssistantMessage: assistantHandler,
      sessionsDir: tempRoot,
      pollIntervalMs: 999999,
      assistantTurnEndMs: 999999,
    });
    await watcher._tick();

    writeJsonlLines(sessionFile, [
      makeAgentMessage('미처 보내지 못한 답변', Date.now() + 100),
    ]);
    await watcher._tick();
    expect(assistantHandler).not.toHaveBeenCalled();

    watcher.stop();
    // stop 직후 비동기 flush 끝날 때까지 한 틱 양보
    await new Promise((r) => setImmediate(r));
    expect(assistantHandler).toHaveBeenCalledTimes(1);
    expect(assistantHandler.mock.calls[0][0].message).toBe('미처 보내지 못한 답변');
  });
});
