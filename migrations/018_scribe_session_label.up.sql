-- migrations/018_scribe_session_label.up.sql
ALTER TABLE scribe_sessions ADD COLUMN label TEXT NOT NULL DEFAULT '';
