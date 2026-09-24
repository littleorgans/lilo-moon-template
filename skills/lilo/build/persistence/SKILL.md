---
name: persistence
description: Store data with @littleorgans/db under forced row level security, deciding what the project owns versus the identity provider, adding a table with its hand-written policy migration, querying only inside withPrincipal, provisioning identity rows, choosing login roles and poolers, and staying portable across Postgres hosts. Use when adding or changing a table, policy, migration or query, connecting a new process to the database, or evaluating a Postgres host such as Supabase.
---

# Persist data

Tenancy here is enforced by Postgres, not by query code. Every query runs inside
`withPrincipal`, which switches to the `authenticated` role and sets the verified claims for one
transaction, and forced row level security decides which rows exist. The work is keeping that true
as tables are added. Every path here is in `littleorgans/lilo-moon-template`. Read them at the tag
that matches the installed `@littleorgans/*` version.

- `docs/user-entity.md`: who owns which record, the identity tables, and why neither generated
  artifact shows the security.
- `packages/db/README.md`: `withPrincipal`, database setup, roles, least privilege and Supabase.
- `packages/db-tools/README.md`: the commands behind the database tasks.
- `docs/guides/adopt-web-app.md`, "Set up the database": the steps to add a table in a generated
  project. This skill does not repeat them.

Where the query code goes is [web-app](../web-app/SKILL.md) or [service](../service/SKILL.md). The
`Principal` comes from [auth](../auth/SKILL.md).

## Before adding a table

- **Does the provider own it?** WorkOS owns users, email, organizations, membership and roles.
  Stripe owns billing. Store the provider's key, not a copy. There is no memberships table and no
  email column on purpose: a copy goes stale and becomes a second answer. A cache is allowed only
  with a stated freshness and reconciliation.
- **Whose rows are they?** Key a tenant's rows by organization and a person's by user, compared
  with `app.current_org_id()` or `app.current_user_id()` from the identity migration. A row that
  belongs to nobody has no place behind these policies.
- **Keep `accounts` and `profiles`.** They are the user entity, not examples. `profiles` gains
  columns as the product needs them.

## Adding one

The desired state goes in `db/schema.sql`; `atlas-diff` writes the table migration from it. Atlas
silently drops functions, row level security, policies, roles and grants, so those go in a
hand-written migration beside it, modeled on
`packages/db/migrations/20260822081700_identity.sql`:

- `ENABLE` and `FORCE ROW LEVEL SECURITY`. Without `FORCE` the table owner reads every tenant.
- A policy per operation you allow, and a `GRANT` of exactly those to `authenticated`. No policy
  means denied, which is the right default for `DELETE` until a product needs it.
- Reuse the `app` helpers. They wrap the claim in `nullif`, because a transaction-local setting
  reverts to an empty string, not to unset, and a bare cast then fails the next request on that
  connection.

Then rehash, seed a row for the table so the claim checks are not vacuous, and regenerate the
Drizzle schema. Never hand-edit the generated schema, and never trust it for policies: it drops the
`USING` expression. A released migration never changes; fix forward with a new one.

## Query through withPrincipal only

- No tenant `WHERE` clause. The policies are the boundary; a hand-written filter is a second one
  that can disagree.
- Take tenant keys for a write from the claims, not the request: `services/api` inserts
  `app.current_org_id()`.
- Typed Drizzle over the project's schema, with raw `sql` only for what the builder cannot
  express. Type query code as `PgDatabase<PgQueryResultHKT, typeof schema>` so tests run the real
  queries over `drizzle-orm/pg-proxy` (`apps/web/tests/database.ts`).
- Identity rows are created just in time from the verified `Principal`, idempotently, by a named
  write where a person lands: `ensureIdentityRows` in `apps/web/src/server/identity.ts`. A service
  has no landing page, so its caller creates the account explicitly (`PUT /v1/account`).

## Roles and connections

- Every deployed process logs in as its own role holding the shipped grant, never as the migration
  owner, a superuser or a `BYPASSRLS` role: each of those skips the policies. One role per process
  lets you revoke one without the others.
- The grant has no `INHERIT`, so a query outside `withPrincipal` fails with permission denied.
  Leave it that way.
- A transaction-mode pooler is fine: the role and claims are transaction-local, and `pg` prepares
  only named statements. Do not call Drizzle's `.prepare()` against a pooler port
  (`packages/db/src/database.ts`).
- Run `rls-verify` against a deployed database over a direct connection; a pooler may reject its
  read-only startup options.

## Hosts

The portable boundary is the Postgres wire protocol, so changing host is a connection string.
Supabase is one host. Its Storage, Realtime, Edge Functions, Data API and client SDKs are not
portable, and its Data API does not carry the WorkOS `Principal` these policies read. If a project
adopts one, contain it in one module. The shipped grant needs Postgres 16 or later; the db README's
"Supabase compatibility" section lists what to check on a Supabase project.

## Gates

- `rls-verify` (`db-tools`) fails a `public` table without forced row level security, an
  `authenticated` role that can bypass it, rows visible without claims, and claims that outlive
  their transaction.
- `atlas-lint` rejects destructive and unsafe migrations. `drizzle-check` fails a stale schema.
- In CI these run whenever `db/schema.sql` exists. Locally they skip without Docker and say so.

No gate proves a new policy compares the right column. `rls-verify` proves a table fails closed,
not that tenant A cannot see tenant B. For each new policy, add a scoping assertion with the
`@littleorgans/db-tools` API, as `scripts/rls-verify.mjs` does here for `accounts` and `profiles`,
and prove it fails by weakening the policy.
