-- name: CreateScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'processing')
RETURNING id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status,
          created_at;

-- name: GetScribeSession :one
SELECT id, tenant_id, user_id, patient_id, encounter_id, department_id, status,
       transcript, COALESCE(ai_output, '') AS ai_output, error_message, started_at, stopped_at, completed_at, created_at,
       sent_to_ehr_at, sent_to_ehr_by, rejected_at, rejected_by, appointment_id, label, document_filename
FROM scribe_sessions
WHERE id = ?1 AND tenant_id = ?2;

-- name: DeleteScribeSession :execrows
DELETE FROM scribe_sessions
WHERE id = ?1 AND tenant_id = ?2;

-- name: MarkScribeSessionRejected :execrows
UPDATE scribe_sessions
SET rejected_at = CURRENT_TIMESTAMP, rejected_by = ?3
WHERE id = ?1 AND tenant_id = ?2
  AND rejected_at IS NULL
  AND sent_to_ehr_at IS NULL;

-- name: MarkScribeSessionSent :execrows
UPDATE scribe_sessions
SET sent_to_ehr_at = CURRENT_TIMESTAMP, sent_to_ehr_by = ?3
WHERE id = ?1 AND tenant_id = ?2 AND sent_to_ehr_at IS NULL;

-- name: ListScribeSessions :many
WITH latest_per_section AS (
    SELECT session_id, section, action
    FROM (
        SELECT
            session_id, section, action,
            row_number() OVER (PARTITION BY session_id, section ORDER BY at DESC) AS rn
        FROM scribe_section_approvals
    )
    WHERE rn = 1
),
approved_counts AS (
    SELECT session_id, CAST(COUNT(*) AS integer) AS approved_count
    FROM latest_per_section
    WHERE action = 'approved'
    GROUP BY session_id
)
SELECT
    s.id, s.tenant_id, s.user_id, s.patient_id, s.encounter_id, s.appointment_id, s.department_id, s.label,
    s.status, s.error_message, s.started_at, s.stopped_at, s.completed_at, s.created_at,
    s.sent_to_ehr_at, s.rejected_at,
    CAST(COALESCE(ac.approved_count, 0) AS integer) AS approved_count
FROM scribe_sessions s
LEFT JOIN approved_counts ac ON ac.session_id = s.id
WHERE s.tenant_id = ?1
ORDER BY s.created_at DESC
LIMIT 50;

-- name: UpdateScribeSessionProcessing :exec
UPDATE scribe_sessions
SET status = 'processing', transcript = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: UpdateScribeSessionRecording :exec
UPDATE scribe_sessions
SET status = 'recording'
WHERE id = ?1 AND tenant_id = ?2;

-- name: UpdateScribeSessionComplete :exec
UPDATE scribe_sessions
SET status = 'complete', ai_output = ?3, completed_at = CURRENT_TIMESTAMP
WHERE id = ?1 AND tenant_id = ?2;

-- name: UpdateScribeSessionError :exec
UPDATE scribe_sessions
SET status = 'error', error_message = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: SetScribeSessionEncounter :exec
UPDATE scribe_sessions
SET encounter_id = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: SetScribeSessionDocumentFilename :exec
UPDATE scribe_sessions
SET document_filename = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: UpdateScribeSessionPatientID :exec
UPDATE scribe_sessions
SET patient_id = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: UpdateScribeSessionCreatedAt :exec
UPDATE scribe_sessions
SET created_at = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: ListImportedScribeSessionBackfillCandidates :many
SELECT id, tenant_id, patient_id, encounter_id, transcript, created_at
FROM scribe_sessions
WHERE tenant_id = ?1
  AND encounter_id LIKE ?2
ORDER BY created_at ASC;
