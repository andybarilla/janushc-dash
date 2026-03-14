-- name: GetTenantByID :one
SELECT id, name, athena_practice_id, created_at, updated_at
FROM tenants
WHERE id = $1;

-- name: CreateTenant :one
INSERT INTO tenants (name, athena_practice_id)
VALUES ($1, $2)
RETURNING id, name, athena_practice_id, created_at, updated_at;

-- name: GetTenantByName :one
SELECT id, name, athena_practice_id, created_at, updated_at
FROM tenants
WHERE name = $1;
