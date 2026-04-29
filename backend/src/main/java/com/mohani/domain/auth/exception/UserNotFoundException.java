package com.mohani.domain.auth.exception;

import com.mohani.global.error.BusinessException;
import com.mohani.global.error.ErrorCode;

public class UserNotFoundException extends BusinessException {

    public UserNotFoundException(long userId) {
        super(ErrorCode.USER_NOT_FOUND, "user not found: " + userId);
    }
}
