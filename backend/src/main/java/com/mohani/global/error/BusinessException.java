package com.mohani.global.error;

public class BusinessException extends RuntimeException {

    private final ErrorCode code;

    public BusinessException(ErrorCode code) {
        super(code.getDefaultMessage());
        this.code = code;
    }

    public BusinessException(ErrorCode code, String detailMessage) {
        super(detailMessage);
        this.code = code;
    }

    public ErrorCode getCode() {
        return code;
    }
}
