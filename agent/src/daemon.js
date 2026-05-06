#!/usr/bin/env node
// Mohani local daemon — Claude Code hook 수신 → 마스킹/필터 → 백엔드 송신.
// 24555 → 24556 → 24557 자동 폴백.

import express from 'express';
import { pathToFileURL } from 'node:url';
import { createCodexWatcher } from './codex-watcher.js';
import { load, loadAndPrime, save } from './config-store.js';
import { normalizeEvent } from './events.js';
import { detectSuspicious, maskBody, maskFirstLine, previewLines } from './masking.js';
import { readLastAssistantTurn, readLastAssistantUsage } from './transcript.js';
import { createTransport } from './transport.js';
import { applyVisibility } from './visibility.js';

// prod 데몬: 24555 (글로벌 `mohani start`)
// dev 데몬:  --dev 인자로 띄우면 24565 — prod와 동시 기동해도 충돌 X
const IS_DEV = process.argv.includes('--dev');
const PORT = IS_DEV ? 24565 : 24555;
// hook 이벤트 사이 간격이 이 값을 넘으면 "잠수" — 시간 누적 안함 (자리 비움 시간 차단)
const ACTIVE_GAP_CAP_SEC = 60;

export function createApp(state = {}) {
  const app = express();
  // 데몬은 127.0.0.1에만 바인딩되므로 origin 제한 의미 적음 — Electron renderer/Vite/file://의 모든 호출 허용
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  // H1: 로컬 secret 인증 미들웨어. /health 외 모든 endpoint에 Authorization: Bearer <localSecret> 요구.
  // 같은 머신의 정상 클라이언트(Electron preload, mohani-hook)는 ~/.mohani/config.json에서 secret을 읽어 헤더 첨부.
  // 외부 웹사이트(CSRF)나 LAN 공격자는 secret을 모르므로 401.
  function requireLocalSecret(req, res, next) {
    const cfg = state.getConfig?.() ?? {};
    const expected = cfg.localSecret;
    if (!expected) {
      // secret이 아직 안 만들어진 비정상 상태 — fail-closed.
      return res.status(503).json({ error: 'daemon not initialized' });
    }
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing local secret' });
    }
    const token = header.slice('Bearer '.length).trim();
    if (token !== expected) {
      return res.status(401).json({ error: 'invalid local secret' });
    }
    next();
  }

  // /health: 외부 health check 가능 (sensitive 정보 미노출).
  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0', queueDepth: state.transport?.queueDepth?.() ?? 0 });
  });

  // Electron이 데몬에서 현재 사용자 정보·비공개 토글·숨김 토글을 폴링/제어할 때 사용.
  app.get('/state', requireLocalSecret, (_req, res) => {
    const cfg = state.getConfig?.() ?? {};
    res.json({
      loggedIn: Boolean(cfg.token),
      userId: cfg.userId ?? null,
      displayName: cfg.displayName ?? null,
      backendUrl: cfg.backendUrl ?? null,
      isPrivate: cfg.isPrivate ?? false,
      hideQuestion: cfg.hideQuestion ?? false,
      hideAnswer: cfg.hideAnswer ?? false,
      blacklistedDirs: cfg.blacklistedDirs ?? [],
    });
  });

  app.post('/state/privacy', requireLocalSecret, (req, res) => {
    const next = Boolean(req.body?.isPrivate);
    const cfg = state.getConfig?.() ?? {};
    save({ ...cfg, isPrivate: next });
    state.refreshConfig?.();
    res.json({ ok: true, isPrivate: next });
  });

  // 질문/답변 숨김 토글 — 본문만 redact, 활동 자체는 노출(오프라인 모드와 다른 점).
  // 두 필드는 독립 토글. body에 명시된 것만 갱신, 누락된 건 기존값 보존.
  app.post('/state/visibility', requireLocalSecret, (req, res) => {
    const cfg = state.getConfig?.() ?? {};
    const body = req.body ?? {};
    const next = { ...cfg };
    if ('hideQuestion' in body) next.hideQuestion = Boolean(body.hideQuestion);
    if ('hideAnswer' in body) next.hideAnswer = Boolean(body.hideAnswer);
    save(next);
    state.refreshConfig?.();
    res.json({
      ok: true,
      hideQuestion: next.hideQuestion ?? false,
      hideAnswer: next.hideAnswer ?? false,
    });
  });

  // Electron이 로그인 후 데몬에 토큰을 주입 — hook이 백엔드로 흘러가게 만든다.
  // 누락된 필드는 기존 cfg 값을 보존.
  app.post('/state/session', requireLocalSecret, (req, res) => {
    const cfg = state.getConfig?.() ?? {};
    const body = req.body ?? {};
    const next = {
      ...cfg,
      backendUrl: body.backendUrl ?? cfg.backendUrl,
      token: body.token ?? cfg.token,
      userId: body.userId ?? cfg.userId,
      displayName: body.displayName ?? cfg.displayName,
    };
    save(next);
    state.refreshConfig?.();
    res.json({ ok: true, loggedIn: Boolean(next.token), userId: next.userId });
  });

  app.post('/agent/event', requireLocalSecret, async (req, res) => {
    const cfg = state.getConfig?.() ?? {};
    const result = normalizeEvent(req.body, {
      isPrivate: cfg.isPrivate ?? false,
      blacklistedDirs: cfg.blacklistedDirs ?? [],
    });

    if (result.dropped) {
      return res.json({ ok: true, dropped: true, reason: result.reason });
    }

    // 마지막 이벤트로부터 경과 시간(초)을 측정해 durationDeltaSec로 보낸다.
    // Claude Code의 hook payload는 시간을 안 주므로 데몬이 직접 추정한다.
    const now = Date.now();
    const last = state.lastEventAt ?? 0;
    const gapSec = last ? Math.round((now - last) / 1000) : 0;
    if (gapSec > 0 && gapSec <= ACTIVE_GAP_CAP_SEC) {
      result.normalized.durationDeltaSec = gapSec;
    }
    state.lastEventAt = now;

    // Stop 이벤트: transcript JSONL을 읽어 마지막 assistant turn의 본문 + 토큰 + 도구 사용 횟수를 채운다.
    if (result.normalized.event === 'Stop' && result.normalized.transcriptPath) {
      const turn = readLastAssistantTurn(result.normalized.transcriptPath);
      if (turn) {
        // 토큰 (기존 동작 유지)
        if (turn.tokens > 0) {
          const sessionId = result.normalized.sessionId ?? 'default';
          state.lastTokenTotalBySession ??= {};
          const prev = state.lastTokenTotalBySession[sessionId] ?? 0;
          const delta = Math.max(0, turn.tokens);
          result.normalized.totalTokens = delta;
          state.lastTokenTotalBySession[sessionId] = prev + delta;
        }
        // 답변 본문 — 마스킹 후 preview/full 분리. 의심 패턴 잡히면 caller에서 drop.
        if (turn.text && turn.text.length > 0) {
          const { masked: fullMasked, hits } = maskBody(turn.text);
          const susp = detectSuspicious(fullMasked);
          if (susp.length > 0) {
            console.warn('[mohani-agent] suspicious in assistant body, dropping text:', susp.join(','));
          } else {
            result.normalized.assistantFull = fullMasked;
            result.normalized.assistantPreview = previewLines(fullMasked, { maxLines: 3, maxChars: 500 });
            if (hits.length > 0) result.normalized.assistantMaskHits = hits;
          }
        }
        result.normalized.toolUseCount = turn.toolUseCount;
      }
    }

    // 송신 직전 — 사용자가 켠 질문/답변 숨김 토글에 따라 본문만 redact.
    // (오프라인 상태/blacklist는 위에서 dropped로 끝났음)
    const toSend = applyVisibility(result.normalized, {
      hideQuestion: cfg.hideQuestion ?? false,
      hideAnswer: cfg.hideAnswer ?? false,
    });

    state.lastEvent = toSend;
    if (state.onEvent) state.onEvent(toSend);

    let backend = null;
    if (state.transport) {
      backend = await state.transport.send(toSend);
    }

    return res.json({ ok: true, normalized: toSend, backend });
  });

  return app;
}

