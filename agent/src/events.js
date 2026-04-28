// Hook 이벤트 → 도메인 이벤트 변환. masking 적용 위치 단일화.
import { detectSuspicious, maskFirstLine } from './masking.js';

export const SUPPORTED_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'Stop',
];

/**
 * Normalize a raw Claude Code hook payload into the domain event shape we send onward.
 * Returns null if the event should be dropped (unsupported / failed validation / blacklisted).
 *
 * Inputs:
 *   raw = { event, sessionId, cwd, prompt?, toolName?, ... } (already JSON-parsed)
 *   opts = { isPrivate?, blacklistedDirs?: string[] }
 */
export function normalizeEvent(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') {
    return { dropped: true, reason: 'invalid_payload' };
  }
  const { event, sessionId, cwd } = raw;
  if (!SUPPORTED_EVENTS.includes(event)) {
    return { dropped: true, reason: 'unsupported_event' };
  }

  if (opts.isPrivate) {
    return { dropped: true, reason: 'privacy_on' };
  }

  if (cwd && Array.isArray(opts.blacklistedDirs) && opts.blacklistedDirs.length > 0) {
    const normalized = String(cwd).replace(/\\/g, '/').toLowerCase();
    for (const dir of opts.blacklistedDirs) {
      const normDir = String(dir).replace(/\\/g, '/').toLowerCase();
      if (normalized === normDir || normalized.startsWith(normDir + '/')) {
        return { dropped: true, reason: 'blacklisted_dir' };
      }
    }
  }

  const base = {
    event,
    sessionId: sessionId ?? null,
    cwd: cwd ?? null,
    occurredAt: new Date().toISOString(),
  };

  if (event === 'UserPromptSubmit') {
    const { masked, hits } = maskFirstLine(raw.prompt ?? '');
    const suspicious = detectSuspicious(masked);
    if (suspicious.length > 0) {
      return { dropped: true, reason: 'suspicious_after_mask', suspicious };
    }
    return { dropped: false, normalized: { ...base, promptFirstLine: masked, maskHits: hits } };
  }

  if (event === 'PreToolUse' || event === 'PostToolUse') {
    return {
      dropped: false,
      normalized: { ...base, toolName: raw.toolName ?? raw.tool_name ?? null },
    };
  }

  if (event === 'Stop') {
    return {
      dropped: false,
      normalized: { ...base, totalTokens: Number(raw.totalTokens ?? 0) },
    };
  }

  // SessionStart / SessionEnd — pass through with cli kind
  return {
    dropped: false,
    normalized: { ...base, cliKind: raw.cliKind ?? raw.cli ?? 'claude' },
  };
}
