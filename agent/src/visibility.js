// 사용자가 환경설정에서 켠 "질문 숨김 / 답변 숨김" 토글에 따라 송신 직전에 본문을 redact.
// 메타(시간/도구/토큰/이벤트 종류)는 보존 — 활동 자체는 보이고 본문만 가려진다.
// 활동 자체를 차단하는 "오프라인 상태"(isPrivate)는 events.js의 dropped 경로에서 처리.

const PROMPT_FIELDS = ['promptFirstLine', 'promptFull'];
const ANSWER_FIELDS = ['assistantPreview', 'assistantFull'];

/**
 * @param {object} payload  normalize 결과 또는 그에 준하는 페이로드
 * @param {{ hideQuestion?: boolean, hideAnswer?: boolean }} state
 * @returns {object}  새 객체 — 입력은 변경하지 않음
 */
export function applyVisibility(payload, state = {}) {
  const out = { ...payload };
  if (state.hideQuestion) {
    for (const k of PROMPT_FIELDS) {
      if (k in out) out[k] = null;
    }
    out.questionHidden = true;
  }
  if (state.hideAnswer) {
    for (const k of ANSWER_FIELDS) {
      if (k in out) out[k] = null;
    }
    out.answerHidden = true;
  }
  return out;
}
