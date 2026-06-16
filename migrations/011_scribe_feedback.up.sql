CREATE TABLE scribe_feedback (
    id UUID PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('overall','hpi','plan','exam','labs')),
    category TEXT NOT NULL CHECK (category IN (
        'missed_info','incorrect','hallucination','formatting','good','comment'
    )),
    body TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scribe_feedback_session ON scribe_feedback (session_id, at);
