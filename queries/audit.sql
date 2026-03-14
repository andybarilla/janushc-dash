-- name: CreateAuditEntry :exec
INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, details)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ListAuditEntries :many
SELECT id, tenant_id, user_id, action, resource_type, resource_id, details, created_at
FROM audit_log
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT $2;
