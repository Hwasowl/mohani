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
});
