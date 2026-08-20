# Why this baseline is shaped this way

Read this before swapping a tool because it feels heavy. Several gates exist because a green run
lied. The working rules that follow from these choices are [AGENTS.md](../AGENTS.md).

Anything filed and unbuilt is named with its issue number. Do not infer that a decision here has
code on main. A candidate in this record is not a commitment.

## Moon owns the graph

Turborepo reads npm and pnpm workspaces. It does not read `Cargo.toml` or `pyproject.toml`. This
baseline is language agnostic, so the task graph has to see those members when they appear.

Moon does. `projects.globs` in `.moon/workspace.yml` lists `apps/*`, `packages/*`, and `services/*`
with no language filter. The JavaScript toolchain is on. The Rust and Python toolchains are
commented in `.moon/toolchains.yml` and wait for a real member. pnpm remains the JavaScript package
manager. Moon is the workspace.

`justfile` holds aliases only. Task commands, inputs, outputs, and deps live in moon. Two command
paths drift. CI runs `moon ci`.

## One linter, one formatter

oxlint and oxfmt are the gates. The Oxc editor extension is the same engine, so format on save
matches `moon run root:format`. `.vscode/extensions.json` lists Prettier, Biome, and ESLint as
unwanted.

Biome is a JavaScript toolchain. Prettier is a second formatter with a second config language.
oxfmt already covers the files this repo contains: JavaScript, TypeScript, JSON, YAML, TOML,
Markdown, HTML, CSS, GraphQL. Three tools collapse into one. Do not add the other two.

oxlint runs with `--type-aware`. Rules in `.oxlintrc.json` are `error` or absent. Warnings
accumulate.

## TypeScript 7 and the tsgolint lockstep

