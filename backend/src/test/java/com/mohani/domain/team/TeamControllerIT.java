package com.mohani.domain.team;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
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
class TeamControllerIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;

    private String aliceToken;
    private long aliceId;
    private String bobToken;
    private long bobId;

    @BeforeEach
    void registerUsers() throws Exception {
        var alice = register("dev-alice", "Alice");
        aliceToken = alice.token;
        aliceId = alice.userId;

        var bob = register("dev-bob", "Bob");
        bobToken = bob.token;
        bobId = bob.userId;
    }

    @Test
    void createTeam_thenJoin_thenListMembers() throws Exception {
        // Alice가 팀 생성
        MvcResult create = mvc.perform(post("/api/v1/teams")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"우리코딩팀"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.teamCode").exists())
            .andExpect(jsonPath("$.name").value("우리코딩팀"))
            .andExpect(jsonPath("$.ownerId").value(aliceId))
            .andReturn();
        String code = om.readTree(create.getResponse().getContentAsString()).get("teamCode").asText();
        long teamId = om.readTree(create.getResponse().getContentAsString()).get("id").asLong();

        // Bob이 팀 가입
        mvc.perform(post("/api/v1/teams/join")
                .header("Authorization", "Bearer " + bobToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(String.format("{\"teamCode\":\"%s\"}", code)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.teamCode").value(code));

        // Alice가 멤버 조회 → Alice + Bob 둘 다
        MvcResult list = mvc.perform(get("/api/v1/teams/" + teamId + "/members")
                .header("Authorization", "Bearer " + aliceToken))
            .andExpect(status().isOk())
            .andReturn();
        JsonNode members = om.readTree(list.getResponse().getContentAsString());
        assertThat(members.size()).isEqualTo(2);
    }

    @Test
    void join_idempotent_doesNotDuplicate() throws Exception {
        String code = createTeamForAlice("팀");
        joinAs(bobToken, code);
        joinAs(bobToken, code); // 두 번째 가입은 no-op

        long teamId = teamIdByCode(code);
        MvcResult list = mvc.perform(get("/api/v1/teams/" + teamId + "/members")
                .header("Authorization", "Bearer " + aliceToken))
            .andExpect(status().isOk()).andReturn();
        assertThat(om.readTree(list.getResponse().getContentAsString()).size()).isEqualTo(2);
    }

    @Test
    void join_withWrongCode_returns404() throws Exception {
        mvc.perform(post("/api/v1/teams/join")
                .header("Authorization", "Bearer " + bobToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"teamCode":"ZZZZZZ"}
                    """))
            .andExpect(status().isNotFound());
    }

    @Test
    void members_byNonMember_returns403() throws Exception {
        String code = createTeamForAlice("팀");
        long teamId = teamIdByCode(code);

        mvc.perform(get("/api/v1/teams/" + teamId + "/members")
                .header("Authorization", "Bearer " + bobToken))
            .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticated_request_returns401() throws Exception {
        mvc.perform(get("/api/v1/teams/me"))
            .andExpect(status().isUnauthorized());
    }

    // --- helpers -----------------------------------------------------------

    private record Registered(long userId, String token) {}

    private Registered register(String deviceId, String name) throws Exception {
        MvcResult res = mvc.perform(post("/api/v1/auth/anonymous")
            .contentType(MediaType.APPLICATION_JSON)
            .content(String.format("{\"deviceId\":\"%s\",\"displayName\":\"%s\"}", deviceId, name)))
            .andExpect(status().isOk()).andReturn();
        JsonNode json = om.readTree(res.getResponse().getContentAsString());
        return new Registered(json.get("userId").asLong(), json.get("token").asText());
    }

    private String createTeamForAlice(String name) throws Exception {
        MvcResult res = mvc.perform(post("/api/v1/teams")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(String.format("{\"name\":\"%s\"}", name)))
            .andExpect(status().isOk()).andReturn();
        return om.readTree(res.getResponse().getContentAsString()).get("teamCode").asText();
    }

    private void joinAs(String token, String code) throws Exception {
        mvc.perform(post("/api/v1/teams/join")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(String.format("{\"teamCode\":\"%s\"}", code)))
            .andExpect(status().isOk());
    }

    private long teamIdByCode(String code) throws Exception {
        MvcResult res = mvc.perform(get("/api/v1/teams/me")
                .header("Authorization", "Bearer " + aliceToken))
            .andExpect(status().isOk()).andReturn();
        JsonNode arr = om.readTree(res.getResponse().getContentAsString());
        for (JsonNode t : arr) {
            if (t.get("teamCode").asText().equals(code)) return t.get("id").asLong();
        }
        throw new IllegalStateException("team not found in /me: " + code);
    }
}
