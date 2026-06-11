-- migrations/019_scribe_document_filename.up.sql
-- Document uploads are scribe sessions whose transcript comes from OCR instead of
-- audio transcription. document_filename records the original uploaded file (and
-- marks the session as document-sourced); empty for audio/paste sessions.
ALTER TABLE scribe_sessions ADD COLUMN document_filename TEXT NOT NULL DEFAULT '';
