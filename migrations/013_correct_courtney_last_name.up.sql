-- Correct Courtney's display name for existing databases.
UPDATE users
SET name = 'Courtney Crance'
WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'Janus Healthcare')
  AND email = 'courtney@janushc.com';
