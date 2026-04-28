package com.mohani.global.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private static final String SECRET = "test-secret-needs-32-bytes-min-1234567890abcdef";

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
