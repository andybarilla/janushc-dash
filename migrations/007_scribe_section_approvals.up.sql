CREATE TABLE scribe_section_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('hpi','plan','exam','labs')),
    action TEXT NOT NULL CHECK (action IN ('approved','revoked')),
    user_id UUID NOT NULL REFERENCES users(id),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scribe_section_approvals_lookup
    ON scribe_section_approvals (session_id, section, at DESC);
