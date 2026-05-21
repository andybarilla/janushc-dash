-- Correct Courtney's email address for existing databases.
UPDATE users u
SET email = 'drcrance@janushc.com'
FROM tenants t
WHERE u.tenant_id = t.id
  AND t.name = 'Janus Healthcare'
  AND u.email = 'courtney@janushc.com';
