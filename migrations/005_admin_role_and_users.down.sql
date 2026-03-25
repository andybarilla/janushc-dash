DELETE FROM users WHERE email IN ('courtney@janushc.com', 'andy@janushc.com');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('physician', 'staff'));
