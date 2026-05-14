CREATE TABLE scribe_section_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('hpi','plan','exam','labs')),
    content JSONB NOT NULL,
    edited_by UUID NOT NULL REFERENCES users(id),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scribe_section_edits_lookup
    ON scribe_section_edits (session_id, section, at DESC);
