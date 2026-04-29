package com.mohani.domain.auth;

import com.mohani.domain.auth.exception.UserNotFoundException;
import com.mohani.global.auth.JwtService;
import java.net.URI;
import java.util.Set;
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
        return new AnonymousLoginResult(user.getId(), user.getDisplayName(), user.getAvatarUrl(),
            token, jwt.getTtlSeconds());
    }

    @Transactional
    public String updateDisplayName(long userId, String newDisplayName) {
        User user = users.findById(userId)
            .orElseThrow(() -> new UserNotFoundException(userId));
        user.rename(newDisplayName);
        return user.getDisplayName();
    }

    // 아바타 URL은 ImgBB 호스트(https) 만 허용 — chat 이미지와 동일 정책. null/empty → 제거.
    private static final Set<String> ALLOWED_AVATAR_HOSTS = Set.of("i.ibb.co", "ibb.co");

    @Transactional
    public String updateAvatarUrl(long userId, String url) {
        User user = users.findById(userId)
            .orElseThrow(() -> new UserNotFoundException(userId));
        String normalized = normalizeAvatarUrl(url);
        user.setAvatarUrl(normalized);
        return normalized;
    }

    private static String normalizeAvatarUrl(String raw) {
        if (raw == null) return null;
        String u = raw.trim();
        if (u.isEmpty()) return null;
        if (u.length() > 512) throw new IllegalArgumentException("avatarUrl too long");
        try {
            URI uri = URI.create(u);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                throw new IllegalArgumentException("https URL only");
            }
            String host = uri.getHost();
            if (host == null || !ALLOWED_AVATAR_HOSTS.contains(host.toLowerCase())) {
                throw new IllegalArgumentException("host not allowed");
            }
            return u;
        } catch (IllegalArgumentException e) {
            throw e;
        }
    }

    public record AnonymousLoginResult(long userId, String displayName, String avatarUrl,
                                       String token, long ttlSeconds) {
    }
}
