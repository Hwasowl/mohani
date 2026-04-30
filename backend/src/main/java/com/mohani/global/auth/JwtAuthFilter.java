package com.mohani.global.auth;

import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.MalformedJwtException;
import io.jsonwebtoken.security.SignatureException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring("Bearer ".length()).trim();
            try {
                long userId = jwtService.parseUserId(token);
                AuthenticatedUser principal = new AuthenticatedUser(userId);
                UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(principal, token, List.of());
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (ExpiredJwtException e) {
                // 만료 — 클라가 갱신해야 함. WARN 아님.
                log.debug("jwt expired ip={}", clientIp(request));
            } catch (SignatureException e) {
                // 서명 불일치 — 위조 시도 가능성. 모니터링 필요.
                log.warn("jwt signature invalid ip={} reason={}", clientIp(request), e.getClass().getSimpleName());
            } catch (MalformedJwtException e) {
                log.debug("jwt malformed ip={}", clientIp(request));
            } catch (Exception e) {
                log.debug("jwt parse failed ip={} type={}", clientIp(request), e.getClass().getSimpleName());
            }
        }
        chain.doFilter(request, response);
    }

    private static String clientIp(HttpServletRequest req) {
        // X-Forwarded-For 신뢰는 reverse proxy 설정에 의존. 단순 remoteAddr만 사용.
        return req.getRemoteAddr();
    }
}
