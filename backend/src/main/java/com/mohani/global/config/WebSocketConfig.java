package com.mohani.global.config;

import com.mohani.global.auth.AuthenticatedUser;
import com.mohani.global.auth.JwtService;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.util.List;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtService jwtService;

    public WebSocketConfig(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws").setAllowedOriginPatterns("*"); // 데모: 모든 origin 허용
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor acc = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (acc != null && StompCommand.CONNECT.equals(acc.getCommand())) {
                    String token = firstHeader(acc, "Authorization");
                    if (token != null && token.startsWith("Bearer ")) {
                        try {
                            long userId = jwtService.parseUserId(token.substring("Bearer ".length()).trim());
                            AuthenticatedUser principal = new AuthenticatedUser(userId);
                            acc.setUser(new UsernamePasswordAuthenticationToken(principal, token, List.of()));
                        } catch (Exception ignored) {
                            // 익명 연결로 진행 — 보호된 토픽 구독 시 별도 인터셉터에서 차단 가능
                        }
                    }
                }
                return message;
            }
        });
    }

    private static String firstHeader(StompHeaderAccessor acc, String name) {
        List<String> values = acc.getNativeHeader(name);
        return (values == null || values.isEmpty()) ? null : values.get(0);
    }
}
