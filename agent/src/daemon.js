#!/usr/bin/env node
// Mohani local daemon — Claude Code hook 수신 → 마스킹/필터 → (W1) console 출력.
// 24555 → 24556 → 24557 자동 폴백.

import express from 'express';
import { normalizeEvent } from './events.js';

const PORT_CANDIDATES = [24555, 24556, 24557];

export function createApp(state = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: '0.1.0' });
  });

  app.post('/agent/event', (req, res) => {
    const result = normalizeEvent(req.body, {
      isPrivate: state.isPrivate ?? false,
      blacklistedDirs: state.blacklistedDirs ?? [],
    });

    if (result.dropped) {
      // 200으로 응답 — hook은 성공 처리, 단지 우리가 무음 드롭
      return res.json({ ok: true, dropped: true, reason: result.reason });
    }

    // W1: console 출력. W2부터 transport.js 로 백엔드 송신.
    state.lastEvent = result.normalized;
    if (state.onEvent) state.onEvent(result.normalized);
    return res.json({ ok: true, normalized: result.normalized });
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

// CLI 진입 (npm bin)
const isMain = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  const app = createApp({});
  listenWithFallback(app)
    .then(({ port }) => {
      console.log(`[mohani-agent] listening on http://127.0.0.1:${port}`);
    })
    .catch((err) => {
      console.error('[mohani-agent] failed to start:', err.message);
      process.exit(1);
    });
}
