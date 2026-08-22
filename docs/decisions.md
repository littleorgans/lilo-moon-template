# Why this baseline is shaped this way

Read this before swapping a tool because it feels heavy. Several gates exist because a green run
lied. The working rules that follow from these choices are [AGENTS.md](../AGENTS.md).

Anything filed and unbuilt is named with its issue number. Do not infer that a decision here has
code on main. A candidate in this record is not a commitment.

## Moon owns the graph

Turborepo reads npm and pnpm workspaces. It does not read `Cargo.toml` or `pyproject.toml`. This
baseline is language agnostic, so the task graph has to see those members when they appear.

Moon does. `projects.globs` in `.moon/workspace.yml` lists `apps/*`, `packages/*`, and `services/*`
with no language filter. The JavaScript toolchain is on. The Rust toolchain is on.
`services/ping` is the Rust member. The Python toolchain stays commented in `.moon/toolchains.yml`
until a real Python member lands. pnpm remains the JavaScript package manager. Moon is the
workspace. A clone that keeps only ping still installs the root JavaScript tools, because oxlint,
oxfmt, secretlint, and audit live in `devDependencies` in the root `package.json`.

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

Renovate's regex manager in `renovate.json` reads moon and proto pins in `.prototools`. The
built-in proto manager is disabled so that file is extracted once.

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
if you think a schema can be invented before the product. It cannot. Atlas and Drizzle are in the
tree. The identity boundary in #23 is still undecided.

Atlas is the migration engine. Native SQL is the schema source of truth, so every language is a
first class consumer. `atlas migrate lint` is the reason to accept Atlas over dbmate,
golang-migrate, or sqlx migrate. Those others will run SQL. They will not catch a destructive
migration before it ships.

The database lives under `db/`: `db/schema.sql`, `db/migrations/`, and `db/drizzle/_generated/`.
The three moved off the repository root together because a desired-state SQL file at root reads as
debris next to `package.json` and `moon.yml`, and because splitting the trio would separate an
input from the artifacts derived from it.

`db/schema.sql` cannot live inside `db/migrations/`. Atlas owns that directory, checksums it in
`atlas.sum`, and treats every `.sql` file in it as a versioned migration. Adding the desired state
there fails `atlas migrate validate` with a checksum mismatch. Re-hashing to clear that error is
worse: `atlas migrate apply` then plans the desired state as a second migration and creates the
same table twice. Desired state stays outside `--dir`.

`moon.yml` `tasks.atlas-diff` and `tasks.atlas-lint` need Docker only when `db/schema.sql` exists.
Both tasks are inert without a schema. If Docker is unavailable, local Atlas lint prints its skip and
lets `just check` continue. CI runs Atlas lint whenever a schema exists. `tasks.atlas-apply` uses
`DATABASE_URL` and does not start a Docker development database.

Drizzle is the TypeScript query layer. Atlas owns the schema. `drizzle-kit pull` is introspection.
On stable kit, `pull` then `generate` emits DROP and ADD pairs on an unchanged database.
drizzle-team/drizzle-orm#6093 documents CHECK constraints rewritten with casts, numeric defaults
pulled as strings, partitioned parents dropped, and index opclasses lost. RLS policies, generated
columns, and partial indexes are not a claimed pull surface. `moon.yml`
`tasks.drizzle-generate` writes `db/drizzle/_generated/schema.ts` after applying Atlas migrations.
`tasks.drizzle-check` compares that artifact with a fresh database. The artifact is never a source,
and it is never fed back into a migration.

Atlas Community does not model everything a schema needs. Functions, `ENABLE ROW LEVEL SECURITY`,
policies, roles and grants are dropped from a diff silently, and the command exits 0. Written into
`db/schema.sql` they produce a migration containing only the tables. `drizzle-kit pull` then
misreports the same objects in the other direction: it drops the `USING` expression from SELECT
policies, so a policy that scopes rows renders in the artifact as though it scopes nothing.

