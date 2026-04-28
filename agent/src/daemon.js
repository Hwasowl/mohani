#!/usr/bin/env node
// Mohani local daemon — Claude Code hook 수신 → 마스킹/필터 → 백엔드 송신.
// 24555 → 24556 → 24557 자동 폴백.

import express from 'express';
import { pathToFileURL } from 'node:url';
import { load, save } from './config-store.js';
import { normalizeEvent } from './events.js';
import { createTransport } from './transport.js';

const PORT_CANDIDATES = [24555, 24556, 24557];

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

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0', queueDepth: state.transport?.queueDepth?.() ?? 0 });
  });

  // Electron이 데몬에서 현재 사용자 정보·비공개 토글을 폴링/제어할 때 사용.
  app.get('/state', (_req, res) => {
    const cfg = state.getConfig?.() ?? {};
    res.json({
      loggedIn: Boolean(cfg.token),
      userId: cfg.userId ?? null,
      displayName: cfg.displayName ?? null,
      backendUrl: cfg.backendUrl ?? null,
      isPrivate: cfg.isPrivate ?? false,
      blacklistedDirs: cfg.blacklistedDirs ?? [],
    });
  });

  app.post('/state/privacy', (req, res) => {
    const next = Boolean(req.body?.isPrivate);
    const cfg = state.getConfig?.() ?? {};
    save({ ...cfg, isPrivate: next });
    state.refreshConfig?.();
    res.json({ ok: true, isPrivate: next });
  });

  app.post('/agent/event', async (req, res) => {
    const cfg = state.getConfig?.() ?? {};
    const result = normalizeEvent(req.body, {
      isPrivate: cfg.isPrivate ?? false,
      blacklistedDirs: cfg.blacklistedDirs ?? [],
    });

    if (result.dropped) {
      return res.json({ ok: true, dropped: true, reason: result.reason });
    }

    state.lastEvent = result.normalized;
    if (state.onEvent) state.onEvent(result.normalized);

    let backend = null;
    if (state.transport) {
      backend = await state.transport.send(result.normalized);
    }

    return res.json({ ok: true, normalized: result.normalized, backend });
  });

  return app;
}

export function listenWithFallback(app, ports = PORT_CANDIDATES) {
  return new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= ports.length) {
        return reject(new Error(`all candidate ports exhausted: ${ports.join(',')}`));
      }
      const port = ports[idx++];
      const server = app.listen(port);
      server.once('listening', () => resolve({ server, port }));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          tryNext();
        } else {
          reject(err);
        }
      });
    };
    tryNext();
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let cfg = load();
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
  const app = createApp(state);
  listenWithFallback(app)
    .then(({ port }) => {
      console.log(`[mohani-agent] listening on http://127.0.0.1:${port}`);
      console.log(`[mohani-agent] backend=${cfg.backendUrl} loggedIn=${Boolean(cfg.token)}`);
    })
    .catch((err) => {
      console.error('[mohani-agent] failed to start:', err.message);
      process.exit(1);
    });
}
