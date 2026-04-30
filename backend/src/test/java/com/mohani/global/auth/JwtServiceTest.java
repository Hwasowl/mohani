package com.mohani.global.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class JwtServiceTest {

    // 32바이트 이상 + WEAK_SECRET_PREFIXES 어디에도 안 걸리는 값.
    private static final String SECRET = "9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a";

    private JwtService newService(long ttl) {
        return new JwtService(new JwtProperties(SECRET, ttl));
    }

    @Test
    void issuedTokenRoundTripsTheUserId() {
        JwtService svc = newService(3600);
        String token = svc.issue(42L);
        assertThat(svc.parseUserId(token)).isEqualTo(42L);
    }

    @Test
    void rejectsShortSecret() {
        assertThatThrownBy(() -> new JwtService(new JwtProperties("short", 60)))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsBlankSecret() {
        assertThatThrownBy(() -> new JwtService(new JwtProperties("", 60)))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("required");
        assertThatThrownBy(() -> new JwtService(new JwtProperties(null, 60)))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsDevFallbackSecret() {
        // 과거 application.yml fallback. 환경변수 누락 시 prod에 새지 못하도록 부팅 거부.
        String oldFallback = "dev-secret-change-me-1234567890abcdef1234567890abcdef";
        assertThatThrownBy(() -> new JwtService(new JwtProperties(oldFallback, 60)))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("dev/example");
    }

    @Test
    void rejectsCommonWeakPrefixes() {
        for (String weak : new String[] {
            "change-me-but-still-32-bytes-padding-padding-padding",
            "changeme-but-still-32-bytes-padding-padding-padding!!",
            "example-secret-32-bytes-padding-padding-padding-padding",
            "test-secret-with-32-bytes-padding-padding-padding-padding",
        }) {
            assertThatThrownBy(() -> new JwtService(new JwtProperties(weak, 60)))
                .isInstanceOf(IllegalStateException.class);
        }
    }

    @Test
    void parseFailsForGarbageToken() {
        JwtService svc = newService(60);
        assertThatThrownBy(() -> svc.parseUserId("not.a.jwt")).isInstanceOf(Exception.class);
    }

    @Test
    void parseFailsForExpiredToken() throws InterruptedException {
        JwtService svc = newService(1);
        String token = svc.issue(7L);
        Thread.sleep(1500);
        assertThatThrownBy(() -> svc.parseUserId(token)).isInstanceOf(Exception.class);
    }
}
