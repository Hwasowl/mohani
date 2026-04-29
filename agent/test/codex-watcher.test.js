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
});
