package com.mohani.global.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityConfigCorsIT {

    @Autowired MockMvc mvc;

    @Test
    void corsPreflightForAuthEndpoint_returnsOkWithCorsHeaders() throws Exception {
        mvc.perform(options("/api/v1/auth/anonymous")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type"))
            .andExpect(status().isOk())
            .andExpect(header().exists("Access-Control-Allow-Origin"))
            .andExpect(header().exists("Access-Control-Allow-Methods"));
    }

    @Test
    void corsPreflightForProtectedEndpoint_returnsOkWithoutAuth() throws Exception {
        // 보호된 endpoint라도 OPTIONS 자체는 인증 불필요 — 그래야 브라우저 preflight가 통과
        mvc.perform(options("/api/v1/teams/me")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization"))
            .andExpect(status().isOk());
    }

    @Test
    void corsPreflightForPatchMe_allowsPatchMethod() throws Exception {
        // PATCH가 setAllowedMethods에 누락되면 preflight가 403 — 회귀 방지
        mvc.perform(options("/api/v1/auth/me")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "PATCH")
                .header("Access-Control-Request-Headers", "authorization,content-type"))
            .andExpect(status().isOk())
            .andExpect(header().exists("Access-Control-Allow-Methods"));
    }
}
