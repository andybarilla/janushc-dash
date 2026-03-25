-- name: GetUserByEmail :one
SELECT id, tenant_id, email, password_hash, role, name, created_at, updated_at
FROM users
WHERE tenant_id = $1 AND email = $2;

-- name: GetUserByID :one
SELECT id, tenant_id, email, password_hash, role, name, created_at, updated_at
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (tenant_id, email, password_hash, role, name)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, tenant_id, email, password_hash, role, name, created_at, updated_at;

-- name: GetUserByEmailOnly :one
SELECT id, tenant_id, email, password_hash, role, name, created_at, updated_at
FROM users
WHERE email = $1;
