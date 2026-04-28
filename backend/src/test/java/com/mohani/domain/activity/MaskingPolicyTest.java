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
}
