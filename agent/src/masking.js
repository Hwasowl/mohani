// L3 첫 줄 + 200자 + 민감정보 마스킹.
// 외부 의존성 없이 순수 함수로 유지 — Spring 서버 재검증에서 동일 정책 재사용 가능.
//
// H4 강화 (2026-04):
// - NFKC 정규화 + zero-width 제거로 Cyrillic/전각/zero-width 우회 차단.
// - 추가 패턴: GitHub PAT, Slack token, OpenAI, Stripe, PEM, 한국 RRN, 신용카드.
// - detectSuspicious는 URL 디코딩한 사본도 검사해서 인코딩 우회 잡음.

const MAX_LEN = 200;

// zero-width / RTL override / BOM — 시각적으로 안 보이지만 매칭 끊는 용도로 끼워넣을 수 있음.
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁤﻿]/g;

/**
 * 입력을 NFKC로 정규화 + 보이지 않는 문자 제거.
 * - Cyrillic 'а' (U+0430) 같은 confusable은 NFKC가 못 잡음 (다른 코드포인트, 같은 글리프).
 *   추가 가드로 ascii fold가 필요할 수 있지만 false positive 우려가 커서 NFKC + invisible 제거까지만.
 * - 전각 'ｐａｓｓｗｏｒｄ' → 'password' 변환 (NFKC 핵심 효과).
 */
export function normalizeForMatching(input) {
  if (input == null) return '';
  let text = String(input);
  try {
    text = text.normalize('NFKC');
  } catch {
    // 일부 환경에서 normalize 미지원 — fallback로 그대로 사용
  }
  return text.replace(INVISIBLE_RE, '');
}

// 순서 주의 — generic assign(API_KEY_ASSIGN, PASSWORD)을 service-specific(OPENAI_KEY, GITHUB_PAT 등) 앞에 둬야
// `api_key = "sk-xxxx"` 같은 케이스에서 의미적인 형태 `api_key=●●●`로 redact됨.
// PEM/RRN/CC 등 길거나 prefix가 명확한 패턴은 가장 먼저.
const PATTERNS = [
  // AWS access keys (AKIA, ASIA prefix)
  { name: 'AWS_KEY', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: '●●●AWS_KEY●●●' },
  // Google Cloud API keys
  { name: 'GCP_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: '●●●GCP_KEY●●●' },
  // PEM private key block (RSA, EC, OPENSSH, etc.)
  { name: 'PEM_PRIVATE', re: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g, replace: '●●●PEM_PRIVATE●●●' },
  // 한국 주민등록번호 (YYMMDD-1234567)
  { name: 'KR_RRN', re: /\b\d{6}-[1-4]\d{6}\b/g, replace: '●●●KR_RRN●●●' },
  // JWT (eyJ... three parts)
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replace: '●●●JWT●●●' },
  // Bearer tokens
  { name: 'BEARER', re: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/gi, replace: 'Bearer ●●●' },
  // Generic api/secret/token assignment (e.g. apiKey: "abc123...", api_key=xyz)
  {
    name: 'API_KEY_ASSIGN',
    re: /\b(api[_-]?key|secret|token|access[_-]?key|auth[_-]?token)\s*([:=])\s*["']?([A-Za-z0-9_\-]{16,})["']?/gi,
    replace: (_m, key, sep) => `${key}${sep}●●●`,
  },
  // password: ... or password=... or password is ...
  {
    name: 'PASSWORD',
    re: /\b(password|passwd|pwd)\s*([:=]|\s+is\s+|\s+was\s+)\s*["']?([^\s"']+)["']?/gi,
    replace: (_m, key, sep) => `${key}${sep.trim()}●●●`,
  },
  // URL query token/key/secret param
  {
    name: 'URL_TOKEN',
    re: /([?&](?:token|key|secret|access[_-]?token|api[_-]?key)=)[^&\s#]+/gi,
    replace: (_m, prefix) => `${prefix}●●●`,
  },
  // GitHub Personal Access Token / OAuth / app token (ghp_, gho_, ghu_, ghs_, ghr_)
  { name: 'GITHUB_PAT', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, replace: '●●●GITHUB_PAT●●●' },
  // GitHub fine-grained PAT (github_pat_...)
  { name: 'GITHUB_FINE_PAT', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, replace: '●●●GITHUB_FINE_PAT●●●' },
  // Slack token (xoxb, xoxa, xoxp, xoxr, xoxs)
  { name: 'SLACK_TOKEN', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: '●●●SLACK_TOKEN●●●' },
  // Anthropic API key (sk-ant-...) — OPENAI_KEY 정규식이 sk- 접두까지 잡으니 반드시 그 앞에 둔다.
  { name: 'ANTHROPIC_KEY', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replace: '●●●ANTHROPIC_KEY●●●' },
  // OpenAI API key (sk-... or sk-proj-...) — sk-ant-는 위에서 먼저 처리되므로 안전하게 통과.
  { name: 'OPENAI_KEY', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, replace: '●●●OPENAI_KEY●●●' },
  // HuggingFace user/access token (hf_...)
  { name: 'HF_TOKEN', re: /\bhf_[A-Za-z0-9]{30,}\b/g, replace: '●●●HF_TOKEN●●●' },
  // Stripe live keys (sk_live_, pk_live_, rk_live_)
  { name: 'STRIPE_KEY', re: /\b(?:sk|pk|rk)_live_[A-Za-z0-9]{20,}\b/g, replace: '●●●STRIPE_KEY●●●' },
  // 신용카드 (13-19 digits with optional - or space separators) — luhn 미검증, 보수적
  { name: 'CREDIT_CARD', re: /\b(?:\d[ -]?){12,18}\d\b/g, replace: '●●●CC●●●' },
  // Email
  { name: 'EMAIL', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replace: '●●●@●●●' },
  // Home absolute path → ~ (Win + Unix, slash 변형 모두 커버)
  { name: 'HOME_WIN', re: /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/g, replace: '~' },
  { name: 'HOME_NIX', re: /\/(?:home|Users)\/[^/\s"']+/g, replace: '~' },
];

/**
 * Apply L3 masking policy: take first line, hard-cut to 200 chars, then redact sensitive patterns.
 * Returns { masked, hits } — hits is an array of pattern names that fired.
 */
export function maskFirstLine(input) {
  if (input == null) return { masked: '', hits: [] };
  const text = normalizeForMatching(input);
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  let masked = firstLine.slice(0, MAX_LEN);
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
 * URL-decoded copy도 검사해서 인코딩 우회 잡음.
 */
export function detectSuspicious(maskedInput) {
  if (maskedInput == null) return [];
  const text = normalizeForMatching(maskedInput);
  const decoded = (() => {
    try { return decodeURIComponent(text); } catch { return text; }
  })();
  const hits = new Set();
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) hits.add(name);
    re.lastIndex = 0;
    if (decoded !== text && re.test(decoded)) hits.add(name);
    re.lastIndex = 0;
  }
  return Array.from(hits);
}

/**
 * Apply L3 masking to multi-line body (prompt_full / assistant_full).
 * - 줄바꿈 보존, 길이 hard cap (50KB).
 * - NFKC + invisible 정규화 후 redaction.
 */
const MAX_FULL_LEN = 50_000;
export function maskBody(input) {
  if (input == null) return { masked: '', hits: [] };
  let text = normalizeForMatching(input);
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
