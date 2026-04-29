// L3 첫 줄 + 200자 + 민감정보 마스킹.
// 외부 의존성 없이 순수 함수로 유지 — Spring 서버 재검증에서 동일 정책 재사용 가능.

const MAX_LEN = 200;

const PATTERNS = [
  // AWS access keys (AKIA, ASIA prefix)
  { name: 'AWS_KEY', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: '●●●AWS_KEY●●●' },
  // Google Cloud API keys
  { name: 'GCP_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: '●●●GCP_KEY●●●' },
  // JWT (eyJ... three parts)
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replace: '●●●JWT●●●' },
  // Bearer tokens
  { name: 'BEARER', re: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replace: 'Bearer ●●●' },
  // Generic api/secret/token assignment (e.g. apiKey: "abc123...", api_key=xyz)
  {
    name: 'API_KEY_ASSIGN',
    re: /\b(api[_-]?key|secret|token|access[_-]?key)\s*([:=])\s*["']?([A-Za-z0-9_\-]{16,})["']?/gi,
    replace: (_m, key, sep) => `${key}${sep}●●●`,
  },
  // password: ... or password=...
  {
    name: 'PASSWORD',
    re: /\b(password|passwd|pwd)\s*([:=])\s*["']?([^\s"']+)["']?/gi,
    replace: (_m, key, sep) => `${key}${sep}●●●`,
  },
  // Email
  { name: 'EMAIL', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replace: '●●●@●●●' },
  // URL query token/key/secret param
  {
    name: 'URL_TOKEN',
    re: /([?&](?:token|key|secret|access[_-]?token)=)[^&\s#]+/gi,
    replace: (_m, prefix) => `${prefix}●●●`,
  },
  // Home absolute path → ~/
  { name: 'HOME_WIN', re: /[A-Za-z]:\\Users\\[^\\\s"']+/g, replace: '~' },
  { name: 'HOME_NIX', re: /\/(?:home|Users)\/[^/\s"']+/g, replace: '~' },
];

/**
 * Apply L3 masking policy: take first line, hard-cut to 200 chars, then redact sensitive patterns.
 * Returns { masked, hits } — hits is an array of pattern names that fired.
 */
export function maskFirstLine(input) {
  if (input == null) return { masked: '', hits: [] };
  const text = String(input);
  // 1) first line only
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  // 2) hard cut at 200
  let masked = firstLine.slice(0, MAX_LEN);
  // 3) apply each redaction in order
  const hits = [];
  for (const { name, re, replace } of PATTERNS) {
    if (re.test(masked)) {
      hits.push(name);
      re.lastIndex = 0;
      masked = masked.replace(re, replace);
      re.lastIndex = 0;
    } else {
      re.lastIndex = 0;
    }
  }
  return { masked, hits };
}

/**
 * Server-side validation: check if the (already-masked) string still contains suspicious patterns.
 * Returns array of pattern names that suspiciously remained — caller should drop the message if non-empty.
 */
export function detectSuspicious(maskedInput) {
  if (maskedInput == null) return [];
  const text = String(maskedInput);
  const hits = [];
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) hits.push(name);
    re.lastIndex = 0;
  }
  return hits;
}

/**
 * Apply L3 masking to multi-line body (prompt_full / assistant_full).
 * - 줄바꿈 보존, 길이 hard cap (50KB).
 * - 같은 정규식 redaction 적용.
 */
const MAX_FULL_LEN = 50_000;
export function maskBody(input) {
  if (input == null) return { masked: '', hits: [] };
  let text = String(input);
  if (text.length > MAX_FULL_LEN) text = text.slice(0, MAX_FULL_LEN);
  const hits = [];
  for (const { name, re, replace } of PATTERNS) {
    if (re.test(text)) {
      hits.push(name);
      re.lastIndex = 0;
      text = text.replace(re, replace);
      re.lastIndex = 0;
    } else {
      re.lastIndex = 0;
    }
  }
  return { masked: text, hits };
}

/**
 * 텍스트에서 N개 줄 또는 maxChars 컷으로 요약.
 * 빈 줄은 건너뛰고 의미 있는 줄만 채움.
 */
export function previewLines(text, { maxLines = 3, maxChars = 500 } = {}) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  const picked = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    picked.push(trimmed);
    if (picked.length >= maxLines) break;
  }
  let out = picked.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars);
  return out;
}

export const _internals = { PATTERNS, MAX_LEN, MAX_FULL_LEN };
