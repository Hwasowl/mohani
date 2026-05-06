import { describe, expect, it } from 'vitest';
import { detectSuspicious, maskFirstLine } from '../src/masking.js';

describe('maskFirstLine — first-line + 200char cut', () => {
  it('takes only the first line', () => {
    const { masked } = maskFirstLine('first line\nsecond line');
    expect(masked).toBe('first line');
  });

  it('handles CRLF', () => {
    const { masked } = maskFirstLine('first\r\nsecond');
    expect(masked).toBe('first');
  });

  it('hard-cuts to 200 chars', () => {
    const long = 'a'.repeat(500);
    const { masked } = maskFirstLine(long);
    expect(masked.length).toBe(200);
  });

  it('returns empty for null/undefined', () => {
    expect(maskFirstLine(null).masked).toBe('');
    expect(maskFirstLine(undefined).masked).toBe('');
  });

  it('passes through plain text unchanged', () => {
    const { masked, hits } = maskFirstLine('Redis sorted set 페이징 처리 방법 알려줘');
    expect(masked).toBe('Redis sorted set 페이징 처리 방법 알려줘');
    expect(hits).toEqual([]);
  });
});

describe('maskFirstLine — sensitive pattern redaction', () => {
  it('masks AWS access key', () => {
    const { masked, hits } = maskFirstLine('use key AKIAIOSFODNN7EXAMPLE for upload');
    expect(masked).toBe('use key ●●●AWS_KEY●●● for upload');
    expect(hits).toContain('AWS_KEY');
  });

  it('masks AWS temporary key (ASIA prefix)', () => {
    const { masked, hits } = maskFirstLine('cred ASIAIOSFODNN7EXAMPLE here');
    expect(masked).toContain('●●●AWS_KEY●●●');
    expect(hits).toContain('AWS_KEY');
  });

  it('masks GCP API key', () => {
    // GCP key = AIza + exactly 35 chars
    const { masked, hits } = maskFirstLine('AIzaSyD_qrstUVWXYZabcdefghijklmnopqrstu used');
    expect(masked).toContain('●●●GCP_KEY●●●');
    expect(hits).toContain('GCP_KEY');
  });

  it('masks JWT token', () => {
    const { masked, hits } = maskFirstLine('Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature_here');
    expect(masked).toContain('●●●JWT●●●');
    expect(hits).toContain('JWT');
  });

  it('masks Bearer token', () => {
    const { masked, hits } = maskFirstLine('curl -H "Authorization: Bearer abc1234567890XYZpq"');
    expect(masked).toContain('Bearer ●●●');
    expect(hits).toContain('BEARER');
  });

  it('masks api_key assignment with quotes', () => {
    const { masked, hits } = maskFirstLine('const api_key = "sk-1234567890ABCDEFG_xyz"');
    expect(masked).toMatch(/api_key\s*=\s*●●●/);
    expect(hits).toContain('API_KEY_ASSIGN');
  });

  it('masks apiKey assignment colon style', () => {
    const { masked, hits } = maskFirstLine('apiKey: AbCdEf1234567890XYZ');
    expect(masked).toMatch(/apiKey:●●●/);
    expect(hits).toContain('API_KEY_ASSIGN');
  });

  it('masks secret assignment', () => {
    const { masked } = maskFirstLine('SECRET=my_super_long_secret_value_12345');
    expect(masked).toMatch(/SECRET=●●●/);
  });

  it('does NOT mask short api key (under threshold)', () => {
    const { masked, hits } = maskFirstLine('apiKey: short');
    expect(masked).toBe('apiKey: short');
    expect(hits).not.toContain('API_KEY_ASSIGN');
  });

  it('masks password assignment', () => {
    const { masked, hits } = maskFirstLine('password = "hunter2"');
    expect(masked).toMatch(/password\s*=\s*●●●/);
    expect(hits).toContain('PASSWORD');
  });

  it('masks pwd shorthand', () => {
    const { masked } = maskFirstLine('pwd:correcthorsebattery');
    expect(masked).toMatch(/pwd:●●●/);
  });

  it('masks email', () => {
    const { masked, hits } = maskFirstLine('contact me at hwasowl598@gmail.com please');
    expect(masked).toBe('contact me at ●●●@●●● please');
    expect(hits).toContain('EMAIL');
  });

  it('masks URL token query param', () => {
    const { masked, hits } = maskFirstLine('GET https://api.example.com/data?token=abcdef12345&page=1');
    expect(masked).toMatch(/[?&]token=●●●/);
    expect(hits).toContain('URL_TOKEN');
  });

  it('masks URL key query param', () => {
    const { masked } = maskFirstLine('curl https://x.io?key=mysecretvalue');
    expect(masked).toMatch(/[?&]key=●●●/);
  });

  it('replaces Windows home path with ~', () => {
    const { masked, hits } = maskFirstLine('open C:\\Users\\hwaso\\secrets.txt now');
    expect(masked).toBe('open ~\\secrets.txt now');
    expect(hits).toContain('HOME_WIN');
  });

  it('replaces *nix home path with ~', () => {
    const { masked, hits } = maskFirstLine('cat /home/alice/.ssh/id_rsa please');
    expect(masked).toBe('cat ~/.ssh/id_rsa please');
    expect(hits).toContain('HOME_NIX');
  });

  it('replaces /Users (mac) home path', () => {
    const { masked } = maskFirstLine('vim /Users/bob/.aws/credentials');
    expect(masked).toBe('vim ~/.aws/credentials');
  });

  it('applies multiple maskings in one line', () => {
    const { masked, hits } = maskFirstLine('user a@b.com key AKIAIOSFODNN7EXAMPLE pwd:secret');
    expect(masked).toContain('●●●@●●●');
    expect(masked).toContain('●●●AWS_KEY●●●');
    expect(masked).toMatch(/pwd:●●●/);
    expect(hits).toEqual(expect.arrayContaining(['EMAIL', 'AWS_KEY', 'PASSWORD']));
  });

  it('keeps non-sensitive code-like text intact', () => {
    const { masked, hits } = maskFirstLine('function add(a, b) { return a + b; }');
    expect(masked).toBe('function add(a, b) { return a + b; }');
    expect(hits).toEqual([]);
  });
});

