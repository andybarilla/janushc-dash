-- name: ListPendingApprovalItems :many
SELECT id, batch_id, tenant_id, emr_order_id, patient_id, patient_name,
       procedure_name, dosage, staff_name, order_date, flagged, flag_reasons,
       status, reviewed_at, reviewed_by, created_at,
       encounter_id, department_id, order_type
FROM approval_items
WHERE tenant_id = $1 AND status IN ('pending', 'needs_review')
ORDER BY flagged DESC, order_date ASC;

-- name: UpsertApprovalItem :exec
INSERT INTO approval_items (tenant_id, emr_order_id, patient_id, patient_name, procedure_name, dosage, staff_name, order_date, flagged, flag_reasons, status, encounter_id, department_id, order_type)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (tenant_id, emr_order_id) DO UPDATE SET
  patient_name = EXCLUDED.patient_name,
  dosage = EXCLUDED.dosage,
  staff_name = EXCLUDED.staff_name,
  flagged = EXCLUDED.flagged,
  flag_reasons = EXCLUDED.flag_reasons,
  status = EXCLUDED.status,
  encounter_id = EXCLUDED.encounter_id,
  department_id = EXCLUDED.department_id,
  order_type = EXCLUDED.order_type;

-- name: CreateApprovalBatch :one
INSERT INTO approval_batches (tenant_id, approved_by, order_count, flagged_count)
VALUES ($1, $2, $3, $4)
RETURNING id, tenant_id, approved_by, approved_at, order_count, flagged_count;

-- name: BatchApproveItems :exec
UPDATE approval_items
SET status = 'approved', batch_id = $1, reviewed_at = now(), reviewed_by = $2
WHERE tenant_id = $3 AND id = ANY($4::uuid[]) AND status IN ('pending', 'needs_review');

-- name: CountFlaggedInBatch :one
SELECT COUNT(*) FROM approval_items
WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND flagged = true;

-- name: ListProtocols :many
SELECT id, tenant_id, name, procedure_name, standard_dosage, max_lab_age_days,
       requires_established_patient, active, created_at, updated_at
FROM protocols
WHERE tenant_id = $1 AND active = true;

-- name: CreateProtocol :one
INSERT INTO protocols (tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient, active, created_at, updated_at;
