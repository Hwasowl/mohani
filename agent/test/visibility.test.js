import { describe, expect, it } from 'vitest';
import { applyVisibility } from '../src/visibility.js';

describe('applyVisibility', () => {
  const userPrompt = {
    event: 'UserPromptSubmit',
    sessionId: 's1',
    promptFirstLine: '질문 첫 줄',
    promptFull: '질문 전체 본문\n둘째 줄',
    cliKind: 'claude',
  };

  const stopWithAnswer = {
    event: 'Stop',
    sessionId: 's1',
    assistantPreview: '답변 미리보기',
    assistantFull: '답변 전체 본문',
    totalTokens: 1234,
    toolUseCount: 3,
    cliKind: 'claude',
  };

  it('default state — payload unchanged', () => {
    const out = applyVisibility(userPrompt, {});
    expect(out).toEqual(userPrompt);
    expect(out.questionHidden).toBeUndefined();
    expect(out.answerHidden).toBeUndefined();
  });

  it('hideQuestion=true redacts prompt fields and sets questionHidden flag', () => {
    const out = applyVisibility(userPrompt, { hideQuestion: true });
    expect(out.promptFirstLine).toBeNull();
    expect(out.promptFull).toBeNull();
    expect(out.questionHidden).toBe(true);
    // 메타는 보존
    expect(out.event).toBe('UserPromptSubmit');
    expect(out.sessionId).toBe('s1');
    expect(out.cliKind).toBe('claude');
  });

  it('hideAnswer=true redacts assistant fields and sets answerHidden flag', () => {
    const out = applyVisibility(stopWithAnswer, { hideAnswer: true });
    expect(out.assistantPreview).toBeNull();
    expect(out.assistantFull).toBeNull();
    expect(out.answerHidden).toBe(true);
    // 토큰/도구 메타는 보존 (사용자 명시 요구)
    expect(out.totalTokens).toBe(1234);
    expect(out.toolUseCount).toBe(3);
  });

  it('hideQuestion does not touch assistant fields', () => {
    const out = applyVisibility(stopWithAnswer, { hideQuestion: true });
    expect(out.assistantPreview).toBe('답변 미리보기');
    expect(out.assistantFull).toBe('답변 전체 본문');
    expect(out.answerHidden).toBeUndefined();
  });

  it('hideAnswer does not touch prompt fields', () => {
    const out = applyVisibility(userPrompt, { hideAnswer: true });
    expect(out.promptFirstLine).toBe('질문 첫 줄');
    expect(out.promptFull).toBe('질문 전체 본문\n둘째 줄');
    expect(out.questionHidden).toBeUndefined();
  });

  it('both flags simultaneously redact both sides', () => {
    // 한 페이로드에 둘 다 있을 일은 거의 없지만 안전하게.
    const both = { ...userPrompt, ...stopWithAnswer, event: 'Stop' };
    const out = applyVisibility(both, { hideQuestion: true, hideAnswer: true });
    expect(out.promptFirstLine).toBeNull();
    expect(out.promptFull).toBeNull();
    expect(out.assistantPreview).toBeNull();
    expect(out.assistantFull).toBeNull();
    expect(out.questionHidden).toBe(true);
    expect(out.answerHidden).toBe(true);
  });

  it('does not mutate input payload (returns a new object)', () => {
    const input = { ...userPrompt };
    const inputCopy = { ...userPrompt };
    applyVisibility(input, { hideQuestion: true });
    expect(input).toEqual(inputCopy);
  });

  it('handles payload missing the targeted fields gracefully', () => {
    // PreToolUse 같은 payload — prompt/assistant 필드 없음
    const tool = { event: 'PreToolUse', sessionId: 's1', toolName: 'Bash' };
    const out = applyVisibility(tool, { hideQuestion: true, hideAnswer: true });
    // 필드 없으면 추가하지 않음 (questionHidden 플래그는 일관성 위해 부여)
    expect(out.toolName).toBe('Bash');
    expect(out.questionHidden).toBe(true);
    expect(out.answerHidden).toBe(true);
  });
});
