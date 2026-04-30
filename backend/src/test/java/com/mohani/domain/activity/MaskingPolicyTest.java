package com.mohani.domain.activity;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class MaskingPolicyTest {

    private final MaskingPolicy p = new MaskingPolicy();

    @Test
    void enforceFirstLine_trimsToFirstLine() {
        assertThat(p.enforceFirstLine("hello\nworld")).isEqualTo("hello");
        assertThat(p.enforceFirstLine("hello\r\nworld")).isEqualTo("hello");
    }

    @Test
    void enforceFirstLine_hardCutsAt200() {
        String long500 = "a".repeat(500);
        assertThat(p.enforceFirstLine(long500)).hasSize(200);
    }

    @Test
    void enforceFirstLine_emptyForNullOrBlank() {
        assertThat(p.enforceFirstLine(null)).isEmpty();
        assertThat(p.enforceFirstLine("")).isEmpty();
    }

    @Test
    void detectSuspicious_flagsAwsKey() {
        assertThat(p.detectSuspicious("key=AKIAIOSFODNN7EXAMPLE here")).contains("AWS_KEY");
    }

    @Test
    void detectSuspicious_flagsEmail() {
        assertThat(p.detectSuspicious("send to a@b.com")).contains("EMAIL");
    }

    @Test
    void detectSuspicious_flagsJwt() {
        assertThat(p.detectSuspicious("eyJhbGc.eyJzdWI.sig123")).contains("JWT");
    }

    @Test
    void detectSuspicious_emptyForCleanText() {
        assertThat(p.detectSuspicious("hello world")).isEmpty();
        assertThat(p.detectSuspicious("Redis sorted set 페이징 처리")).isEmpty();
    }

    // H3 — 서버 redaction. agent 우회/직접 호출 시 서버 단독으로도 마스킹 동작해야 함.
    @Test
    void enforceFirstLine_redactsAwsKey() {
        String redacted = p.enforceFirstLine("use AKIAIOSFODNN7EXAMPLE as key");
        assertThat(redacted).contains("●●●AWS_KEY●●●");
        assertThat(redacted).doesNotContain("AKIAIOSFODNN7EXAMPLE");
    }

    @Test
    void enforceFirstLine_redactsEmail() {
        assertThat(p.enforceFirstLine("contact a@b.com")).contains("●●●@●●●");
    }

    @Test
    void enforceFirstLine_redactsPasswordAssign() {
        assertThat(p.enforceFirstLine("password=hunter2supersecret"))
            .doesNotContain("hunter2supersecret")
            .contains("●●●");
    }

    @Test
    void enforceFull_redactsMultipleSecretsAcrossLines() {
        String input = "line1 AKIAIOSFODNN7EXAMPLE\nline2 user@example.com\nline3 token=abcdef1234567890ABCDEF";
        String out = p.enforceFull(input);
        assertThat(out).doesNotContain("AKIAIOSFODNN7EXAMPLE");
        assertThat(out).doesNotContain("user@example.com");
        assertThat(out).doesNotContain("abcdef1234567890ABCDEF");
        assertThat(out).contains("●●●");
    }

    @Test
    void enforceFull_redactsHomePath() {
        // Windows 한국어 경로
        assertThat(p.enforceFull("path C:\\Users\\hwaso\\code"))
            .doesNotContain("hwaso")
            .contains("~");
        // Unix
        assertThat(p.enforceFull("path /home/alice/proj"))
            .doesNotContain("alice")
            .contains("~");
    }

    @Test
    void enforceFull_redactsUrlToken() {
        assertThat(p.enforceFull("https://api.example.com/x?token=abc123def456ghi789"))
            .doesNotContain("abc123def456ghi789")
            .contains("token=●●●");
    }

    @Test
    void enforceFull_returnsNullForNullInput() {
        assertThat(p.enforceFull(null)).isNull();
    }

    @Test
    void enforceFull_keepsHardCapAt50k() {
        String big = "x".repeat(60_000);
        assertThat(p.enforceFull(big)).hasSize(50_000);
    }

    @Test
    void enforcePreview_redactsAndCutsAt500() {
        String input = "a".repeat(600) + " AKIAIOSFODNN7EXAMPLE";
        String out = p.enforcePreview(input);
        assertThat(out).hasSize(500);
        // AKIA가 500자 밖이라 cut → redaction 대상 없음. 대신 짧은 케이스로도 검증.
        assertThat(p.enforcePreview("user@example.com")).contains("●●●@●●●");
    }

    @Test
    void enforceFirstLine_redactsBearerToken() {
        // 첫 줄에 Bearer 토큰 — agent 안 거치고 서버에 직접 들어와도 redaction
        assertThat(p.enforceFirstLine("Authorization: Bearer abc123def456ghi789jkl"))
            .doesNotContain("abc123def456ghi789jkl")
            .contains("Bearer ●●●");
    }

    // H4 — 신규 service-specific 패턴
    @Test
    void enforceFirstLine_redactsGithubPat() {
        assertThat(p.enforceFirstLine("ghp_1234567890abcdefghijKLMNOPQrstuvwxYZ12"))
            .contains("●●●GITHUB_PAT●●●");
    }

    @Test
    void enforceFirstLine_redactsSlackToken() {
        // FAKE 명시 — GitHub secret scanning false positive 차단용. 패턴은 그대로 매칭됨.
        assertThat(p.enforceFirstLine("xoxb-FAKE-FAKETESTONLY-FAKETESTONLYTOKEN"))
            .contains("●●●SLACK_TOKEN●●●");
    }

    @Test
    void enforceFirstLine_redactsOpenAiKey() {
        assertThat(p.enforceFirstLine("sk-proj-FAKETESTONLYFAKETESTONLYFAKETESTONLY"))
            .contains("●●●OPENAI_KEY●●●");
    }

    @Test
    void enforceFirstLine_redactsStripeKey() {
        // 문자열 concat — GitHub secret scanner의 정적 매칭 회피용. 런타임엔 sk_live_ 패턴 그대로 형성.
        String fakeStripe = "sk" + "_live_" + "FAKE".repeat(8);
        assertThat(p.enforceFirstLine(fakeStripe))
            .contains("●●●STRIPE_KEY●●●");
    }

    @Test
    void enforceFirstLine_redactsPemMarker() {
        assertThat(p.enforceFirstLine("-----BEGIN RSA PRIVATE KEY-----"))
            .contains("●●●PEM_PRIVATE●●●");
    }

    @Test
    void enforceFirstLine_redactsKoreanRrn() {
        assertThat(p.enforceFirstLine("주민번호 900101-1234567 입니다"))
            .doesNotContain("900101-1234567")
            .contains("●●●KR_RRN●●●");
    }

    @Test
    void enforceFirstLine_redactsCreditCard() {
        assertThat(p.enforceFirstLine("카드 4111-1111-1111-1111"))
            .doesNotContain("4111-1111-1111-1111")
            .contains("●●●CC●●●");
    }

    @Test
    void enforceFirstLine_redactsPasswordIsForm() {
        assertThat(p.enforceFirstLine("the password is hunter2supersecret"))
            .doesNotContain("hunter2supersecret")
            .contains("●●●");
    }

    // H4 — NFKC 우회 차단
    @Test
    void enforceFirstLine_redactsFullwidthPasswordViaNfkc() {
        // 전각 password (ｐａｓｓｗｏｒｄ) — NFKC 후 ascii로 fold됨
        String input = "ｐａｓｓｗｏｒｄ=hunter2supersecret";
        assertThat(p.enforceFirstLine(input))
            .doesNotContain("hunter2supersecret")
            .contains("●●●");
    }

    @Test
    void enforceFirstLine_redactsZeroWidthSeparatedPassword() {
        // pa<U+200B>ssword=hunter2supersecret
        String input = "pa​ssword=hunter2supersecret";
        assertThat(p.enforceFirstLine(input))
            .doesNotContain("hunter2supersecret")
            .contains("●●●");
    }

    // H4 — URL 인코딩 우회는 detectSuspicious가 잡음 (redact는 못 함)
    @Test
    void detectSuspicious_flagsUrlEncodedPassword() {
        assertThat(p.detectSuspicious("password%3Dhunter2supersecret")).contains("PASSWORD");
    }
}
