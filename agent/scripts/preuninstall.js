#!/usr/bin/env node
// `npm uninstall -g @mohani/agent` 시 실행. mohani-hook 항목만 정확히 제거.
import { uninstallFromSettings } from '../src/install-fs.js';

try {
  const isGlobal = process.env.npm_config_global === 'true';
  if (!isGlobal) {
    process.exit(0);
  }

  const { backupPath, mode, path } = uninstallFromSettings();
  console.log(`[mohani] hook ${mode} ← ${path}`);
  if (backupPath) console.log(`[mohani] backup: ${backupPath}`);
} catch (err) {
  console.error(`[mohani] hook uninstall failed: ${err.message}`);
  console.error('[mohani] manual cleanup may be needed in ~/.claude/settings.json');
  process.exit(0);
}
