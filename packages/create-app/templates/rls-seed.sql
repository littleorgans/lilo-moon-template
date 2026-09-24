-- One row per table, so rls-verify's claim checks have rows to hide. Runs as the server login,
-- which bypasses row level security, in a scratch database rls-verify drops afterwards. Add a row
-- here for every table you add.
INSERT INTO accounts (workos_org_id) VALUES ('org_seed');
INSERT INTO profiles (workos_user_id) VALUES ('user_seed');
