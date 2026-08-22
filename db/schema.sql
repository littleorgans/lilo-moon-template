-- Atlas desired state, and the applicability boundary for every Atlas and Drizzle task in
-- moon.yml. While this file is absent those tasks skip before Atlas or Docker starts.
--
-- Never move this file into db/migrations/. Atlas checksums that directory in atlas.sum and
-- treats every .sql file in it as a versioned migration.
--
-- THIS FILE IS NOT THE WHOLE SCHEMA. Atlas Community does not model functions, row level
-- security, policies, roles, or grants: it drops them from a diff silently and exits 0. Those
-- live in a hand-written migration under db/migrations/ instead. See docs/user-entity.md.
--
-- accounts and profiles are the baseline user entity, not exemplars. Identity itself belongs to
-- the auth vendor and is never copied here. A column that can go stale against the vendor does
-- not belong in this file.

-- The tenant. One row per vendor organization, created just in time on first authenticated
-- request. Every product table hangs off this key.
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_org_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-user application state. Deliberately not a foreign key onto accounts: one person may hold
-- membership in several accounts, so a profile outlives any single one of them.
CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
