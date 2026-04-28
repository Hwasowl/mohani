package com.mohani.domain.team;

import java.security.SecureRandom;
import org.springframework.stereotype.Component;

// 6자리 영숫자(혼동되는 0/O/1/I 제외) — Discord 스타일 코드.
@Component
public class TeamCodeGenerator {

    private static final char[] ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    private static final int LENGTH = 6;

    private final SecureRandom random;

    public TeamCodeGenerator() {
        this(new SecureRandom());
    }

    public TeamCodeGenerator(SecureRandom random) {
        this.random = random;
    }

    public String next() {
        char[] out = new char[LENGTH];
        for (int i = 0; i < LENGTH; i++) {
            out[i] = ALPHABET[random.nextInt(ALPHABET.length)];
        }
        return new String(out);
    }
}
