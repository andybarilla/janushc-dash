CREATE TABLE scribe_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('overall','hpi','plan','exam','labs')),
    category TEXT NOT NULL CHECK (category IN (
        'missed_info','incorrect','hallucination','formatting','good','comment'
    )),
    body TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scribe_feedback_session ON scribe_feedback (session_id, at);
