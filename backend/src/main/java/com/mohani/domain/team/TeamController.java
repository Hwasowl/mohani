package com.mohani.domain.team;

import com.mohani.domain.team.TeamService.LeaveResult;
import com.mohani.domain.team.TeamService.MemberView;
import com.mohani.domain.team.TeamService.TeamView;
import com.mohani.global.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/teams")
public class TeamController {

    private final TeamService teamService;

    public TeamController(TeamService teamService) {
        this.teamService = teamService;
    }

    @PostMapping
    public TeamView create(AuthenticatedUser user, @Valid @RequestBody CreateRequest req) {
        return teamService.create(user.userId(), req.name());
    }

    @PostMapping("/join")
    public TeamView join(AuthenticatedUser user, @Valid @RequestBody JoinRequest req) {
        return teamService.join(user.userId(), req.teamCode());
    }

    @GetMapping("/me")
    public List<TeamView> myTeams(AuthenticatedUser user) {
        return teamService.listMyTeams(user.userId());
    }

    @GetMapping("/{teamId}/members")
    public List<MemberView> members(AuthenticatedUser user, @PathVariable Long teamId) {
        return teamService.listMembers(teamId, user.userId());
    }

    @DeleteMapping("/{teamId}/leave")
    public LeaveResult leave(AuthenticatedUser user, @PathVariable Long teamId) {
        return teamService.leave(teamId, user.userId());
    }

    public record CreateRequest(@NotBlank @Size(max = 64) String name) {}
    public record JoinRequest(@NotBlank @Size(max = 6) String teamCode) {}
}