// 단일 포트에 listen — 점유돼있으면 그대로 fail (사용자가 충돌 인지하도록).
// 127.0.0.1 강제 — LAN 노출 차단.
export function listen(app, port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1');
    server.once('listening', () => resolve({ server, port }));
    server.once('error', reject);
  });
}

// Codex 세션 jsonl에서 잡은 user_message 한 건을 백엔드 DTO 흐름으로 보낸다.
// — 마스킹 + 의심 패턴 검사 + privacy/blacklist는 events.js와 동일 정책 재사용.
export async function dispatchCodexUserMessage({ message, occurredAt }, { getConfig, transport, log = console }) {
  const cfg = getConfig?.() ?? {};
  if (cfg.isPrivate) return { dropped: true, reason: 'privacy_on' };

  const { masked } = maskFirstLine(message);
  const { masked: fullMasked } = maskBody(message);
  const suspicious = detectSuspicious(masked).concat(detectSuspicious(fullMasked));
  if (suspicious.length > 0) {
    log.warn?.('[codex] suspicious after mask, dropping');
    return { dropped: true, reason: 'suspicious_after_mask' };
  }

  if (!transport) return { dropped: true, reason: 'no_transport' };
  const payload = applyVisibility({
    event: 'UserPromptSubmit',
    sessionId: null,
    cwd: null,
    promptFirstLine: masked,
    promptFull: fullMasked,
    toolName: null,
    totalTokens: null,
    durationDeltaSec: null,
    cliKind: 'codex',
    occurredAt: occurredAt ?? new Date().toISOString(),
  }, { hideQuestion: cfg.hideQuestion ?? false, hideAnswer: cfg.hideAnswer ?? false });
  return transport.send(payload);
}

