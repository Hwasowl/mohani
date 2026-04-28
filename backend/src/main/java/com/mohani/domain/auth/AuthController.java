package com.mohani.domain.auth;

import com.mohani.domain.auth.AuthService.AnonymousLoginResult;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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
    public AuthResponse anonymous(@RequestBody AnonymousRequest req) {
        AnonymousLoginResult result = authService.loginAnonymous(req.deviceId(), req.displayName());
        return new AuthResponse(result.userId(), result.displayName(), result.token(), result.ttlSeconds());
    }

    public record AnonymousRequest(
        @NotBlank @Size(max = 64) String deviceId,
        @Size(max = 64) String displayName
    ) {
    }

    public record AuthResponse(long userId, String displayName, String token, long ttlSeconds) {
    }
}
