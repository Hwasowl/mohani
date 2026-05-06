package com.mohani.domain.activity;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

// L3 정책 — Local Agent의 src/masking.js 와 동일한 정규식·치환자·순서.
// (1) 동일 마스킹 재적용 (2) detectSuspicious()로 잔존 우회 패턴 잡아 drop, 두 단계 안전망.
// H4 강화: NFKC 정규화 + invisible 문자 제거 + URL 디코딩본 추가 검사.
@Component
public class MaskingPolicy {

    public static final int MAX_LEN = 200;
    public static final int MAX_PREVIEW_LEN = 500;
    public static final int MAX_FULL_LEN = 50_000;

    // zero-width / RTL override / BOM — 시각적으로 안 보이지만 매칭 끊는 트릭에 쓰임.
    private static final Pattern INVISIBLE = Pattern.compile("[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]");

    // agent/src/masking.js의 PATTERNS와 1:1 일치. 순서 동일.
    private static final List<Rule> RULES = List.of(
        new Rule("AWS_KEY",
            Pattern.compile("\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b"),
            "●●●AWS_KEY●●●"),
        new Rule("GCP_KEY",
            Pattern.compile("\\bAIza[0-9A-Za-z_-]{35}\\b"),
            "●●●GCP_KEY●●●"),
        new Rule("PEM_PRIVATE",
            Pattern.compile("-----BEGIN [A-Z ]+PRIVATE KEY-----"),
            "●●●PEM_PRIVATE●●●"),
        new Rule("KR_RRN",
            Pattern.compile("\\b\\d{6}-[1-4]\\d{6}\\b"),
            "●●●KR_RRN●●●"),
        new Rule("JWT",
            Pattern.compile("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b"),
            "●●●JWT●●●"),
        new Rule("BEARER",
            Pattern.compile("\\bBearer\\s+[A-Za-z0-9._\\-+/=]{16,}", Pattern.CASE_INSENSITIVE),
            "Bearer ●●●"),
        new Rule("API_KEY_ASSIGN",
            Pattern.compile(
                "\\b(api[_-]?key|secret|token|access[_-]?key|auth[_-]?token)\\s*([:=])\\s*[\"']?([A-Za-z0-9_\\-]{16,})[\"']?",
                Pattern.CASE_INSENSITIVE),
            "$1$2●●●"),
        new Rule("PASSWORD",
            // [:=] 또는 ` is `/` was ` 형태 모두 매칭. 그룹2가 sep — Java replaceAll에선 trim 어려워 통째로 사용.
            Pattern.compile(
                "\\b(password|passwd|pwd)\\s*([:=])\\s*[\"']?([^\\s\"']+)[\"']?",
                Pattern.CASE_INSENSITIVE),
            "$1$2●●●"),
        new Rule("PASSWORD_VERB",
            Pattern.compile(
                "\\b(password|passwd|pwd)\\s+(?:is|was)\\s+[\"']?([^\\s\"']+)[\"']?",
                Pattern.CASE_INSENSITIVE),
            "$1 is ●●●"),
        new Rule("URL_TOKEN",
            Pattern.compile(
                "([?&](?:token|key|secret|access[_-]?token|api[_-]?key)=)[^&\\s#]+",
                Pattern.CASE_INSENSITIVE),
            "$1●●●"),
        new Rule("GITHUB_PAT",
            Pattern.compile("\\bgh[pousr]_[A-Za-z0-9]{30,}\\b"),
            "●●●GITHUB_PAT●●●"),
        new Rule("GITHUB_FINE_PAT",
            Pattern.compile("\\bgithub_pat_[A-Za-z0-9_]{50,}\\b"),
            "●●●GITHUB_FINE_PAT●●●"),
        new Rule("SLACK_TOKEN",
            Pattern.compile("\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b"),
            "●●●SLACK_TOKEN●●●"),
        // Anthropic — OPENAI_KEY 정규식이 sk- 접두까지 잡으므로 반드시 그 앞에 둔다.
        new Rule("ANTHROPIC_KEY",
            Pattern.compile("\\bsk-ant-[A-Za-z0-9_-]{20,}\\b"),
            "●●●ANTHROPIC_KEY●●●"),
        new Rule("OPENAI_KEY",
            Pattern.compile("\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b"),
            "●●●OPENAI_KEY●●●"),
        new Rule("HF_TOKEN",
            Pattern.compile("\\bhf_[A-Za-z0-9]{30,}\\b"),
            "●●●HF_TOKEN●●●"),
        new Rule("STRIPE_KEY",
            Pattern.compile("\\b(?:sk|pk|rk)_live_[A-Za-z0-9]{20,}\\b"),
            "●●●STRIPE_KEY●●●"),
        new Rule("CREDIT_CARD",
            Pattern.compile("\\b(?:\\d[ -]?){12,18}\\d\\b"),
            "●●●CC●●●"),
        new Rule("EMAIL",
            Pattern.compile("\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b"),
            "●●●@●●●"),
        new Rule("HOME_WIN",
            Pattern.compile("[A-Za-z]:[\\\\/]Users[\\\\/][^\\\\/\\s\"']+"),
            "~"),
        new Rule("HOME_NIX",
            Pattern.compile("/(?:home|Users)/[^/\\s\"']+"),
            "~")
    );