Everything Atlas cannot model therefore lives in a hand-written migration under `db/migrations/`,
which Atlas leaves alone: with the dev URL pinned to `search_path=public`, the `app` schema and the
policies appear on neither side of a re-diff, so no drift is planned and `atlas migrate lint` passes.

Because both generated artifacts misrepresent the security model without failing, neither can be
reviewed for it. `moon.yml` `tasks.rls-verify` applies the migrations to a real Postgres and asserts
behaviour instead: tenant scoping, fail-closed on absent claims, rejection of cross-tenant inserts,
that claims do not outlive their transaction, and that every table in `public` has row level security
enabled and forced. That last assertion is the one that catches a future table added without a
policy. This is the third instance of the pattern in this record, after `--type-aware` and coverage:
a gate that reports green while proving nothing.

Which capabilities stay portable across hosts is
[Supabase as a Postgres host](supabase-boundary.md). The record model and the workflows above it are
[The user entity](user-entity.md).

## JavaScript library exports

Publishable libraries export `dist` under `types`, `import`, and `default`. The workspace private
condition `@lilo-moon/source` points at `src` for Vite `serve` only. Applications add that
condition in `vite.config.ts` when `command === "serve"`. They do not add it to the production
build.

Node's standard conditions, including `development` and `production`, must not select source. A
consumer who installs the package, or a moon task that runs against `dist`, would otherwise execute
TypeScript the runtime cannot load.

Rename the condition with the rest of the scope when you instantiate. Keep the split.

## Changelogs cover JavaScript packages

Changesets reads `package.json`, so private and publishable JavaScript packages both receive
versions and changelogs. It cannot see `Cargo.toml`, `pyproject.toml`, or `go.mod`. `services/ping`
sets `publish = false`, so the current Rust member has nothing to release.

Moon does not version or publish packages. Its FAQ points JavaScript workspaces to Yarn releases,
Changesets, or Lerna. This leaves non-JavaScript release notes outside the baseline. Revisit the
release tool when the first consumer repository ships a real non-JavaScript artifact.

## Publishing relies on the protected merge boundary

Strict branch protection keeps publishing behind the merge boundary. Required `CI` checks use strict
branch protection on `main`, so every non-bypass merge has already passed lint, typecheck, and tests.
The owner retains deliberate admin and force-push bypasses.

`withastro/astro`, `changesets/changesets`, and `chakra-ui/chakra-ui` use the same build-only publish
shape without a test-job `needs` edge. This repository leaves `NPM_PUBLISH_ENABLED` unset, so
Changesets receives no publish command and cannot publish the exemplar. Adding workflow sequencing
now would add ceremony to a dormant path without strengthening the protected merge boundary.

Versioning and publishing are separate steps, and only the second is gated by
`NPM_PUBLISH_ENABLED`. The first changeset this repository produced opened a Version Packages PR that
bumps a version and writes a changelog and reaches no registry at all. Observed 2026-08-22: that PR
came from `github-actions[bot]`, its `CI` run returned `action_required`, and it could not merge
until a maintainer approved the workflow. `release.yml` now prefers `secrets.RELEASE_TOKEN` and falls
back to `GITHUB_TOKEN`, which moves the authorship off the bot and removes the approval when the
secret is set. Consumer-facing detail is in
[Start a project from this template](how-to-instantiate.md).

## Left to the consuming repo

Settled here: moon, oxlint, oxfmt, TypeScript 7, the lockstep gate, pnpm catalogs, the member
layout, the generator shapes that exist, Atlas for SQL, Drizzle as generated output, Supabase
as a host, and the `accounts` and `profiles` baseline with its row level security.

Not settled here: which identity vendor, which application framework you keep, whether you publish,
to which registry, which license, which package scope, when the first Rust or Python member lands,
and every product decision above the baseline.

Changesets write GitHub changelogs from `changelog.repo` in `.changeset/config.json`. `lefthook.yml`
is the hook file. They constrain how you release and how you commit. They do not change the graph.
