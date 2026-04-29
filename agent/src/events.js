// Hook 이벤트 → 도메인 이벤트 변환. masking 적용 위치 단일화.
import { detectSuspicious, maskBody, maskFirstLine } from './masking.js';

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

  // transcriptPath는 Stop 이벤트 처리(daemon)에서 정확한 토큰을 위해 사용된다 — 항상 통과
  base.transcriptPath = raw.transcriptPath ?? raw.transcript_path ?? null;

  if (event === 'UserPromptSubmit') {
    const rawPrompt = raw.prompt ?? '';
    const { masked, hits } = maskFirstLine(rawPrompt);
    const { masked: fullMasked, hits: fullHits } = maskBody(rawPrompt);
    const suspicious = detectSuspicious(masked);
    const suspiciousFull = detectSuspicious(fullMasked);
    if (suspicious.length > 0 || suspiciousFull.length > 0) {
      return { dropped: true, reason: 'suspicious_after_mask',
               suspicious: suspicious.concat(suspiciousFull) };
    }
    // 토큰은 Stop 이벤트에서 transcript 읽어 정확히 측정 — 여기선 안 셈 (이중 카운트 방지)
    return {
      dropped: false,
      normalized: {
        ...base,
        promptFirstLine: masked,
        promptFull: fullMasked,
        maskHits: Array.from(new Set([...hits, ...fullHits])),
      },
    };
  }

  if (event === 'PreToolUse' || event === 'PostToolUse') {
    return {
      dropped: false,
      normalized: { ...base, toolName: raw.toolName ?? raw.tool_name ?? null },
    };
  }

  if (event === 'Stop') {
    // raw.totalTokens가 직접 들어오면 우선시 (테스트/외부 통합용). 실제 사용 시엔
    // daemon이 transcriptPath 기반으로 정확한 값을 채워넣는다.
    const direct = raw.totalTokens != null ? Number(raw.totalTokens) : null;
    return {
      dropped: false,
      normalized: { ...base, totalTokens: direct },
    };
  }

  // SessionStart / SessionEnd — pass through with cli kind
  return {
    dropped: false,
    normalized: { ...base, cliKind: raw.cliKind ?? raw.cli ?? 'claude' },
  };
}
