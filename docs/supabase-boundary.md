# Supabase as a Postgres host

The portable boundary is the Postgres wire protocol. Supabase is one host. A swap to Neon
or Railway is a connection string.

The working contract is [AGENTS.md](../AGENTS.md). Why the host, schema, and identity
choices look this way is [Why this baseline is shaped this way](decisions.md). This page
does not repeat those records.

Nothing listed here is on main. Atlas is #21. Drizzle is #22. The auth adapter seam is
#23.

## Portable

These survive a host swap. None of the language clients are in this repository yet.

- Postgres wire protocol and a connection string
- Native SQL schema, migrated with Atlas once #21 lands
- Rust talks to Postgres through sqlx 0.9.0 with a committed `.sqlx` directory and
  `SQLX_OFFLINE=true`
- Python talks to Postgres through psycopg

## Not portable

Storage, Realtime, Edge Functions, PostgREST, and any Supabase client SDK. If adopted
they live in an explicit contained module, never as an ambient workspace dependency.

The official Python client talks to the Data API.

## No official Rust SDK

Verified 2026-08-20. `supabase-lib-rs` 0.5.3, last published 2025-10-16, 7,914 lifetime
downloads, community repo `nizovtsevnv/supabase-lib-rs`. Supabase did not publish it. Its
README advertises 0.5.4, which was never published. Access from every language is
Postgres.

## Identity is undecided

#16, #17, and #23 are labelled `blocked:pending-decision`. Do not cite this page as a
vendor commitment. The claim model is
[Identity and entitlements](decisions.md#identity-and-entitlements).

If the identity vendor is WorkOS, hosted PostgREST returns
`PGRST301 JWSInvalidSignature` for those tokens. supabase/auth#2476 has been open
since 2026-04-08. WorkOS publishes JWKS at `api.workos.com/sso/jwks/<clientId>`.
Supabase third party auth looks up `{issuer}/.well-known/jwks.json`. That is a WorkOS
fact.

One option is deferred with #23. That option verifies the JWT in process against the
chosen vendor's JWKS. It then runs `set local role authenticated` and `set_config` for
`request.jwt.claims` and `request.jwt.claim.sub` so `auth.uid()` and `auth.jwt()` work
on a direct Postgres connection. Re-evaluate PostgREST for WorkOS tokens if WorkOS is
chosen and supabase/auth#2476 closes.