The catalog pin is `typescript: "~7.0.2"`. TypeScript 7 ships `tsgo` and does not ship
`lib/tsserver.js`. The editor settings that follow from that, and the `oxlint-tsgolint` version
encoding that ties the two pins together, are in
[Follow JavaScript and TypeScript rules](../AGENTS.md#follow-javascript-and-typescript-rules).
Two pins, one type system. If they diverge, lint and `tsc` disagree.

Renovate groups `typescript` and `oxlint-tsgolint` in `renovate.json` so a routine update lands in
one PR. Grouping does not fail the build when a person edits one pin, or when a partial merge
lands. `tasks.tsgolint-lockstep` in `.moon/tasks/tsgolint-lockstep.yml` runs
`scripts/assert-tsgolint-lockstep.mjs` on every JavaScript project and fails the graph. That is why
the lockstep is a gate.

Moon and proto versions in `.prototools` are not yet a Renovate manager. That gap is #29.

## What a green gate actually proves

`--type-aware` does nothing unless `oxlint-tsgolint` is installed. oxlint does not error on the
missing package. It skips the type aware rules. `--no-error-on-unmatched-pattern` is required so a
repository with no matching files can still exist. Together those two facts produced a lint gate
that reported green across three commits while type aware linting was not running at all, because
the package was absent and the selection was empty. `74f3b00` installed the package. The lockstep
gate came later, to keep the package honest against the catalog.

A gate that passes on an empty repository has proven nothing. The procedure in
[Prove every gate](../AGENTS.md#prove-every-gate) exists for that reason. PR #18 is the CI example:
a deliberate oxfmt violation failed, the revert passed.

The same hole appears in tests. Two independently written tests named a behaviour, reported full
coverage, and asserted nothing about that behaviour. Coverage counts lines executed. That count
does not prove the named behaviour exists. Thresholds in `vitest.config.ts` are statements 80,
branches 75, functions 80, and lines 80, per project and per file. They fail untested files. They
do not prove a named assertion. A test is proven when a wrong implementation fails it. That
procedure is [Write tests](../AGENTS.md#write-tests).

## Identity and entitlements

Identity is undecided and under active discussion. #16, #17, and #23 are labelled
`blocked:pending-decision`. Do not cite this record as a vendor commitment.

WorkOS AuthKit was the leading candidate. It ships users, organizations, roles, permissions, and
Stripe entitlements as claims on the session JWT. The product then does not build an entitlements
service, a sync webhook, or a billing database to approximate those claims. That is the reasoning
that put WorkOS first. Clerk and Supabase Auth also issue asymmetric JWTs. They differ on tenant,
role, and permissions claims. Which claim model to buy is the open question.

Whichever vendor wins, verification uses that vendor's JWKS URL and a stock JWT library. No vendor
SDK on the verification path. The mapped `Principal` is `userId`, `orgId`, `roles`, `permissions`,
and `entitlements`. A vendor `role` claim that means organization membership must not become
`SET ROLE` in Postgres.

WorkOS publishes JWKS at `api.workos.com/sso/jwks/<clientId>`. supabase/auth#2476 has been open
since 2026-04-08. Supabase third party auth looks up `{issuer}/.well-known/jwks.json`. Hosted
PostgREST returns `PGRST301 JWSInvalidSignature` for WorkOS tokens. That is a WorkOS fact.

## Schema, queries, and the host

Postgres is deferred until the product has data. A template without a database is incomplete only
if you think a schema can be invented before the product. It cannot. Atlas, Drizzle, and the host
boundary are decisions for when that data exists. None of them are in the tree. #21, #22, #23, #24.

Atlas is the migration engine. Native SQL is the schema source of truth, so every language is a
first class consumer. `atlas migrate lint` is the reason to accept Atlas over dbmate,
golang-migrate, or sqlx migrate. Those others will run SQL. They will not catch a destructive
migration before it ships.

Drizzle is the TypeScript query layer. Atlas owns the schema. `drizzle-kit pull` is
introspection. On stable kit, `pull` then `generate` emits DROP and ADD pairs on an unchanged
database. drizzle-team/drizzle-orm#6093 documents CHECK constraints rewritten with casts, numeric
defaults pulled as strings, partitioned parents dropped, and index opclasses lost. RLS policies,
generated columns, and partial indexes are not a claimed pull surface. Pull output is generated
after Atlas apply. It is never a source, and it is never fed back into a migration.

Supabase is a Postgres host. The portable boundary is the Postgres wire protocol. A swap to another
host is a connection string. Storage, Realtime, Edge Functions, and PostgREST are Supabase
products. If they are adopted they live in a contained module.

If the identity vendor is WorkOS, do not send that JWT to PostgREST. supabase/auth#2476 is the
open bug named above. RLS still holds on a direct Postgres connection for any vendor: verify the
JWT in process with that vendor's JWKS, then `set local role authenticated` and `set_config` for
`request.jwt.claims` and `request.jwt.claim.sub` so `auth.uid()` and `auth.jwt()` work.
Re-evaluate PostgREST for WorkOS tokens when that issue closes.

The official Python client talks to the Data API. There is no official Rust Supabase SDK.
`supabase-lib-rs` is a community crate last published 2025-10-16. Rust talks to Postgres through
sqlx. Python SQL talks through psycopg.

## JavaScript library exports

Publishable libraries export `dist` under `types`, `import`, and `default`. The workspace private
condition `@lilo-moon/source` points at `src` for Vite `serve` only. Applications add that
condition in `vite.config.ts` when `command === "serve"`. They do not add it to the production
build.

Node's standard conditions, including `development` and `production`, must not select source. A
consumer who installs the package, or a moon task that runs against `dist`, would otherwise execute
TypeScript the runtime cannot load.

Rename the condition with the rest of the scope when you instantiate. Keep the split.

## Left to the consuming repo

Settled here: moon, oxlint, oxfmt, TypeScript 7, the lockstep gate, pnpm catalogs, the member
layout, the generator shapes that exist, Atlas for SQL, Drizzle as generated output, Supabase as a
host.

Not settled here: which identity vendor, which application framework you keep, whether you publish,
to which registry, which license, which package scope, when the first Rust or Python member lands,
and every product decision above the baseline.

Changesets (#6) and git hooks (#7) will constrain how you release and how you commit. They do not
change the graph.
