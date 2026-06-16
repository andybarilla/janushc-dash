CREATE TABLE scribe_section_edits (
    id UUID PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('hpi','plan','exam','labs')),
    content JSONB NOT NULL,
    edited_by UUID NOT NULL REFERENCES users(id),
    at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scribe_section_edits_lookup
    ON scribe_section_edits (session_id, section, at DESC);
