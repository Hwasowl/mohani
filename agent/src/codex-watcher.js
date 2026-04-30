// Codex CLI는 Claude Code 같은 hook이 없으니, 세션 jsonl 파일을 tail 해서 user_message를 잡아낸다.
// ~/.codex/sessions/YYYY/MM/DD/rollout-{ISO}-{UUID}.jsonl
// 매 줄 1개 이벤트: {timestamp, type: 'event_msg' | ..., payload: {type: 'user_message', message, ...}}
//
// 워처 시작 시점의 파일 크기를 기준으로 잡아 — 그 이전에 쌓인 메시지는 다시 전송하지 않는다.
//
// agent_message는 한 turn 안에서 여러 번 emit됨 (중간 진행 + 최종 답변). 모두 그대로 송신하면
// 친구 피드에 답변이 N개 박힘 → 마지막 것만 골라야 함.
// 전략: per-session으로 가장 최근 agent_message만 버퍼링 → (a) 다음 user_message가 오면 flush,
// 또는 (b) assistantTurnEndMs 동안 침묵하면 flush.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const DEFAULT_POLL_MS = 5000;
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
// 24시간 이상 된 파일은 활성 세션이 아니므로 watcher 대상에서 제외 (디스크 I/O 절약).
const FRESH_WINDOW_MS = 24 * 3600 * 1000;
// agent_message 이후 이만큼 침묵하면 turn 종료로 간주, 버퍼된 마지막 답변 flush.
const DEFAULT_ASSISTANT_TURN_END_MS = 30 * 1000;

export function createCodexWatcher({
  onUserMessage,
  onAssistantMessage,
  sessionsDir = DEFAULT_SESSIONS_DIR,
  pollIntervalMs = DEFAULT_POLL_MS,
  assistantTurnEndMs = DEFAULT_ASSISTANT_TURN_END_MS,
  log = console,
  now = () => Date.now(),
} = {}) {
  if (typeof onUserMessage !== 'function') {
    throw new Error('onUserMessage handler is required');
  }
  const startedAtMs = now();
  // path → 마지막 처리한 byte offset
  const offsets = new Map();
  // path → { msg, timer } : per-session 가장 최근 agent_message 버퍼
  const assistantBuffers = new Map();
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

  function bufferAssistant(filePath, msg) {
    const prev = assistantBuffers.get(filePath);
    if (prev?.timer) clearTimeout(prev.timer);
    const t = setTimeout(() => { flushAssistant(filePath); }, assistantTurnEndMs);
    t.unref?.();
    assistantBuffers.set(filePath, { msg, timer: t });
  }

  async function flushAssistant(filePath) {
    const buf = assistantBuffers.get(filePath);
    if (!buf) return;
    if (buf.timer) clearTimeout(buf.timer);
    assistantBuffers.delete(filePath);
    if (typeof onAssistantMessage !== 'function') return;
    try {
      await onAssistantMessage(buf.msg);
    } catch (err) {
      log.warn?.('[codex-watcher] onAssistantMessage error:', err.message);
    }
  }

  async function handleEntry(entry, filePath) {
    if (!entry || entry.type !== 'event_msg') return;
    const payload = entry.payload;
    if (!payload) return;

    // 워처 시작 이전의 timestamp는 무시 — agent 재시작 시 과거 활동 재전송 방지.
    const tsMs = Date.parse(entry.timestamp ?? '');
    if (Number.isFinite(tsMs) && tsMs < startedAtMs) return;
    const occurredAt = entry.timestamp ?? new Date().toISOString();

    if (payload.type === 'user_message') {
      if (typeof payload.message !== 'string' || payload.message.length === 0) return;
      // 새 user_message → 직전 turn의 마지막 assistant 답변 먼저 flush.
      await flushAssistant(filePath);
      try {
        await onUserMessage({
          message: payload.message,
          occurredAt,
          sessionFile: filePath,
        });
      } catch (err) {
        log.warn?.('[codex-watcher] onUserMessage error:', err.message);
      }
      return;
    }

    if (payload.type === 'agent_message' && typeof onAssistantMessage === 'function') {
      // Codex의 agent_message 본문 위치는 버전마다 message/text/content 등 다름 — 우선순위로 시도.
      const text = payload.message ?? payload.text ?? payload.content ?? null;
      if (typeof text !== 'string' || text.length === 0) return;
      // 즉시 송신하지 않고 버퍼링 — 다음 user_message 또는 침묵 타임아웃 시 flush.
      bufferAssistant(filePath, {
        message: text,
        occurredAt,
        sessionFile: filePath,
      });
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
      // 종료 시 버퍼된 마지막 답변들 flush — 손실 방지.
      for (const p of [...assistantBuffers.keys()]) {
        flushAssistant(p);
      }
    },
    // 테스트용
    _tick: tick,
    _offsets: offsets,
    _flushAssistant: flushAssistant,
    _assistantBuffers: assistantBuffers,
  };
}
