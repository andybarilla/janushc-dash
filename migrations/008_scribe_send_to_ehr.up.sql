ALTER TABLE scribe_sessions ADD COLUMN sent_to_ehr_at TIMESTAMPTZ;
ALTER TABLE scribe_sessions ADD COLUMN sent_to_ehr_by UUID REFERENCES users(id);
