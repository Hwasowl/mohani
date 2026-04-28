package com.mohani.global.auth;

// Spring Security Authentication.principal 로 들어가는 단일 클래스.
// SecurityContext에서 꺼내 쓰는 도메인 측면의 user 식별자.
public record AuthenticatedUser(long userId) {
}
