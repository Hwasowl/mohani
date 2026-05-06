-- 사용자가 환경설정에서 켠 "질문 숨김 / 답변 숨김" 토글이 적용된 row를 식별하는 플래그.
-- 본문 컬럼(prompt_*, assistant_*)은 hidden=true일 때 NULL로 들어오고, 클라이언트가
-- 이 플래그를 보고 "🔒 숨김처리됨" placeholder를 표시한다.
-- 활동 자체는 전송되므로 자리/시간/도구/토큰은 그대로 보인다.

ALTER TABLE activity_log
    ADD COLUMN question_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN answer_hidden   BOOLEAN NOT NULL DEFAULT FALSE;