describe('detectSuspicious — server-side re-validation', () => {
  it('returns empty for clean text', () => {
    expect(detectSuspicious('hello world')).toEqual([]);
  });

  it('flags raw API key that bypassed first masking', () => {
    const hits = detectSuspicious('AKIAIOSFODNN7EXAMPLE leaked');
    expect(hits).toContain('AWS_KEY');
  });

  it('flags raw email', () => {
    expect(detectSuspicious('user@example.com')).toContain('EMAIL');
  });

  it('flags JWT', () => {
    expect(detectSuspicious('eyJhbGc.eyJzdWI.sig123')).toContain('JWT');
  });

  // H4 — URL 인코딩 우회 잡기
  it('flags URL-encoded password leak', () => {
    const hits = detectSuspicious('password%3Dhunter2supersecret');
    expect(hits).toContain('PASSWORD');
  });
});

// H4 — 신규 service-specific 패턴 + 우회 차단
describe('maskFirstLine — H4 신규 패턴', () => {
  it('redacts GitHub PAT', () => {
    const { masked, hits } = maskFirstLine('ghp_1234567890abcdefghijKLMNOPQrstuvwxYZ12');
    expect(masked).toContain('●●●GITHUB_PAT●●●');
    expect(hits).toContain('GITHUB_PAT');
  });

  it('redacts Slack bot token', () => {
    // FAKE 명시 — GitHub secret scanning false positive 차단용. 정규식 패턴은 그대로 매칭됨.
    const { masked, hits } = maskFirstLine('xoxb-FAKE-FAKETESTONLY-FAKETESTONLYTOKEN');
    expect(masked).toContain('●●●SLACK_TOKEN●●●');
    expect(hits).toContain('SLACK_TOKEN');
  });

  it('redacts OpenAI key (sk-proj-)', () => {
    const { masked, hits } = maskFirstLine('sk-proj-FAKETESTONLYFAKETESTONLYFAKETESTONLY');
    expect(masked).toContain('●●●OPENAI_KEY●●●');
    expect(hits).toContain('OPENAI_KEY');
  });

  it('redacts Stripe live key', () => {
    // 문자열 concat — GitHub secret scanner의 정적 매칭 회피용. 런타임엔 sk_live_ 패턴 그대로 형성.
    const fakeStripe = 'sk' + '_live_' + 'FAKE'.repeat(8);
    const { masked, hits } = maskFirstLine(fakeStripe);
    expect(masked).toContain('●●●STRIPE_KEY●●●');
    expect(hits).toContain('STRIPE_KEY');
  });

  it('redacts PEM private key marker', () => {
    const { masked, hits } = maskFirstLine('-----BEGIN RSA PRIVATE KEY-----');
    expect(masked).toContain('●●●PEM_PRIVATE●●●');
    expect(hits).toContain('PEM_PRIVATE');
  });

  it('redacts Korean RRN', () => {
    const { masked, hits } = maskFirstLine('주민번호 900101-1234567 입니다');
    expect(masked).toContain('●●●KR_RRN●●●');
    expect(hits).toContain('KR_RRN');
  });

  it('redacts credit card number', () => {
    const { masked, hits } = maskFirstLine('카드 4111-1111-1111-1111');
    expect(masked).toContain('●●●CC●●●');
    expect(hits).toContain('CREDIT_CARD');
  });

  it('redacts password is X form', () => {
    const { masked, hits } = maskFirstLine('the password is hunter2supersecret');
    expect(masked).not.toContain('hunter2supersecret');
    expect(hits).toContain('PASSWORD');
  });

  // NFKC 우회 차단
  it('redacts NFKC-foldable fullwidth password', () => {
    const { masked, hits } = maskFirstLine('ｐａｓｓｗｏｒｄ=hunter2supersecret');
    expect(masked).not.toContain('hunter2supersecret');
    expect(hits).toContain('PASSWORD');
  });

  // Zero-width space 우회 차단
  it('redacts password with zero-width separator', () => {
    const { masked, hits } = maskFirstLine('pa​ssword=hunter2supersecret');
    expect(masked).not.toContain('hunter2supersecret');
    expect(hits).toContain('PASSWORD');
  });
});

