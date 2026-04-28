package com.mohani.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TeamCodeGeneratorTest {

    @Test
    void generates_6char_codes_in_safe_alphabet() {
        TeamCodeGenerator gen = new TeamCodeGenerator();
        for (int i = 0; i < 100; i++) {
            String code = gen.next();
            assertThat(code).hasSize(6);
            assertThat(code).matches("[A-HJ-NP-Z2-9]{6}");
        }
    }

    @Test
    void produces_high_entropy_codes() {
        TeamCodeGenerator gen = new TeamCodeGenerator();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 1000; i++) seen.add(gen.next());
        // 32^6 = 1.07B 공간이라 1k에서 충돌은 거의 0이어야 함
        assertThat(seen).hasSizeGreaterThanOrEqualTo(999);
    }
}
