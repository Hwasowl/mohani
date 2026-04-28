package com.mohani.domain.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mohani.global.auth.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthControllerIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;
    @Autowired JwtService jwtService;

    @Test
    void anonymousLogin_createsUserAndReturnsValidJwt() throws Exception {
        String body = """
            {"deviceId":"dev-001","displayName":"화소"}
            """;

        MvcResult res = mvc.perform(post("/api/v1/auth/anonymous")
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").exists())
            .andExpect(jsonPath("$.displayName").value("화소"))
            .andExpect(jsonPath("$.token").exists())
            .andReturn();

        JsonNode json = om.readTree(res.getResponse().getContentAsString());
        long userId = json.get("userId").asLong();
        String token = json.get("token").asText();
        assertThat(jwtService.parseUserId(token)).isEqualTo(userId);
    }

    @Test
    void anonymousLogin_isIdempotentForSameDeviceId() throws Exception {
        String body = """
            {"deviceId":"dev-002","displayName":"A"}
            """;

        long firstId = userIdFrom(mvc.perform(post("/api/v1/auth/anonymous")
            .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk()).andReturn());

        long secondId = userIdFrom(mvc.perform(post("/api/v1/auth/anonymous")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"deviceId":"dev-002","displayName":"B"}
                """))
            .andExpect(status().isOk()).andReturn());

        assertThat(secondId).isEqualTo(firstId);
    }

    private long userIdFrom(MvcResult res) throws Exception {
        return om.readTree(res.getResponse().getContentAsString()).get("userId").asLong();
    }
}
