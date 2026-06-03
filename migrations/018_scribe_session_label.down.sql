-- migrations/018_scribe_session_label.down.sql
ALTER TABLE scribe_sessions DROP COLUMN label;
