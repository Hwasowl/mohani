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

function buildHookEntry(event) {
  return {
    type: 'command',
    command: `${MOHANI_PREFIX} --event=${event}`,
  };
}

function buildMatcherBlock(event) {
  return {
    matcher: '',
    hooks: [buildHookEntry(event)],
  };
}

function isMohaniHookEntry(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    typeof entry.command === 'string' &&
    entry.command.startsWith(MOHANI_PREFIX)
  );
}

/**
 * Add mohani hook entries to a settings object, returning a NEW object.
 * Idempotent — safe to call multiple times.
 * Existing hook entries are never modified.
 */
export function mergeMohaniHooks(settings, events = MOHANI_EVENTS) {
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
      existing.push(buildMatcherBlock(event));
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
