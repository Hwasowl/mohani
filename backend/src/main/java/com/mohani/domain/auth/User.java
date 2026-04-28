package com.mohani.domain.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", unique = true, length = 64)
    private String deviceId;

    @Column(unique = true, length = 255)
    private String email;

    @Column(name = "display_name", nullable = false, length = 64)
    private String displayName;

    @Column(name = "avatar_url", length = 512)
    private String avatarUrl;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Builder
    private User(Long id, String deviceId, String email, String displayName, String avatarUrl,
                 OffsetDateTime createdAt) {
        this.id = id;
        this.deviceId = deviceId;
        this.email = email;
        this.displayName = displayName;
        this.avatarUrl = avatarUrl;
        this.createdAt = createdAt;
    }

    public static User newAnonymous(String deviceId, String displayName) {
        return User.builder()
            .deviceId(deviceId)
            .displayName(displayName)
            .createdAt(OffsetDateTime.now())
            .build();
    }

    public void rename(String newDisplayName) {
        if (newDisplayName == null || newDisplayName.isBlank()) {
            throw new IllegalArgumentException("displayName must not be blank");
        }
        String trimmed = newDisplayName.trim();
        if (trimmed.length() > 64) {
            throw new IllegalArgumentException("displayName too long (max 64)");
        }
        this.displayName = trimmed;
    }
}
