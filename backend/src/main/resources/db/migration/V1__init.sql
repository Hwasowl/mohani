CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(64) UNIQUE,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(64) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
    id BIGSERIAL PRIMARY KEY,
    team_code CHAR(6) UNIQUE NOT NULL,
    name VARCHAR(64) NOT NULL,
    owner_id BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    cli_kind VARCHAR(16) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    total_tokens INT NOT NULL DEFAULT 0,
    duration_sec INT NOT NULL DEFAULT 0,
    prompt_count INT NOT NULL DEFAULT 0,
    was_private BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_sessions_user_started ON sessions(user_id, started_at DESC);

CREATE TABLE activity_log (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    team_id BIGINT REFERENCES teams(id),
    occurred_at TIMESTAMPTZ NOT NULL,
    prompt_first_line VARCHAR(200),
    event_kind VARCHAR(24) NOT NULL
);
CREATE INDEX idx_activity_team_time ON activity_log(team_id, occurred_at DESC);
