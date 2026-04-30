package com.mohani.global.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    private final SecretKey key;
    private final long ttlSeconds;

    // 약한 secret 패턴 — 과거 application.yml에 들어있던 dev fallback이나 README 예시 등이 prod로 새는 것 차단.
    private static final String[] WEAK_SECRET_PREFIXES = {
        "dev-secret",
        "change-me",
        "changeme",
        "example",
        "test-secret",
    };

    public JwtService(JwtProperties props) {
        String raw = props.secret();
        if (raw == null || raw.isBlank()) {
            throw new IllegalStateException("mohani.jwt.secret is required (set MOHANI_JWT_SECRET env var)");
        }
        String lower = raw.toLowerCase();
        for (String weak : WEAK_SECRET_PREFIXES) {
            if (lower.startsWith(weak)) {
                throw new IllegalStateException(
                    "mohani.jwt.secret looks like a dev/example value — refuse to boot. "
                        + "Generate a strong random secret (e.g. `openssl rand -hex 32`)."
                );
            }
        }
        byte[] secret = raw.getBytes(StandardCharsets.UTF_8);
        if (secret.length < 32) {
            throw new IllegalStateException("mohani.jwt.secret must be at least 32 bytes");
        }
        this.key = Keys.hmacShaKeyFor(secret);
        this.ttlSeconds = props.ttlSeconds();
    }

    public String issue(long userId) {
        Instant now = Instant.now();
        return Jwts.builder()
            .subject(String.valueOf(userId))
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plusSeconds(ttlSeconds)))
            .signWith(key)
            .compact();
    }

    public long parseUserId(String token) {
        Claims claims = Jwts.parser()
            .verifyWith(key)
            .build()
            .parseSignedClaims(token)
            .getPayload();
        return Long.parseLong(claims.getSubject());
    }

    public long getTtlSeconds() {
        return ttlSeconds;
    }
}
