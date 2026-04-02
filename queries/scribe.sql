-- name: CreateScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, department_id, status)
VALUES ($1, $2, $3, $4, $5, 'processing')
RETURNING id, tenant_id, user_id, patient_id, encounter_id, department_id, status,
          transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at;

-- name: GetScribeSession :one
SELECT id, tenant_id, user_id, patient_id, encounter_id, department_id, status,
       transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at
FROM scribe_sessions
WHERE id = $1 AND tenant_id = $2;

-- name: ListScribeSessions :many
SELECT id, tenant_id, user_id, patient_id, encounter_id, department_id, status,
       error_message, started_at, stopped_at, completed_at, created_at
FROM scribe_sessions
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT 50;

-- name: UpdateScribeSessionProcessing :exec
UPDATE scribe_sessions
SET status = 'processing', transcript = $3
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateScribeSessionComplete :exec
UPDATE scribe_sessions
SET status = 'complete', ai_output = $3, completed_at = now()
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateScribeSessionError :exec
UPDATE scribe_sessions
SET status = 'error', error_message = $3
WHERE id = $1 AND tenant_id = $2;
