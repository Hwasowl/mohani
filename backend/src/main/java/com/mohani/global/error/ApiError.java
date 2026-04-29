package com.mohani.global.error;

public record ApiError(String code, String message, String traceId) {

    public static ApiError of(ErrorCode code, String message, String traceId) {
        return new ApiError(code.name(), message, traceId);
    }
}
