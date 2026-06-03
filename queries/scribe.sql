-- name: CreateScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
RETURNING id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status,
          transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at;

-- name: GetScribeSession :one
SELECT id, tenant_id, user_id, patient_id, encounter_id, department_id, status,
       transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at,
       sent_to_ehr_at, sent_to_ehr_by, rejected_at, rejected_by, appointment_id, label
FROM scribe_sessions
WHERE id = $1 AND tenant_id = $2;

-- name: DeleteScribeSession :execrows
DELETE FROM scribe_sessions
WHERE id = $1 AND tenant_id = $2;

-- name: MarkScribeSessionRejected :execrows
UPDATE scribe_sessions
SET rejected_at = now(), rejected_by = $3
WHERE id = $1 AND tenant_id = $2
  AND rejected_at IS NULL
  AND sent_to_ehr_at IS NULL;

-- name: MarkScribeSessionSent :execrows
UPDATE scribe_sessions
SET sent_to_ehr_at = now(), sent_to_ehr_by = $3
WHERE id = $1 AND tenant_id = $2 AND sent_to_ehr_at IS NULL;

-- name: ListScribeSessions :many
WITH latest_per_section AS (
    SELECT DISTINCT ON (session_id, section)
        session_id, section, action
    FROM scribe_section_approvals
    ORDER BY session_id, section, at DESC
),
approved_counts AS (
    SELECT session_id, COUNT(*)::int AS approved_count
    FROM latest_per_section
    WHERE action = 'approved'
    GROUP BY session_id
)
SELECT
    s.id, s.tenant_id, s.user_id, s.patient_id, s.encounter_id, s.appointment_id, s.department_id, s.label,
    s.status, s.error_message, s.started_at, s.stopped_at, s.completed_at, s.created_at,
    s.sent_to_ehr_at, s.rejected_at,
    COALESCE(ac.approved_count, 0)::int AS approved_count
FROM scribe_sessions s
LEFT JOIN approved_counts ac ON ac.session_id = s.id
WHERE s.tenant_id = $1
ORDER BY s.created_at DESC
LIMIT 50;

-- name: UpdateScribeSessionProcessing :exec
UPDATE scribe_sessions
SET status = 'processing', transcript = $3
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateScribeSessionRecording :exec
UPDATE scribe_sessions
SET status = 'recording'
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateScribeSessionComplete :exec
UPDATE scribe_sessions
SET status = 'complete', ai_output = $3, completed_at = now()
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateScribeSessionError :exec
UPDATE scribe_sessions
SET status = 'error', error_message = $3
WHERE id = $1 AND tenant_id = $2;

-- name: SetScribeSessionEncounter :exec
UPDATE scribe_sessions
SET encounter_id = $3
WHERE id = $1 AND tenant_id = $2;
