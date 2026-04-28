package com.mohani.domain.auth;

import com.mohani.global.auth.JwtService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserRepository users;
    private final JwtService jwt;

    public AuthService(UserRepository users, JwtService jwt) {
        this.users = users;
        this.jwt = jwt;
    }

    @Transactional
    public AnonymousLoginResult loginAnonymous(String deviceId, String displayName) {
        if (deviceId == null || deviceId.isBlank()) {
            throw new IllegalArgumentException("deviceId is required");
        }
        String name = (displayName == null || displayName.isBlank()) ? "익명" : displayName;

        User user = users.findByDeviceId(deviceId)
            .orElseGet(() -> users.save(User.newAnonymous(deviceId, name)));

        String token = jwt.issue(user.getId());
        return new AnonymousLoginResult(user.getId(), user.getDisplayName(), token, jwt.getTtlSeconds());
    }

    @Transactional
    public String updateDisplayName(long userId, String newDisplayName) {
        User user = users.findById(userId)
            .orElseThrow(() -> new UserNotFoundException("user not found: " + userId));
        user.rename(newDisplayName);
        return user.getDisplayName();
    }

    public record AnonymousLoginResult(long userId, String displayName, String token, long ttlSeconds) {
    }

    public static class UserNotFoundException extends RuntimeException {
        public UserNotFoundException(String msg) { super(msg); }
    }
}
