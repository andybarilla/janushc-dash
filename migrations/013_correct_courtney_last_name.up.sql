-- Correct Courtney's display name for existing databases.
UPDATE users u
SET name = 'Courtney Crance'
FROM tenants t
WHERE u.tenant_id = t.id
  AND t.name = 'Janus Healthcare'
  AND u.email = 'courtney@janushc.com';
