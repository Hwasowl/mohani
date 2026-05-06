package com.mohani.global.config;

import com.mohani.global.auth.JwtAuthFilter;
import java.util.Arrays;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(eh -> eh.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
            .authorizeHttpRequests(auth -> auth
                // CORS preflight는 항상 허용 — Spring 자동 처리에 의존하지 않고 명시적으로
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(
                    "/api/v1/health",
                    "/api/v1/auth/anonymous",
                    "/actuator/health",
                    "/ws/**"
                ).permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration cfg = new CorsConfiguration();
        // H2 (0.1.12): Electron 전용 클라이언트 — packaged는 file:// (Origin "null"),
        // dev는 localhost:5173. 임의 웹 origin이 사용자 자격으로 호출하던 표면(*+credentials) 제거.
        // 외부 웹 클라이언트가 추가되면 MOHANI_ALLOWED_ORIGINS env로 명시 (콤마 구분).
        cfg.setAllowedOriginPatterns(allowedOrigins());
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        cfg.setExposedHeaders(List.of("Authorization"));
        // JWT는 Authorization 헤더로 — 쿠키 자격증명 불필요. credentials false로 CSRF 표면 추가 축소.
        cfg.setAllowCredentials(false);
        cfg.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }

    // Electron file:// 페이지는 Origin 헤더를 "null" 또는 file://* 로 보낸다 (Chromium 버전별).
    // 두 변형 모두 허용. localhost 5173은 vite dev 서버.
    static List<String> allowedOrigins() {
        String env = System.getenv("MOHANI_ALLOWED_ORIGINS");
        if (env != null && !env.isBlank()) {
            return Arrays.stream(env.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        }
        return List.of(
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "file://*",
            "null"
        );
    }
}
