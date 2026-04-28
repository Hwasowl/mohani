package com.mohani.domain.stat;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class StatService {

    private static final DateTimeFormatter YMD = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final Duration TTL = Duration.ofDays(35);

    private final StringRedisTemplate redis;

    public StatService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void addTokens(long userId, long tokens, LocalDate day) {
        if (tokens <= 0) return;
        String key = tokenKey(userId, day);
        redis.opsForValue().increment(key, tokens);
        redis.expire(key, TTL);
    }

    public void addDurationSec(long userId, long seconds, LocalDate day) {
        if (seconds <= 0) return;
        String key = durationKey(userId, day);
        redis.opsForValue().increment(key, seconds);
        redis.expire(key, TTL);
    }

    public long getTodayTokens(long userId, LocalDate day) {
        String v = redis.opsForValue().get(tokenKey(userId, day));
        return v == null ? 0 : Long.parseLong(v);
    }

    public long getTodayDurationSec(long userId, LocalDate day) {
        String v = redis.opsForValue().get(durationKey(userId, day));
        return v == null ? 0 : Long.parseLong(v);
    }

    private static String tokenKey(long userId, LocalDate day) {
        return "mohani:tok:user:" + userId + ":daily:" + YMD.format(day);
    }

    private static String durationKey(long userId, LocalDate day) {
        return "mohani:time:user:" + userId + ":daily:" + YMD.format(day);
    }
}
