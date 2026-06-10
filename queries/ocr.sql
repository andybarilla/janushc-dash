-- name: CreateOCRDocument :one
INSERT INTO ocr_documents (tenant_id, user_id, original_filename, content_type, status)
VALUES ($1, $2, $3, $4, 'uploaded')
RETURNING id, tenant_id, user_id, original_filename, content_type, status,
          error_message, extracted_text, scribe_session_id, created_at, extracted_at;

-- name: GetOCRDocument :one
SELECT id, tenant_id, user_id, original_filename, content_type, status,
       error_message, extracted_text, scribe_session_id, created_at, extracted_at
FROM ocr_documents
WHERE id = $1 AND tenant_id = $2;

-- name: ListOCRDocuments :many
SELECT id, tenant_id, user_id, original_filename, content_type, status,
       error_message, extracted_text, scribe_session_id, created_at, extracted_at
FROM ocr_documents
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT 50;

-- name: UpdateOCRDocumentExtracting :exec
UPDATE ocr_documents
SET status = 'extracting'
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateOCRDocumentExtracted :exec
UPDATE ocr_documents
SET status = 'extracted', extracted_text = $3, extracted_at = now()
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateOCRDocumentError :exec
UPDATE ocr_documents
SET status = 'error', error_message = $3
WHERE id = $1 AND tenant_id = $2;

-- name: SetOCRDocumentScribeSession :exec
UPDATE ocr_documents
SET scribe_session_id = $3
WHERE id = $1 AND tenant_id = $2;

-- name: DeleteOCRDocument :execrows
DELETE FROM ocr_documents
WHERE id = $1 AND tenant_id = $2;

-- name: CreateDocumentScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, transcript, status, document_id)
VALUES ($1, $2, $3, '', $4, $5, $6, 'processing', $7)
RETURNING id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status,
          transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at;
