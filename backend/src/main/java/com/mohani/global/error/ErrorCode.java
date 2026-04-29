package com.mohani.global.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    INVALID_INPUT       (HttpStatus.BAD_REQUEST,            "잘못된 입력입니다"),
    UNAUTHORIZED        (HttpStatus.UNAUTHORIZED,           "인증이 필요합니다"),
    FORBIDDEN           (HttpStatus.FORBIDDEN,              "접근 권한이 없습니다"),
    NOT_FOUND           (HttpStatus.NOT_FOUND,              "리소스를 찾을 수 없습니다"),
    TEAM_NOT_FOUND      (HttpStatus.NOT_FOUND,              "팀을 찾을 수 없습니다"),
    NOT_A_MEMBER        (HttpStatus.FORBIDDEN,              "팀 멤버가 아닙니다"),
    USER_NOT_FOUND      (HttpStatus.NOT_FOUND,              "사용자를 찾을 수 없습니다"),
    TEAM_CODE_GENERATION(HttpStatus.CONFLICT,               "팀 코드 생성에 실패했습니다"),
    INTERNAL            (HttpStatus.INTERNAL_SERVER_ERROR,  "서버 오류가 발생했습니다");

    private final HttpStatus status;
    private final String defaultMessage;

    ErrorCode(HttpStatus status, String defaultMessage) {
        this.status = status;
        this.defaultMessage = defaultMessage;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getDefaultMessage() {
        return defaultMessage;
    }
}
