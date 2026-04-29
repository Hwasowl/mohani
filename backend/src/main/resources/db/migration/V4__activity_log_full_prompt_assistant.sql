-- 전체 프롬프트 본문 + AI 답변(요약/전체) + 도구 사용/응답 토큰 — turn 단위 표시용
ALTER TABLE activity_log
    ADD COLUMN prompt_full TEXT,
    ADD COLUMN assistant_preview VARCHAR(500),
    ADD COLUMN assistant_full TEXT,
    ADD COLUMN tool_use_count INT NOT NULL DEFAULT 0,
    ADD COLUMN response_tokens INT NOT NULL DEFAULT 0;

-- 노이즈 행 제거 — PreToolUse/PostToolUse/SessionStart 등은 더 이상 활동 로그에 남기지 않는다.
-- 첫 줄이 비어있는 UserPromptSubmit도 의미 없으므로 정리.
DELETE FROM activity_log
 WHERE event_kind NOT IN ('UserPromptSubmit', 'Stop')
    OR (event_kind = 'UserPromptSubmit' AND prompt_first_line IS NULL);

-- turn 매칭용 인덱스 — (user_id, cli_kind, occurred_at) 으로 미응답 row 찾기
CREATE INDEX IF NOT EXISTS idx_activity_user_cli_occurred
    ON activity_log(user_id, cli_kind, occurred_at DESC);
