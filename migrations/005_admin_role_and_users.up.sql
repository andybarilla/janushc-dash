-- Add admin role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('physician', 'staff', 'admin'));

-- Ensure tenant exists
INSERT INTO tenants (name, athena_practice_id)
VALUES ('Janus Healthcare', '195900')
ON CONFLICT (name) DO NOTHING;

-- Create users
INSERT INTO users (tenant_id, email, password_hash, role, name)
VALUES
  ((SELECT id FROM tenants WHERE name = 'Janus Healthcare'), 'courtney@janushc.com', '', 'physician', 'Courtney Barilla'),
  ((SELECT id FROM tenants WHERE name = 'Janus Healthcare'), 'andy@janushc.com', '', 'admin', 'Andy Barilla')
ON CONFLICT (tenant_id, email) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name;
