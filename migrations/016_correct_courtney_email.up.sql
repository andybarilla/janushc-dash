-- Correct Courtney's email address for existing databases.
UPDATE users
SET email = 'drcrance@janushc.com'
WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'Janus Healthcare')
  AND email = 'courtney@janushc.com';
