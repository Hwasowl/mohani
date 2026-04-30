#!/usr/bin/env node
// Claude Code hook 진입점. stdin JSON payload를 받아 데몬으로 전달.
// Usage: mohani-hook --event=UserPromptSubmit
//
// Claude Code hooks 호출 컨벤션:
//   - hook config의 command가 stdin으로 JSON payload를 받음
//   - exit code 0 = 정상, 비-0 = Claude에 에러 표시
//
// 우리는 항상 exit 0 — 데몬 통신 실패가 사용자 작업을 방해하면 안 됨.

import { argv, env, exit, stderr, stdin } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { load as loadConfig } from './config-store.js';

const HOST = env.MOHANI_AGENT_HOST || '127.0.0.1';
const PORTS = (env.MOHANI_AGENT_PORTS || '24555,24556,24557').split(',').map(Number);
const TIMEOUT_MS = Number(env.MOHANI_HOOK_TIMEOUT_MS || 1500);

// H1: ~/.mohani/config.json에서 localSecret 읽어 헤더 첨부.
// secret은 데몬 첫 기동 시 생성됨 — hook-cli가 먼저 호출되면 secret이 없을 수 있어 fail-soft.
function readLocalSecret() {
  try {
    const cfg = loadConfig();
    return typeof cfg.localSecret === 'string' ? cfg.localSecret : null;
  } catch {
    return null;
  }
}

function parseEventArg(args) {
  for (const a of args) {
    if (a.startsWith('--event=')) return a.slice('--event='.length);
  }
  const idx = args.indexOf('--event');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

async function readStdin() {
  let buf = '';
  for await (const chunk of stdin) buf += chunk;
  return buf;
}

async function postOnce(port, body, secret) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (secret) headers.authorization = `Bearer ${secret}`;
    const res = await fetch(`http://${HOST}:${port}/agent/event`, {
      method: 'POST',
      headers,
      body,
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function sendToDaemon(payload, ports = PORTS, secret = null) {
  const body = JSON.stringify(payload);
  const localSecret = secret ?? readLocalSecret();
  for (const port of ports) {
    if (await postOnce(port, body, localSecret)) return { ok: true, port };
  }
  return { ok: false };
}

export function buildPayload(event, raw) {
  let parsed = {};
  try {
    parsed = raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    parsed = { _rawPayload: raw };
  }
  return {
    event,
    sessionId: parsed.session_id ?? parsed.sessionId ?? null,
    cwd: parsed.cwd ?? null,
    prompt: parsed.prompt ?? null,
    toolName: parsed.tool_name ?? parsed.toolName ?? null,
    totalTokens: parsed.total_tokens ?? parsed.totalTokens ?? null,
    transcriptPath: parsed.transcript_path ?? parsed.transcriptPath ?? null,
    cliKind: 'claude',
  };
}

const isMain = argv[1] && import.meta.url === pathToFileURL(argv[1]).href;
if (isMain) {
  const event = parseEventArg(argv.slice(2));
  if (!event) {
    stderr.write('mohani-hook: --event=<EventName> required\n');
    exit(0); // 사용자 작업 차단 X
  }
  // 입력 readall, 빠른 fail
  Promise.race([readStdin(), delay(800).then(() => '')])
    .then(async (raw) => {
      const payload = buildPayload(event, raw);
      await sendToDaemon(payload);
      exit(0);
    })
    .catch(() => exit(0));
}
