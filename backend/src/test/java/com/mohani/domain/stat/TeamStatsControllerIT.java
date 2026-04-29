package com.mohani.domain.stat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mohani.domain.activity.ActivityLog;
import com.mohani.domain.activity.ActivityLogRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TeamStatsControllerIT {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper om;
    // Redis가 없는 테스트 환경에서도 통과하도록 StatService를 mock으로 대체.
    @MockBean StatService stats;
    @Autowired ActivityLogRepository activities;

    private String aliceToken;
    private long aliceId;
    private String bobToken;
    private long bobId;
    private String carolToken;

    @BeforeEach
    void setup() throws Exception {
        var alice = register("dev-stat-alice", "Alice");
        aliceToken = alice.token; aliceId = alice.userId;
        var bob = register("dev-stat-bob", "Bob");
        bobToken = bob.token; bobId = bob.userId;
        var carol = register("dev-stat-carol", "Carol");
        carolToken = carol.token;
    }

    @Test
    void todayStats_returnsTokensAndDurationForAllMembers() throws Exception {
        long teamId = createTeamAndJoinBob();
        when(stats.getTodayTokens(eq(aliceId), any(LocalDate.class))).thenReturn(1500L);
        when(stats.getTodayDurationSec(eq(aliceId), any(LocalDate.class))).thenReturn(600L);
        when(stats.getTodayTokens(eq(bobId), any(LocalDate.class))).thenReturn(800L);
        when(stats.getTodayDurationSec(eq(bobId), any(LocalDate.class))).thenReturn(300L);

        // Alice의 lastSeen용 활동 1개
        activities.save(ActivityLog.builder()
            .userId(aliceId).teamId(teamId).occurredAt(OffsetDateTime.now())
            .promptFirstLine("test").eventKind("prompt_submit").build());

        MvcResult res = mvc.perform(get("/api/v1/teams/" + teamId + "/today-stats")
                .header("Authorization", "Bearer " + aliceToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andReturn();

        JsonNode arr = om.readTree(res.getResponse().getContentAsString());
        // 결과는 멤버 순 — userId로 매칭
        boolean foundAlice = false, foundBob = false;
        for (JsonNode n : arr) {
            long uid = n.get("userId").asLong();
            if (uid == aliceId) {
                assertThat(n.get("todayTokens").asLong()).isEqualTo(1500);
                assertThat(n.get("todayDurationSec").asLong()).isEqualTo(600);
                assertThat(n.get("lastSeen").isNull()).isFalse();
                foundAlice = true;
            } else if (uid == bobId) {
                assertThat(n.get("todayTokens").asLong()).isEqualTo(800);
                assertThat(n.get("todayDurationSec").asLong()).isEqualTo(300);
                assertThat(n.get("lastSeen").isNull()).isTrue();
                foundBob = true;
            }
        }
        assertThat(foundAlice && foundBob).isTrue();
    }

    @Test
    void todayStats_byNonMember_returns403() throws Exception {
        long teamId = createTeamAndJoinBob();
        mvc.perform(get("/api/v1/teams/" + teamId + "/today-stats")
                .header("Authorization", "Bearer " + carolToken))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("NOT_A_MEMBER"));
    }

    @Test
    void todayStats_unauthenticated_returns401() throws Exception {
        mvc.perform(get("/api/v1/teams/1/today-stats"))
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
                .content("{\"name\":\"통계팀\"}"))
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
