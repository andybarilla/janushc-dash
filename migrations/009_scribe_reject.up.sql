ALTER TABLE scribe_sessions
    ADD COLUMN rejected_at TIMESTAMPTZ,
    ADD COLUMN rejected_by UUID REFERENCES users(id);
