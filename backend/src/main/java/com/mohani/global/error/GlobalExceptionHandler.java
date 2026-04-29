package com.mohani.global.error;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiError> handleBusiness(BusinessException ex) {
        String traceId = newTraceId();
        log.warn("[{}] {} - {}", traceId, ex.getCode(), ex.getMessage());
        return ResponseEntity.status(ex.getCode().getStatus())
            .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        String traceId = newTraceId();
        String detail = ex.getBindingResult().getFieldErrors().stream()
            .map(f -> f.getField() + ": " + f.getDefaultMessage())
            .findFirst()
            .orElse(ErrorCode.INVALID_INPUT.getDefaultMessage());
        log.warn("[{}] validation failed - {}", traceId, detail);
        return ResponseEntity.status(ErrorCode.INVALID_INPUT.getStatus())
            .body(ApiError.of(ErrorCode.INVALID_INPUT, detail, traceId));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleIllegalArgument(IllegalArgumentException ex) {
        String traceId = newTraceId();
        log.warn("[{}] illegal argument - {}", traceId, ex.getMessage());
        return ResponseEntity.status(ErrorCode.INVALID_INPUT.getStatus())
            .body(ApiError.of(ErrorCode.INVALID_INPUT, ex.getMessage(), traceId));
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiError> handleAuthentication(AuthenticationException ex) {
        String traceId = newTraceId();
        log.warn("[{}] unauthenticated - {}", traceId, ex.getMessage());
        return ResponseEntity.status(ErrorCode.UNAUTHORIZED.getStatus())
            .body(ApiError.of(ErrorCode.UNAUTHORIZED, ErrorCode.UNAUTHORIZED.getDefaultMessage(), traceId));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException ex) {
        String traceId = newTraceId();
        log.warn("[{}] forbidden - {}", traceId, ex.getMessage());
        return ResponseEntity.status(ErrorCode.FORBIDDEN.getStatus())
            .body(ApiError.of(ErrorCode.FORBIDDEN, ErrorCode.FORBIDDEN.getDefaultMessage(), traceId));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        String traceId = newTraceId();
        log.error("[{}] unhandled exception", traceId, ex);
        return ResponseEntity.status(ErrorCode.INTERNAL.getStatus())
            .body(ApiError.of(ErrorCode.INTERNAL, ErrorCode.INTERNAL.getDefaultMessage(), traceId));
    }

    private static String newTraceId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }
}
