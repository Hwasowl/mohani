package com.mohani.domain.team.exception;

import com.mohani.global.error.BusinessException;
import com.mohani.global.error.ErrorCode;

public class NotATeamMemberException extends BusinessException {

    public NotATeamMemberException() {
        super(ErrorCode.NOT_A_MEMBER);
    }
}
