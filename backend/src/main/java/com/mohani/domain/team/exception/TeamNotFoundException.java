package com.mohani.domain.team.exception;

import com.mohani.global.error.BusinessException;
import com.mohani.global.error.ErrorCode;

public class TeamNotFoundException extends BusinessException {

    public TeamNotFoundException(String teamCodeOrId) {
        super(ErrorCode.TEAM_NOT_FOUND, "team not found: " + teamCodeOrId);
    }
}
