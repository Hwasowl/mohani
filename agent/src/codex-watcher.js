// Codex CLI는 Claude Code 같은 hook이 없으니, 세션 jsonl 파일을 tail 해서 user_message를 잡아낸다.
// ~/.codex/sessions/YYYY/MM/DD/rollout-{ISO}-{UUID}.jsonl
// 매 줄 1개 이벤트: {timestamp, type: 'event_msg' | ..., payload: {type: 'user_message', message, ...}}
//
// 워처 시작 시점의 파일 크기를 기준으로 잡아 — 그 이전에 쌓인 메시지는 다시 전송하지 않는다.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const DEFAULT_POLL_MS = 5000;
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
// 24시간 이상 된 파일은 활성 세션이 아니므로 watcher 대상에서 제외 (디스크 I/O 절약).
const FRESH_WINDOW_MS = 24 * 3600 * 1000;

export function createCodexWatcher({
  onUserMessage,
  sessionsDir = DEFAULT_SESSIONS_DIR,
  pollIntervalMs = DEFAULT_POLL_MS,
  log = console,
  now = () => Date.now(),
} = {}) {
  if (typeof onUserMessage !== 'function') {
    throw new Error('onUserMessage handler is required');
  }
  const startedAtMs = now();
  // path → 마지막 처리한 byte offset
  const offsets = new Map();
  let timer = null;
  let running = false;

  async function listJsonlFiles() {
    if (!fs.existsSync(sessionsDir)) return [];
    const cutoff = now() - FRESH_WINDOW_MS;
    const out = [];
    async function walk(dir) {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile() && e.name.endsWith('.jsonl')) {
          try {
            const stat = await fsp.stat(full);
            if (stat.mtimeMs >= cutoff) {
              out.push({ path: full, size: stat.size });
            }
          } catch { /* permission/race — skip */ }
        }
      }
    }
    await walk(sessionsDir);
    return out;
  }

  async function readNewLines(filePath, fromOffset, toOffset) {
    if (toOffset <= fromOffset) return;
    const stream = fs.createReadStream(filePath, { start: fromOffset, end: toOffset - 1 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      await handleEntry(entry, filePath);
    }
  }

  async function handleEntry(entry, filePath) {
    if (!entry || entry.type !== 'event_msg') return;
    const payload = entry.payload;
    if (!payload || payload.type !== 'user_message') return;
    if (typeof payload.message !== 'string' || payload.message.length === 0) return;

    // 워처 시작 이전의 timestamp는 무시 — agent 재시작 시 과거 활동 재전송 방지.
    const tsMs = Date.parse(entry.timestamp ?? '');
    if (Number.isFinite(tsMs) && tsMs < startedAtMs) return;

    try {
      await onUserMessage({
        message: payload.message,
        occurredAt: entry.timestamp ?? new Date().toISOString(),
        sessionFile: filePath,
      });
    } catch (err) {
      log.warn?.('[codex-watcher] onUserMessage error:', err.message);
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const files = await listJsonlFiles();
      for (const f of files) {
        if (!offsets.has(f.path)) {
          // 신규 발견 — 현재 끝을 baseline으로 (= 이전 내용은 무시)
          offsets.set(f.path, f.size);
          continue;
        }
        const prev = offsets.get(f.path);
        if (f.size > prev) {
          await readNewLines(f.path, prev, f.size);
          offsets.set(f.path, f.size);
        }
      }
    } catch (err) {
      log.warn?.('[codex-watcher] tick error:', err.message);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      // 즉시 1회 — baseline 등록
      tick();
      timer = setInterval(tick, pollIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    // 테스트용
    _tick: tick,
    _offsets: offsets,
  };
}
