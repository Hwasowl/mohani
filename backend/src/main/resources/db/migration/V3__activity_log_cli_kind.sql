-- Codex 등 멀티 CLI 지원: 어떤 도구에서 발생한 이벤트인지 식별.
-- 기본값 'claude' — 기존 데이터는 모두 Claude Code였음.
ALTER TABLE activity_log
    ADD COLUMN cli_kind VARCHAR(16) NOT NULL DEFAULT 'claude';
