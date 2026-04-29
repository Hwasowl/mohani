-- V4 이전에 쌓였던 의미 없는 row 정리.
-- 질문도 답변도 없는 행(주로 옛 Stop 이벤트)은 노이즈만 만들므로 제거.
DELETE FROM activity_log
 WHERE (prompt_first_line IS NULL OR prompt_first_line = '')
   AND (assistant_preview IS NULL OR assistant_preview = '');
