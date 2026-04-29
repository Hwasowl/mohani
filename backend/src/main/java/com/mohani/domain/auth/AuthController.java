package com.mohani.domain.auth;

import com.mohani.domain.auth.AuthService.AnonymousLoginResult;
import com.mohani.global.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/anonymous")
    public AuthResponse anonymous(@Valid @RequestBody AnonymousRequest req) {
        AnonymousLoginResult result = authService.loginAnonymous(req.deviceId(), req.displayName());
        return new AuthResponse(result.userId(), result.displayName(), result.avatarUrl(),
            result.token(), result.ttlSeconds());
    }

    @PatchMapping("/me")
    public MeResponse updateMe(AuthenticatedUser user, @Valid @RequestBody UpdateMeRequest req) {
        String name = authService.updateDisplayName(user.userId(), req.displayName());
        return new MeResponse(user.userId(), name);
    }

    @PatchMapping("/me/avatar")
    public AvatarResponse updateAvatar(AuthenticatedUser user, @RequestBody UpdateAvatarRequest req) {
        // null/empty 허용 — 아바타 제거 의미
        String url = authService.updateAvatarUrl(user.userId(), req == null ? null : req.avatarUrl());
        return new AvatarResponse(user.userId(), url);
    }

    public record AnonymousRequest(
        @NotBlank @Size(max = 64) String deviceId,
        @Size(max = 64) String displayName
    ) {
    }

    public record AuthResponse(long userId, String displayName, String avatarUrl,
                               String token, long ttlSeconds) {
    }

    public record UpdateMeRequest(@NotBlank @Size(max = 64) String displayName) {}
    public record MeResponse(long userId, String displayName) {}

    public record UpdateAvatarRequest(@Size(max = 512) String avatarUrl) {}
    public record AvatarResponse(long userId, String avatarUrl) {}
}