// 0.1.12 — 추가 service-specific 토큰 (사용자 도메인이 Claude/Anthropic 중심)
describe('maskFirstLine — 0.1.12 신규 패턴', () => {
  it('redacts Anthropic API key (sk-ant-)', () => {
    const { masked, hits } = maskFirstLine('sk-ant-api03-FAKETESTONLYFAKETESTONLYFAKETESTONLY');
    expect(masked).toContain('●●●ANTHROPIC_KEY●●●');
    expect(hits).toContain('ANTHROPIC_KEY');
  });

  it('Anthropic key takes precedence over OpenAI rule (sk- prefix collision)', () => {
    // sk-ant-... 는 OPENAI_KEY 정규식에도 매칭되지만 ANTHROPIC_KEY가 먼저 처리되어야 함.
    const { masked, hits } = maskFirstLine('key sk-ant-api03-FAKETESTONLYFAKETESTONLYFAKETESTONLY');
    expect(masked).toContain('●●●ANTHROPIC_KEY●●●');
    expect(masked).not.toContain('●●●OPENAI_KEY●●●');
    expect(hits).toContain('ANTHROPIC_KEY');
  });

  it('redacts HuggingFace token (hf_)', () => {
    const { masked, hits } = maskFirstLine('hf_FAKETESTONLYFAKETESTONLYFAKETESTONLYFAKE');
    expect(masked).toContain('●●●HF_TOKEN●●●');
    expect(hits).toContain('HF_TOKEN');
  });

  it('redacts GitHub fine-grained PAT (github_pat_)', () => {
    const { masked, hits } = maskFirstLine(
      'github_pat_FAKETESTONLY11111111111_FAKETESTONLYFAKETESTONLYFAKETESTONLYFAKETEST');
    expect(masked).toContain('●●●GITHUB_FINE_PAT●●●');
    expect(hits).toContain('GITHUB_FINE_PAT');
  });
});
