package com.mohani.domain.activity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
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
class ActivityHistoryControllerIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;
    @Autowired ActivityLogRepository activities;

    private String aliceToken;
    private long aliceId;
    private String bobToken;
    private long bobId;
    private String carolToken;

    @BeforeEach
    void setup() throws Exception {
        var alice = register("dev-hist-alice", "Alice");
        aliceToken = alice.token; aliceId = alice.userId;
        var bob = register("dev-hist-bob", "Bob");
        bobToken = bob.token; bobId = bob.userId;
        var carol = register("dev-hist-carol", "Carol");
        carolToken = carol.token;
    }

    @Test
    void recent_returnsActivityForGivenMember_inDescOrder() throws Exception {
        // Alice가 팀 만들고 Bob 가입
        long teamId = createTeamAndJoinBob();

        // Bob의 활동 3건 직접 저장 (occurredAt 순서대로)
        OffsetDateTime base = OffsetDateTime.now();
        activities.save(ActivityLog.builder()
            .userId(bobId).teamId(teamId).occurredAt(base.minusMinutes(10))
            .promptFirstLine("첫번째 작업").eventKind("prompt_submit").build());
        activities.save(ActivityLog.builder()
            .userId(bobId).teamId(teamId).occurredAt(base.minusMinutes(5))
            .promptFirstLine("두번째 작업").eventKind("prompt_submit").build());
        activities.save(ActivityLog.builder()
            .userId(bobId).teamId(teamId).occurredAt(base)
            .promptFirstLine("세번째 작업").eventKind("prompt_submit").build());

        // Alice가 Bob의 활동 조회
        MvcResult res = mvc.perform(get("/api/v1/activity")
                .param("teamId", String.valueOf(teamId))
                .param("userId", String.valueOf(bobId))
                .header("Authorization", "Bearer " + aliceToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3))
            .andReturn();

        JsonNode arr = om.readTree(res.getResponse().getContentAsString());
        // 최신 → 과거 순
        assertThat(arr.get(0).get("promptFirstLine").asText()).isEqualTo("세번째 작업");
        assertThat(arr.get(1).get("promptFirstLine").asText()).isEqualTo("두번째 작업");
        assertThat(arr.get(2).get("promptFirstLine").asText()).isEqualTo("첫번째 작업");
    }

    @Test
    void recent_limitParameterCaps() throws Exception {
        long teamId = createTeamAndJoinBob();
        OffsetDateTime base = OffsetDateTime.now();
        for (int i = 0; i < 5; i++) {
            activities.save(ActivityLog.builder()
                .userId(bobId).teamId(teamId).occurredAt(base.minusMinutes(i))
                .promptFirstLine("작업 " + i).eventKind("prompt_submit").build());
        }

        mvc.perform(get("/api/v1/activity")
                .param("teamId", String.valueOf(teamId))
                .param("userId", String.valueOf(bobId))
                .param("limit", "2")
                .header("Authorization", "Bearer " + aliceToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void recent_byNonMember_returns403() throws Exception {
        long teamId = createTeamAndJoinBob();
        // Carol은 멤버 아님
        mvc.perform(get("/api/v1/activity")
                .param("teamId", String.valueOf(teamId))
                .param("userId", String.valueOf(bobId))
                .header("Authorization", "Bearer " + carolToken))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("NOT_A_MEMBER"))
            .andExpect(jsonPath("$.traceId").exists());
    }

    @Test
    void recent_unauthenticated_returns401() throws Exception {
        mvc.perform(get("/api/v1/activity")
                .param("teamId", "1")
                .param("userId", "1"))
            .andExpect(status().isUnauthorized());
    }

    // --- helpers ---

    private record Registered(long userId, String token) {}

    private Registered register(String deviceId, String name) throws Exception {
        MvcResult res = mvc.perform(post("/api/v1/auth/anonymous")
            .contentType(MediaType.APPLICATION_JSON)
            .content(String.format("{\"deviceId\":\"%s\",\"displayName\":\"%s\"}", deviceId, name)))
            .andExpect(status().isOk()).andReturn();
        JsonNode json = om.readTree(res.getResponse().getContentAsString());
        return new Registered(json.get("userId").asLong(), json.get("token").asText());
    }

    private long createTeamAndJoinBob() throws Exception {
        MvcResult create = mvc.perform(post("/api/v1/teams")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"히스토리팀\"}"))
            .andExpect(status().isOk()).andReturn();
        JsonNode team = om.readTree(create.getResponse().getContentAsString());
        long teamId = team.get("id").asLong();
        String code = team.get("teamCode").asText();

        mvc.perform(post("/api/v1/teams/join")
                .header("Authorization", "Bearer " + bobToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(String.format("{\"teamCode\":\"%s\"}", code)))
            .andExpect(status().isOk());

        return teamId;
    }
}
