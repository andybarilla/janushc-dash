UPDATE users u
SET email = 'courtney@janushc.com'
FROM tenants t
WHERE u.tenant_id = t.id
  AND t.name = 'Janus Healthcare'
  AND u.email = 'drcrance@janushc.com';
