// Settings.json 안전 머지/제거 — 순수 함수.
// 사용자 기존 hook 항목은 절대 건드리지 않는다 — mohani-hook prefix만 식별·제거.

export const MOHANI_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'Stop',
];

export const MOHANI_PREFIX = 'mohani-hook';
// dev mode: settings.json에 절대경로로 등록될 때 식별 토큰
const MOHANI_HOOK_FILE = 'hook-cli.js';

function buildHookEntry(event, commandPrefix) {
  return {
    type: 'command',
    command: `${commandPrefix} --event=${event}`,
  };
}

function buildMatcherBlock(event, commandPrefix) {
  return {
    matcher: '',
    hooks: [buildHookEntry(event, commandPrefix)],
  };
}

function isMohaniHookEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.command !== 'string') return false;
  const c = entry.command;
  // 식별 가능한 케이스:
  //   1) global npm install: "mohani-hook --event=..."
  //   2) dev install: 'node "<abs>/agent/src/hook-cli.js" --event=...'
  //   3) Electron 번들 install: '"<install-dir>/mohani-hook.cmd" --event=...'
  return c.startsWith(MOHANI_PREFIX)
      || c.includes(MOHANI_HOOK_FILE)
      || c.includes('mohani-hook.cmd');
}

/**
 * Add mohani hook entries to a settings object, returning a NEW object.
 * Idempotent — safe to call multiple times.
 * Existing hook entries are never modified.
 *
 * options.commandPrefix — defaults to 'mohani-hook' (global install).
 *   For dev mode, pass `node "<absPath>/hook-cli.js"` so Claude Code can locate the script.
 * options.events — events to register (defaults to MOHANI_EVENTS).
 */
export function mergeMohaniHooks(settings, options = {}) {
  const events = Array.isArray(options) ? options : (options.events || MOHANI_EVENTS);
  const commandPrefix = (Array.isArray(options) ? null : options.commandPrefix) || MOHANI_PREFIX;
  const next = settings && typeof settings === 'object' ? { ...settings } : {};
  const hooks = next.hooks && typeof next.hooks === 'object' ? { ...next.hooks } : {};

  for (const event of events) {
    const existing = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
    const alreadyHasMohani = existing.some(
      (block) =>
        block &&
        Array.isArray(block.hooks) &&
        block.hooks.some(isMohaniHookEntry),
    );
    if (!alreadyHasMohani) {
      existing.push(buildMatcherBlock(event, commandPrefix));
    }
    hooks[event] = existing;
  }

  next.hooks = hooks;
  return next;
}

/**
 * Remove only the mohani hook entries, leaving all other hooks untouched.
 * Returns a NEW settings object.
 */
export function removeMohaniHooks(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const next = { ...settings };
  if (!next.hooks || typeof next.hooks !== 'object') return next;

  const hooks = {};
  for (const [event, blocks] of Object.entries(next.hooks)) {
    if (!Array.isArray(blocks)) {
      hooks[event] = blocks;
      continue;
    }
    const cleanedBlocks = blocks
      .map((block) => {
        if (!block || !Array.isArray(block.hooks)) return block;
        const filtered = block.hooks.filter((h) => !isMohaniHookEntry(h));
        if (filtered.length === 0) return null; // matcher block becomes empty → drop
        if (filtered.length === block.hooks.length) return block; // unchanged
        return { ...block, hooks: filtered };
      })
      .filter((b) => b !== null);
    if (cleanedBlocks.length > 0) {
      hooks[event] = cleanedBlocks;
    }
    // 우리 hook만 있던 이벤트 키는 통째로 사라짐 — 사용자 다른 hook이 있으면 유지
  }
  next.hooks = hooks;
  return next;
}

/**
 * Diagnostic: count mohani hook entries currently registered.
 */
export function countMohaniHooks(settings) {
  if (!settings?.hooks) return 0;
  let n = 0;
  for (const blocks of Object.values(settings.hooks)) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block && Array.isArray(block.hooks)) {
        n += block.hooks.filter(isMohaniHookEntry).length;
      }
    }
  }
  return n;
}

export const _internals = { buildHookEntry, buildMatcherBlock, isMohaniHookEntry };