// Codex agent_message — 백엔드에 Stop 이벤트로 보내서 직전 user_message turn에 합치게 한다.
export async function dispatchCodexAssistantMessage({ message, occurredAt }, { getConfig, transport, log = console }) {
  const cfg = getConfig?.() ?? {};
  if (cfg.isPrivate) return { dropped: true, reason: 'privacy_on' };

  const { masked: fullMasked } = maskBody(message);
  const suspicious = detectSuspicious(fullMasked);
  if (suspicious.length > 0) {
    log.warn?.('[codex] assistant suspicious after mask, dropping');
    return { dropped: true, reason: 'suspicious_after_mask' };
  }
  const preview = previewLines(fullMasked, { maxLines: 3, maxChars: 500 });

  if (!transport) return { dropped: true, reason: 'no_transport' };
  const payload = applyVisibility({
    event: 'Stop',
    sessionId: null,
    cwd: null,
    assistantPreview: preview,
    assistantFull: fullMasked,
    toolUseCount: 0,
    totalTokens: null,
    durationDeltaSec: null,
    cliKind: 'codex',
    occurredAt: occurredAt ?? new Date().toISOString(),
  }, { hideQuestion: cfg.hideQuestion ?? false, hideAnswer: cfg.hideAnswer ?? false });
  return transport.send(payload);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // loadAndPrime — deviceId/localSecret 없으면 자동 생성·저장.
  let cfg = loadAndPrime();
  const state = {
    getConfig: () => cfg,
    refreshConfig: () => { cfg = load(); },
  };
  state.transport = createTransport({ getConfig: () => cfg });
  state.onEvent = (e) => {
    if (process.env.MOHANI_LOG === 'verbose') {
      console.log('[mohani-agent] event', e.event, e.promptFirstLine ?? e.toolName ?? '');
    }
  };

  // Codex CLI는 hook 시스템이 없으므로 ~/.codex/sessions/ 의 jsonl을 tail.
  const codexWatcher = createCodexWatcher({
    onUserMessage: async (msg) => {
      try {
        await dispatchCodexUserMessage(msg, { getConfig: () => cfg, transport: state.transport });
        if (process.env.MOHANI_LOG === 'verbose') {
          console.log('[mohani-agent] codex user_message →', msg.message.slice(0, 60));
        }
      } catch (err) {
        console.warn('[mohani-agent] codex dispatch failed:', err.message);
      }
    },
    onAssistantMessage: async (msg) => {
      try {
        await dispatchCodexAssistantMessage(msg, { getConfig: () => cfg, transport: state.transport });
        if (process.env.MOHANI_LOG === 'verbose') {
          console.log('[mohani-agent] codex agent_message →', msg.message.slice(0, 60));
        }
      } catch (err) {
        console.warn('[mohani-agent] codex assistant dispatch failed:', err.message);
      }
    },
  });
  codexWatcher.start();

  const app = createApp(state);
  listen(app)
    .then(({ port }) => {
      console.log(`[mohani-agent] listening on http://127.0.0.1:${port} ${IS_DEV ? '(DEV)' : '(PROD)'}`);
      console.log(`[mohani-agent] backend=${cfg.backendUrl} loggedIn=${Boolean(cfg.token)}`);
      console.log(`[mohani-agent] codex watcher started`);
    })
    .catch((err) => {
      console.error('[mohani-agent] failed to start:', err.message);
      process.exit(1);
    });
}
