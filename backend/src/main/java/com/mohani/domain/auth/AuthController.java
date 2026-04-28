package com.mohani.domain.auth;

import com.mohani.domain.auth.AuthService.AnonymousLoginResult;
import com.mohani.global.auth.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
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

    @PatchMapping("/me")
    public MeResponse updateMe(AuthenticatedUser user, @Valid @RequestBody UpdateMeRequest req) {
        String name = authService.updateDisplayName(user.userId(), req.displayName());
        return new MeResponse(user.userId(), name);
    }

    @ExceptionHandler(AuthService.UserNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiError notFound(AuthService.UserNotFoundException ex) {
        return new ApiError("USER_NOT_FOUND", ex.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiError badRequest(IllegalArgumentException ex) {
        return new ApiError("BAD_REQUEST", ex.getMessage());
    }

    public record AnonymousRequest(
        @NotBlank @Size(max = 64) String deviceId,
        @Size(max = 64) String displayName
    ) {
    }

    public record AuthResponse(long userId, String displayName, String token, long ttlSeconds) {
    }

    public record UpdateMeRequest(@NotBlank @Size(max = 64) String displayName) {}
    public record MeResponse(long userId, String displayName) {}
    public record ApiError(String code, String message) {}
}
