package com.mohani.global.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mohani.jwt")
public record JwtProperties(String secret, long ttlSeconds) {
}
