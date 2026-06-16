-- Make Courtney Crance the default/owning provider for existing Janus scribe sessions.
-- This is intentionally a data migration: prior imported/demo sessions may have
-- been owned by placeholder users such as doctor@janushc.com.
INSERT INTO tenants (name, athena_practice_id)
VALUES ('Janus Healthcare', '195900')
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (tenant_id, email, password_hash, role, name)
VALUES (
  (SELECT id FROM tenants WHERE name = 'Janus Healthcare'),
  'courtney@janushc.com',
  '',
  'physician',
  'Courtney Crance'
)
ON CONFLICT (tenant_id, email) DO UPDATE
SET role = EXCLUDED.role,
    name = EXCLUDED.name;

UPDATE scribe_sessions
SET user_id = (
  SELECT u.id
  FROM tenants t
  JOIN users u ON u.tenant_id = t.id AND u.email = 'courtney@janushc.com'
  WHERE t.name = 'Janus Healthcare'
)
WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'Janus Healthcare')
  AND user_id <> (
    SELECT u.id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'courtney@janushc.com'
    WHERE t.name = 'Janus Healthcare'
  );
