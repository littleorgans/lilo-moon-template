-- Hand-written. Atlas Community models none of what follows: it drops functions, row level
-- security, policies, roles and grants from a diff silently and exits 0. Verified against Atlas
-- v1.3.0. Regenerate the checksum with `atlas migrate hash --dir file://db/migrations` after
-- editing, and never expect `atlas migrate diff` to reproduce this file.
--
-- Atlas leaves it alone on re-diff: with the dev URL pinned to search_path=public, neither the
-- app schema nor the policies appear on either side of the comparison, so no drift is planned.

-- The role every request runs as. Named to match the role Supabase already provisions, so this
-- migration applies unchanged on both a bare Postgres and a Supabase project.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;

-- Claims are read from a transaction-local GUC set by packages/db, never from a vendor helper.
-- auth.uid() is unusable here: it casts the subject to uuid and WorkOS subjects are text.
-- search_path is pinned because these functions decide row visibility.
--
-- nullif is load-bearing. At COMMIT a transaction-local GUC reverts to empty string, not to
-- unset, so a bare cast raises 22P02 on the next request to borrow the connection. Without it
-- these functions throw where they must return NULL, and a fail-closed policy fails open loudly
-- instead of quietly. root:rls-verify covers exactly this.
CREATE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;

CREATE FUNCTION app.current_org_id() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'org_id' $$;

-- FORCE is required, not decorative. Without it the table owner bypasses every policy below,
-- which means a migration-owner connection silently reads all tenants.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

-- Absent claims yield NULL, which matches no row. Every policy fails closed.
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (workos_org_id = app.current_org_id());

CREATE POLICY accounts_insert ON accounts FOR INSERT
  WITH CHECK (workos_org_id = app.current_org_id());

CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (workos_user_id = app.current_user_id());

CREATE POLICY profiles_insert ON profiles FOR INSERT
  WITH CHECK (workos_user_id = app.current_user_id());

CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (workos_user_id = app.current_user_id())
  WITH CHECK (workos_user_id = app.current_user_id());

-- No DELETE policy on either table. Deletion is denied until a product need defines it.
GRANT USAGE ON SCHEMA public, app TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_org_id() TO authenticated;
GRANT SELECT, INSERT ON accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;
