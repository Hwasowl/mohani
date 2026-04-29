package com.mohani.domain.activity;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

// L3 정책 — Local Agent의 src/masking.js 와 동일한 정규식.
// 서버는 추가로 detectSuspicious()로 우회 패턴을 잡아 drop한다.
@Component
public class MaskingPolicy {

    public static final int MAX_LEN = 200;
    public static final int MAX_PREVIEW_LEN = 500;
    // 전체 본문 — DB 부하/네트워크 보호용 hard cap. 50KB.
    public static final int MAX_FULL_LEN = 50_000;

    private static final List<Rule> RULES = List.of(
        new Rule("AWS_KEY", Pattern.compile("\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b")),
        new Rule("GCP_KEY", Pattern.compile("\\bAIza[0-9A-Za-z_-]{35}\\b")),
        new Rule("JWT", Pattern.compile("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b")),
        new Rule("BEARER", Pattern.compile("\\bBearer\\s+[A-Za-z0-9._\\-+/=]{16,}", Pattern.CASE_INSENSITIVE)),
        new Rule("API_KEY_ASSIGN", Pattern.compile(
            "\\b(?:api[_-]?key|secret|token|access[_-]?key)\\s*[:=]\\s*[\"']?[A-Za-z0-9_\\-]{16,}[\"']?",
            Pattern.CASE_INSENSITIVE)),
        new Rule("PASSWORD", Pattern.compile(
            "\\b(?:password|passwd|pwd)\\s*[:=]\\s*[\"']?[^\\s\"']+[\"']?",
            Pattern.CASE_INSENSITIVE)),
        new Rule("EMAIL", Pattern.compile("\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b"))
    );

    /**
     * 첫 줄 + 200자 컷. 추가 마스킹은 Local Agent에서 처리됐다고 가정.
     * 서버는 안전을 위해 truncation만 강제.
     */
    public String enforceFirstLine(String input) {
        if (input == null) return "";
        String firstLine = input.split("\\r?\\n", 2)[0];
        return firstLine.length() > MAX_LEN ? firstLine.substring(0, MAX_LEN) : firstLine;
    }

    /**
     * 우회된 민감 패턴 감지. 비어있지 않으면 caller가 drop해야 한다.
     */
    public List<String> detectSuspicious(String text) {
        if (text == null || text.isEmpty()) return List.of();
        List<String> hits = new ArrayList<>();
        for (Rule r : RULES) {
            if (r.pattern.matcher(text).find()) hits.add(r.name);
        }
        return hits;
    }

    /** 전체 본문(prompt_full / assistant_full) — 길이 hard cap만. 마스킹은 agent 책임. */
    public String enforceFull(String input) {
        if (input == null || input.isEmpty()) return null;
        return input.length() > MAX_FULL_LEN ? input.substring(0, MAX_FULL_LEN) : input;
    }

    /** AI 답변 요약 — 500자 컷 + 줄바꿈 보존. agent가 이미 3줄 요약을 보낸 가정. */
    public String enforcePreview(String input) {
        if (input == null || input.isEmpty()) return null;
        return input.length() > MAX_PREVIEW_LEN ? input.substring(0, MAX_PREVIEW_LEN) : input;
    }

    private record Rule(String name, Pattern pattern) {
    }
}
