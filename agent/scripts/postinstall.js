#!/usr/bin/env node
// `npm i -g @mohani/agent` 시 실행. ~/.claude/settings.json 백업 후 안전 머지.
import { installToSettings } from '../src/install-fs.js';

try {
  // dev local install (`npm install` in repo)에서는 사용자 settings.json을 건드리지 않는다.
  // npm은 글로벌 설치 시 npm_config_global=true 를 set한다.
  const isGlobal = process.env.npm_config_global === 'true';
  if (!isGlobal) {
    // 조용히 종료 — dev install 중인 사람에게 노이즈 주지 않음
    process.exit(0);
  }

  // 사용자가 명시적으로 비활성화 가능
  if (process.env.MOHANI_SKIP_HOOK_INSTALL === '1') {
    console.log('[mohani] MOHANI_SKIP_HOOK_INSTALL=1 — skipping hook registration');
    process.exit(0);
  }

  const { backupPath, mode, path } = installToSettings();
  console.log(`[mohani] hook ${mode} → ${path}`);
  if (backupPath) console.log(`[mohani] backup: ${backupPath}`);
  console.log('[mohani] tip: run `mohani team join <code>` to start sharing');
} catch (err) {
  // 설치 실패가 npm install -g 자체를 망가뜨리면 안 됨
  console.error(`[mohani] hook install failed: ${err.message}`);
  console.error('[mohani] you can re-run later: `mohani hooks install`');
  process.exit(0);
}