    /** NFKC 정규화 + invisible 문자 제거 — Cyrillic confusable은 못 잡지만 전각·zero-width는 차단. */
    public static String normalizeForMatching(String input) {
        if (input == null) return "";
        String n;
        try {
            n = Normalizer.normalize(input, Normalizer.Form.NFKC);
        } catch (Exception e) {
            n = input;
        }
        return INVISIBLE.matcher(n).replaceAll("");
    }

    /** 첫 줄 + 200자 컷 + 마스킹. */
    public String enforceFirstLine(String input) {
        if (input == null) return "";
        String norm = normalizeForMatching(input);
        String firstLine = norm.split("\\r?\\n", 2)[0];
        String cut = firstLine.length() > MAX_LEN ? firstLine.substring(0, MAX_LEN) : firstLine;
        return redact(cut);
    }

    /** 전체 본문 — 50KB hard cap + 마스킹. */
    public String enforceFull(String input) {
        if (input == null || input.isEmpty()) return null;
        String norm = normalizeForMatching(input);
        String cut = norm.length() > MAX_FULL_LEN ? norm.substring(0, MAX_FULL_LEN) : norm;
        return redact(cut);
    }

    /** 답변 요약 — 500자 컷 + 마스킹. */
    public String enforcePreview(String input) {
        if (input == null || input.isEmpty()) return null;
        String norm = normalizeForMatching(input);
        String cut = norm.length() > MAX_PREVIEW_LEN ? norm.substring(0, MAX_PREVIEW_LEN) : norm;
        return redact(cut);
    }

    /**
     * 우회 패턴 감지. URL 디코딩본까지 추가 검사 — `password%3Dhunter2` 같은 인코딩 우회 잡음.
     */
    public List<String> detectSuspicious(String text) {
        if (text == null || text.isEmpty()) return List.of();
        String norm = normalizeForMatching(text);
        String decoded;
        try {
            decoded = URLDecoder.decode(norm, StandardCharsets.UTF_8);
        } catch (Exception e) {
            decoded = norm;
        }
        Set<String> hits = new LinkedHashSet<>();
        for (Rule r : RULES) {
            if (r.pattern.matcher(norm).find()) hits.add(r.name);
            if (!decoded.equals(norm) && r.pattern.matcher(decoded).find()) hits.add(r.name);
        }
        return new ArrayList<>(hits);
    }

    private static String redact(String text) {
        String out = text;
        for (Rule r : RULES) {
            Matcher m = r.pattern.matcher(out);
            if (m.find()) {
                out = m.replaceAll(r.replacement);
            }
        }
        return out;
    }

    private record Rule(String name, Pattern pattern, String replacement) {
    }
}
