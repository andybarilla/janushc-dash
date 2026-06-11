-- migrations/019_scribe_document_filename.down.sql
ALTER TABLE scribe_sessions DROP COLUMN IF EXISTS document_filename;
