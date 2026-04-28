package com.mohani.domain.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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

    @Test
    void updateDisplayName_changesNameAndPersistsAcrossLogin() throws Exception {
        MvcResult login = mvc.perform(post("/api/v1/auth/anonymous")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"deviceId":"dev-rename-1","displayName":"옛이름"}
                    """))
            .andExpect(status().isOk()).andReturn();
        JsonNode loginJson = om.readTree(login.getResponse().getContentAsString());
        String token = loginJson.get("token").asText();
        long userId = loginJson.get("userId").asLong();

        mvc.perform(patch("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"displayName":"새이름"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").value(userId))
            .andExpect(jsonPath("$.displayName").value("새이름"));

        mvc.perform(post("/api/v1/auth/anonymous")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"deviceId":"dev-rename-1","displayName":"무시됨"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.displayName").value("새이름"));
    }

    @Test
    void updateDisplayName_requiresAuth() throws Exception {
        mvc.perform(patch("/api/v1/auth/me")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"displayName":"x"}
                    """))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void updateDisplayName_rejectsBlank() throws Exception {
        MvcResult login = mvc.perform(post("/api/v1/auth/anonymous")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"deviceId":"dev-rename-2","displayName":"이름"}
                    """))
            .andExpect(status().isOk()).andReturn();
        String token = om.readTree(login.getResponse().getContentAsString()).get("token").asText();

        mvc.perform(patch("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"displayName":""}
                    """))
            .andExpect(status().isBadRequest());
    }

    private long userIdFrom(MvcResult res) throws Exception {
        return om.readTree(res.getResponse().getContentAsString()).get("userId").asLong();
    }
}
