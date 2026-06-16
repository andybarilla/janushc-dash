-- migrations/017_scribe_appointment_id.up.sql
ALTER TABLE scribe_sessions ADD COLUMN appointment_id TEXT NOT NULL DEFAULT '';
