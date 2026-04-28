package com.mohani.domain.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mohani.domain.auth.AuthService.AnonymousLoginResult;
import com.mohani.global.auth.JwtService;
import java.lang.reflect.Field;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {

    @Mock UserRepository users;
    @Mock JwtService jwt;
    @InjectMocks AuthService service;

    @BeforeEach
    void setupJwtBehavior() {
        when(jwt.getTtlSeconds()).thenReturn(3600L);
    }

    @Test
    void createsNewUserWhenDeviceIdNotSeen() throws Exception {
        when(users.findByDeviceId("dev-1")).thenReturn(Optional.empty());
        when(users.save(any(User.class))).thenAnswer(inv -> withId(inv.getArgument(0), 99L));
        when(jwt.issue(99L)).thenReturn("tok");

        AnonymousLoginResult result = service.loginAnonymous("dev-1", "테스터");

        assertThat(result.userId()).isEqualTo(99L);
        assertThat(result.displayName()).isEqualTo("테스터");
        assertThat(result.token()).isEqualTo("tok");
        assertThat(result.ttlSeconds()).isEqualTo(3600L);
        verify(users, times(1)).save(any(User.class));
    }

    @Test
    void reusesExistingUserOnSameDeviceId() throws Exception {
        User existing = withId(User.newAnonymous("dev-1", "이전이름"), 42L);
        when(users.findByDeviceId("dev-1")).thenReturn(Optional.of(existing));
        when(jwt.issue(42L)).thenReturn("tok2");

        AnonymousLoginResult result = service.loginAnonymous("dev-1", "새로운이름무시됨");

        assertThat(result.userId()).isEqualTo(42L);
        assertThat(result.displayName()).isEqualTo("이전이름");
        verify(users, never()).save(any(User.class));
    }

    @Test
    void defaultsDisplayNameWhenBlank() throws Exception {
        when(users.findByDeviceId(any())).thenReturn(Optional.empty());
        when(users.save(any(User.class))).thenAnswer(inv -> withId(inv.getArgument(0), 1L));
        when(jwt.issue(1L)).thenReturn("t");

        AnonymousLoginResult r = service.loginAnonymous("dev-x", "  ");
        assertThat(r.displayName()).isEqualTo("익명");
    }

    @Test
    void rejectsBlankDeviceId() {
        assertThatThrownBy(() -> service.loginAnonymous(" ", "x"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.loginAnonymous(null, "x"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void updateDisplayName_persistsTrimmedName() throws Exception {
        User existing = withId(User.newAnonymous("dev-9", "옛이름"), 7L);
        when(users.findById(7L)).thenReturn(Optional.of(existing));

        String result = service.updateDisplayName(7L, "  화소  ");

        assertThat(result).isEqualTo("화소");
        assertThat(existing.getDisplayName()).isEqualTo("화소");
    }

    @Test
    void updateDisplayName_throwsWhenUserMissing() {
        when(users.findById(404L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.updateDisplayName(404L, "x"))
            .isInstanceOf(AuthService.UserNotFoundException.class);
    }

    @Test
    void updateDisplayName_rejectsBlank() throws Exception {
        User existing = withId(User.newAnonymous("dev-10", "옛이름"), 8L);
        when(users.findById(8L)).thenReturn(Optional.of(existing));
        assertThatThrownBy(() -> service.updateDisplayName(8L, "  "))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private static User withId(User u, long id) throws Exception {
        Field f = User.class.getDeclaredField("id");
        f.setAccessible(true);
        f.set(u, id);
        return u;
    }
}
