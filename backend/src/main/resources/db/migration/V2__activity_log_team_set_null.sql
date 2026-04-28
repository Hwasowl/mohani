-- 팀이 삭제되어도 사용자 활동 히스토리(activity_log)는 보존 — team_id만 NULL로
-- 마지막 멤버가 leave하면 team을 자동 삭제하는 흐름에서 FK violation 방지.
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_team_id_fkey;
ALTER TABLE activity_log
    ADD CONSTRAINT activity_log_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
