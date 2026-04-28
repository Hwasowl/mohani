import { describe, expect, it } from 'vitest';
import { parseLastAssistantUsage } from '../src/transcript.js';

describe('parseLastAssistantUsage', () => {
  it('extracts usage from the last assistant message', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '안녕' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 1200, output_tokens: 80 },
        },
      }),
    ].join('\n');
    const r = parseLastAssistantUsage(raw);
    expect(r).toEqual({ input: 1200, output: 80, cacheCreate: 0, cacheRead: 0, total: 1280 });
  });

  it('uses last assistant message when multiple turns present', () => {
    const lines = [
      { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 100, output_tokens: 50 } } },
      { type: 'user', message: { role: 'user', content: 'q2' } },
      { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 500, output_tokens: 200 } } },
    ].map((o) => JSON.stringify(o)).join('\n');
    const r = parseLastAssistantUsage(lines);
    expect(r.total).toBe(700);
  });

  it('includes cache tokens in total', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 5000,
        },
      },
    });
    const r = parseLastAssistantUsage(raw);
    expect(r.total).toBe(7150); // 100 + 50 + 2000 + 5000
  });

  it('returns null when no assistant message present', () => {
    const raw = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } });
    expect(parseLastAssistantUsage(raw)).toBeNull();
  });

  it('returns null on empty/null input', () => {
    expect(parseLastAssistantUsage('')).toBeNull();
    expect(parseLastAssistantUsage(null)).toBeNull();
    expect(parseLastAssistantUsage(undefined)).toBeNull();
  });

  it('skips malformed JSON lines and continues', () => {
    const raw = [
      '{"this is broken json',
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 10, output_tokens: 5 } } }),
    ].join('\n');
    expect(parseLastAssistantUsage(raw)?.total).toBe(15);
  });

  it('ignores assistant messages without usage', () => {
    const raw = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'no usage here' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 7, output_tokens: 3 } } }),
    ].join('\n');
    expect(parseLastAssistantUsage(raw)?.total).toBe(10);
  });
});
