-- migrations/019_ocr_documents.down.sql
ALTER TABLE scribe_sessions DROP COLUMN IF EXISTS document_id;
DROP TABLE IF EXISTS ocr_documents;
