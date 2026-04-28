package com.mohani;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class MohaniApplicationTests {

    @Test
    void contextLoads() {
        // Spring 컨텍스트가 정상 부팅되는지만 검증.
        // 도메인 추가 시 추가 통합 테스트는 각 도메인 패키지에 둔다.
    }
}
