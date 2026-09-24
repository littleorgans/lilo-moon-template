# Why this baseline is shaped this way

Read this before swapping a tool because it feels heavy. Several gates exist because a green run
lied. The working rules that follow from these choices are [AGENTS.md](../AGENTS.md).

Anything filed and unbuilt is named with its issue number. Do not infer that a decision here has
code on main. A candidate in this record is not a commitment.

## Moon owns the graph

Turborepo reads npm and pnpm workspaces. It does not read `Cargo.toml` or `pyproject.toml`. This
baseline is language agnostic, so the task graph has to see those members when they appear.

Moon does. `projects.globs` in `.moon/workspace.yml` lists `apps/*`, `packages/*`, and `services/*`
with no language filter. The JavaScript toolchain is on. The Rust toolchain returns with a real Rust
member, and the Python toolchain stays commented in `.moon/toolchains.yml` until a real Python
member lands. pnpm remains the JavaScript package manager. Moon is the workspace.

`justfile` holds aliases only. Task commands, inputs, outputs, and deps live in moon. Two command
paths drift. CI runs `moon ci`.

## Application ownership and growth

The working tree demonstrates the layout described in [Code layout](code-layout.md). Related routes
use directories, and the `(auth)` group preserves the public callback and session URLs. Standalone
routes remain files. Grouping carries no implicit authentication policy.

Routes declare framework wiring. `features/workspace/` owns its page, data contract, provisioning
queries and loader behavior. `server/auth.ts` and
`server/database.ts` compose shared services; `server/theme.ts` adapts app-wide theme cookies;
`server/product.ts` holds the product-facing copy, so a product renames itself in one file.
The workspace's account/profile diagnostics belong to the app. The shared views package accepts
application labels and paths and does not own the app's data model.

Tests mirror feature ownership, with route rendering and package/process composition under
`tests/integration/`. Shared coverage configuration has no application-specific exclusions. Real
consumer builds verify the Start server boundary, and integration tests verify route-to-feature wiring.

Vite/Nitro tasks require the `web-app` tag. An untagged JavaScript application can provide another
runtime without inheriting web commands. The application owns its development and preview ports.
Library builds clear their declared output before compiling, so deleted source does not remain
published from a previous build. Formatting inputs cover the files and configuration oxfmt reads.

The repository is a reference implementation and the source of published packages, not a
template. Projects depend on the packages rather than copying this tree, so fixes reach them
through upgrades; [the direction](direction.md) records why. `root:published-shape` exercises a
snapshot of this workspace and packed package consumption in disposable workspaces.

## One linter, one formatter

oxlint and oxfmt are the gates. The Oxc editor extension is the same engine, so format on save
matches `moon run root:format`. `.vscode/extensions.json` lists Prettier, Biome, and ESLint as
unwanted.

Biome is a JavaScript toolchain. Prettier is a second formatter with a second config language.
oxfmt already covers the files this repo contains: JavaScript, TypeScript, JSON, YAML, TOML,
Markdown, HTML, CSS, GraphQL. Three tools collapse into one. Do not add the other two.

oxlint runs with `--type-aware`. Rules in `packages/oxlint-config/oxlintrc.json` are `error` or absent. Warnings
accumulate.

## TypeScript 7 and the tsgolint lockstep

The catalog pin is `typescript: "~7.0.2"`. TypeScript 7 ships `tsgo` and does not ship
`lib/tsserver.js`. The editor settings that follow from that, and the `oxlint-tsgolint` version
encoding that ties the two pins together, are in
[Follow JavaScript and TypeScript rules](../AGENTS.md#follow-javascript-and-typescript-rules).
Two pins, one type system. If they diverge, lint and `tsc` disagree.

Renovate groups `typescript` and `oxlint-tsgolint` in `renovate/base.json` so a routine update lands in
one PR. Grouping does not fail the build when a person edits one pin, or when a partial merge
lands. `root:tsgolint-lockstep` in `moon.yml` runs
`scripts/assert-tsgolint-lockstep.mjs` once for the workspace and fails the graph. That is why
the lockstep is a gate.

Renovate's regex manager in `renovate/base.json` reads moon and proto pins in `.prototools`. The
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
does not prove the named behaviour exists. Thresholds in `testDefaults` (`packages/vite-config/src/vitest.ts`) are statements 80,
branches 75, functions 80, and lines 80, per project and per file. They fail untested files. They
do not prove a named assertion. A test is proven when a wrong implementation fails it. That
procedure is [Write tests](../AGENTS.md#write-tests).

The third form of the hole is a documented procedure nobody runs. `.env.example` told the reader to
copy it to `.env.local` and start the dev server. Nothing loaded that file. Vite reads `.env` files
only to populate `import.meta.env` for prefixed names, never writes `process.env`, and looks beside
`vite.config.ts` rather than at the workspace root, and no task set `envFile`. The instruction was
false from the commit that introduced it and stayed false across six merged pull requests while
47 tasks reported green. It could not be otherwise: `dev` and `preview` are `runInCI: false`, so
the only thing that executes them is a person. `envFile` in `.moon/tasks/node-application.yml` is
the fix, chosen over loading dotenv inside the application so the rule that no code reads the
filesystem for secrets still holds. moon puts them in the environment and the application reads the
environment.

Prose that instructs is a claim like any other. Either something executes it or it is unverified.

## Identity and entitlements

**Decided: WorkOS.** `packages/auth` and `packages/db` are on main, and the schema keys on WorkOS
identifiers. The record model and the signup, payment and auth workflows are
[The user entity](user-entity.md). #16, #17 and #23 predate that decision and are still open.

What the environment actually issues, measured rather than read from documentation: a user with no
organization gets `iss`, `sub`, `sid`, `jti`, `auth_time`, `client_id`, `iat` and `exp` and nothing
else. Adding an organization adds `org_id`, `role` as a string, `roles` as an array, and
`permissions`. `entitlements` appears only once Stripe Connect is configured. Both `role` and
`roles` are emitted, which is why `toPrincipal` reads the plural and falls back to the singular.
`sub` is a reserved claim that a JWT template cannot override.

WorkOS has no setting that creates an organization for a new user, so the application does it. A
first social sign-in therefore yields a token with no `org_id`, and that is a normal state rather
than an error. The reference application selects the personal organization policy, which creates the organization inside the callback, with no
naming screen, because the org-of-one is the common case and its name is invisible until somebody
is invited. It attaches no domains to that organization: a verified domain captures every address
carrying it, and domain-based SSO routing runs before password auth, which a probe against a seeded
organization demonstrated by getting routed to SAML. Creation is keyed on the WorkOS user id so a
retried callback cannot mint a second organization. [The auth screens](auth-screens.md) holds the
full screen inventory and the failure mapping that goes with it.

**Social OAuth credentials belong to a WorkOS environment, not to an application.** There is one
Google credential per environment per provider, and every AuthKit application in that environment
shares it; the `state` parameter carries each application's own redirect URI. Two products sharing a
user pool therefore cannot hold separate Google clients, and that is a consequence of the shared
pool rather than a limitation to work around. Staging and production are separate environments with
separate credentials and separate redirect URIs. Verified 2026-08-24 by following the authorize URL
to Google's sign-in page.

Two details cost time to learn. The redirect URI is environment specific, of the form
`https://auth.workos.com/sso/oauth/google/<id>/callback`, and the generic path that a search
suggests will answer a request without being correct for any particular environment. Authorized
JavaScript origins are left empty, because they exist for browser-side flows and WorkOS exchanges
the code server to server; the Google console makes the field look mandatory by rendering one blank
row and then validating it.

WorkOS AuthKit ships users, organizations, roles, permissions, and
Stripe entitlements as claims on the session JWT. The product then does not build an entitlements
service, a sync webhook, or a billing database to approximate those claims. That is the reasoning
that put WorkOS first. Clerk and Supabase Auth also issue asymmetric JWTs and differ on tenant,
role and permissions claims, which is what the seam in #23 exists to absorb. They were not chosen.

Whichever vendor wins, verification uses that vendor's JWKS URL and a stock JWT library. No vendor
SDK on the verification path. The mapped `Principal` is `userId`, `orgId`, `roles`, `permissions`,
and `entitlements`. A vendor `role` claim that means organization membership must not become
`SET ROLE` in Postgres.

WorkOS publishes JWKS at `api.workos.com/sso/jwks/<clientId>`. supabase/auth#2476 has been open
since 2026-04-08. Supabase third party auth looks up `{issuer}/.well-known/jwks.json`. Hosted
PostgREST returns `PGRST301 JWSInvalidSignature` for WorkOS tokens. That is a WorkOS fact.

## Schema, queries, and the host

Product tables are deferred until the product has data. A baseline without a database is incomplete
only if you think a schema can be invented before the product. It cannot. What is not deferred is
the identity baseline: `accounts` and `profiles` are on main with row level security forced, because
those two tables follow from the identity decision rather than from any product.

Atlas is the migration engine. Native SQL is the schema source of truth, so every language is a
first class consumer. `atlas migrate lint` is the reason to accept Atlas over dbmate,
golang-migrate, or sqlx migrate. Those others will run SQL. They will not catch a destructive
migration before it ships.

The database lives under `db/`: `db/schema.sql`, `db/migrations/`, and `db/drizzle/_generated/`.
The three moved off the repository root together because a desired-state SQL file at root reads as
debris next to `package.json` and `moon.yml`, and because splitting the trio would separate an
input from the artifacts derived from it.

The migrations later moved to `packages/db/migrations/`, when `@littleorgans/db` began shipping
them. The package and every repository gate read that one directory, so what is verified is what
ships. `db/` keeps the desired state and the Drizzle artifact.

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

Queries import the artifact. `db/drizzle/` is a private workspace package,
`@littleorgans/drizzle-schema`, that builds `_generated/schema.ts` to `dist` like any library, so
the web app bundles it and the service's `pnpm deploy` image carries it. A relative import from the
applications into `db/` was rejected: the service compiles with `rootDir: src`, and its deployed
image holds only its own `dist` and its dependencies. Generating into `packages/` was rejected
because the schema belongs to the project, beside the SQL it comes from. `@littleorgans/db` takes
the schema as the `schema` option of `createDatabase` and types each scoped transaction by it; it
never imports one.

Query code accepts any Postgres Drizzle database over the schema
(`PgDatabase<PgQueryResultHKT, typeof schema>`), not only the `node-postgres` one production
passes. Tests build a real one over `drizzle-orm/pg-proxy`, whose driver is a plain function that
records each statement and answers it, so they run the queries production runs without a cast. A
hand-written stand-in for the query builder would describe the stand-in instead. Answers follow the
driver's shape: a statement with a select list or `RETURNING` gets rows as arrays of values in
select order. Running through Drizzle also showed that Drizzle wraps every driver error in a
`DrizzleQueryError`, with the driver's error as its `cause`, so `services/api` reads the SQLSTATE
from the cause.

Atlas Community does not model everything a schema needs. Functions, `ENABLE ROW LEVEL SECURITY`,
policies, roles and grants are dropped from a diff silently, and the command exits 0. Written into
`db/schema.sql` they produce a migration containing only the tables. `drizzle-kit pull` then
misreports the same objects in the other direction: it drops the `USING` expression from SELECT
policies, so a policy that scopes rows renders in the artifact as though it scopes nothing.

Everything Atlas cannot model therefore lives in a hand-written migration in the migrations
directory, which Atlas leaves alone: with the dev URL pinned to `search_path=public`, the `app`
schema and the policies appear on neither side of a re-diff, so no drift is planned and
`atlas migrate lint` passes.

Because both generated artifacts misrepresent the security model without failing, neither can be
reviewed for it. `moon.yml` `tasks.rls-verify` applies the migrations to a real Postgres and asserts
behaviour instead: tenant scoping, fail-closed on absent claims, rejection of cross-tenant inserts,
that claims do not outlive their transaction, and that every table in `public` has row level
security enabled and forced. That last assertion is the one that catches a future table added
without a policy. The assertions that hold for any schema later moved into `@littleorgans/db-tools`,
whose `rls-verify` command runs them against a consumer's own database; the task calls the package.
This is the third instance of the pattern in this record, after `--type-aware` and coverage: a gate
that reports green while proving nothing.

Which capabilities stay portable across hosts is
[Supabase as a Postgres host](supabase-boundary.md). The record model and the workflows above it are
[The user entity](user-entity.md).

## JavaScript library exports

Publishable libraries export `dist` under `types`, `import`, and `default`. The workspace private
condition `@littleorgans/source` points at `src` for Vite `serve` only. Applications add that
condition in `vite.config.ts` when `command === "serve"`. They do not add it to the production
build.

The condition stays in the workspace. Each library's `publishConfig.exports` repeats `exports`
without it, because an application that installs the packages and runs `vite dev` through
`@littleorgans/vite-config` would otherwise resolve them to `src` inside `node_modules`.
`root:published-shape` rejects any tarball whose `exports` use a condition other than `types`,
`import` and `default`, or differ from the workspace `exports` in anything but that condition.
The exception is `vite-config`, whose entries Vite and Vitest load before anything is built: the
check requires each explicit `src/<name>.ts` to `dist/<name>.js` and `dist/<name>.d.ts` redirect
(`index` for the root entry). Other packages follow the equality rule.

Node's standard conditions, including `development` and `production`, must not select source. A
consumer who installs the package, or a moon task that runs against `dist`, would otherwise execute
TypeScript the runtime cannot load.

Keep the split.

## Changelogs cover JavaScript packages

Changesets reads `package.json`, so it versions JavaScript packages and writes their changelogs.
Only the published packages receive them: `privatePackages.version` is `false`, so the reference app
and service stay unversioned, and a changeset names published packages only. It cannot see `Cargo.toml`, `pyproject.toml`, or `go.mod`. Every member
today is a JavaScript package, so nothing is left out yet.

Moon does not version or publish packages. Its FAQ points JavaScript workspaces to Yarn releases,
Changesets, or Lerna. This leaves non-JavaScript release notes outside the baseline. Revisit the
release tool when the first consumer repository ships a real non-JavaScript artifact.

## Publishing waits for the whole gate on the released commit

Branch protection used to be the only gate: required `CI` checks on `main`, and a publish path that
only built. That was enough while nothing was published. Consumers outside this repository now
install the packages, a bad version reaches all of them, and a published version cannot be
replaced. CI on a push to `main` also runs only the affected tasks, and the owner keeps admin and
force-push bypasses. So `release.yml` gates the publish itself (decision D9).

The Release gate job runs `moon ci --force` on the commit it will publish: every task `moon ci`
runs, with no affected filter and no cache. The publish job `needs` it, so a failed task skips the
publish. The gate runs in the release workflow rather than waiting on the CI run for the same SHA,
because that run is affected-only on `main` and a `workflow_run` or checks-API wait would add a
second workflow to reason about for no stronger guarantee. The cost is a full run on each release
commit, which happens once per release.

**The published bytes are the checked bytes.** `changeset publish` packs again after the scan, so
what `root:packed-secrets` inspected was a copy. `scripts/release.mjs pack` now packs each package
once and records its sha512 in `release.json`. The secrets scan and `root:published-shape` run on
those files, and the publish uploads them with `npm publish <file>.tgz`, which runs no lifecycle
scripts. Every step after the pack refuses a file whose hash differs from the record.
`root:release-rehearsal` proves this against a local Verdaccio: the registry's `dist.integrity`,
and the tarball it serves, equal the scanned file's hash.

**Authentication moves to OIDC without a workflow edit.** npm tries trusted publishing first and
falls back to `NODE_AUTH_TOKEN`. The organization token bootstraps packages that do not exist yet,
since npm attaches a trusted publisher only to an existing package. Once every package trusts
`release.yml`, the token and its secret are deleted, and no long-lived publish credential remains.
Only the publish job can mint an OIDC token or read the npm token. It installs no workspace
dependencies, and its pinned npm install runs no lifecycle scripts.

Versioning and publishing stay separate steps. While changesets are pending, the workflow only
opens or updates the Version Packages PR. The publish jobs run on the commit that merges it, and
only when `vars.NPM_PUBLISH_ENABLED == 'true'`. The first changeset this repository produced
opened a Version Packages PR from `github-actions[bot]`: observed 2026-08-22, its `CI` run returned
`action_required`, and it could not merge until a maintainer approved the workflow. `release.yml`
prefers `secrets.LILO_GITHUB_PAT` and falls back to `GITHUB_TOKEN`, which moves the authorship off
the bot and removes the approval when the secret is set. [Releasing the packages](releasing.md) is
the maintainer procedure.

## Configuration is shared as packages, a preset and a called workflow

A project installs its compiler options, lint rules and test defaults as `@littleorgans/tsconfig`,
`@littleorgans/oxlint-config` and `@littleorgans/vite-config/vitest`, so a fix reaches it with the
next package upgrade instead of a diff it copies by hand. This repository consumes the same packages
through the same root files a project writes. `root:published-shape` installs the packed tarballs
into a copy of the workspace, and its typecheck, tests and lint read their settings from there.

oxlint 1.79 resolves every `extends` entry as a path relative to the config file and rejects a
package name, so `.oxlintrc.json` extends `./node_modules/@littleorgans/oxlint-config/oxlintrc.json`.
Rules, options, plugins, categories and overrides come through `extends`; `ignorePatterns` does
not, so each workspace keeps its own. Copying the file into each project was the fallback, and
nothing forced it.

The config packages are not project dependencies, so Moon would not rerun a typecheck, a build or a
test when one of them changes. The `typescript-options` and `vitest-config` file groups in
`.moon/tasks/node.yml` name those files and their packages' export manifests as task inputs instead.
Changing an export changes which file the compiler or test runner loads, so the manifest must
invalidate cached results too.

Projects call `.github/workflows/moon-ci.yml` at an exact release tag, `@v<version>`, which
Renovate pins to its commit digest and moves together with the packages (the `littleorgans` group in
`renovate/base.json`). A floating `@v0` tag was rejected. The release would have to move a tag, and
a released tag never moves here. A moving reference to code that runs in a project's CI is also the
wrong default, and every 0.x minor can break. The workflow declares no secrets and asks for
`contents: read`. It clones in full, not blob-filtered, so the checkout keeps no token on disk for
later fetches. The audit, secrets and tsgolint lockstep checks stay `moon ci` tasks and are not extra
workflow steps: `moon ci` already runs them, and as steps they would run twice and resolve this
repository's scripts against the caller's install.

A called workflow's job reports as `<caller job> / <called job>`, so `ci.yml` adds a job named `CI`
that keeps the name branch protection requires. It runs `if: always()` and fails unless `moon ci`
succeeded, because GitHub counts a skipped required check as passing.

## Left to the consuming repo

Settled here: moon, oxlint, oxfmt, TypeScript 7, the lockstep gate, pnpm catalogs, the member
layout, Atlas for SQL, Drizzle as generated output, Supabase
as a host, the `accounts` and `profiles` baseline with its row level security, and WorkOS as the
identity vendor.

Swapping the identity vendor is a supported move rather than an unmade decision, and #23 is the
seam that makes it one: rewrite `packages/auth-workos`, keep `packages/auth`. The schema keys on
`workos_org_id` and `workos_user_id`, so a swap renames two columns.

Not settled here: which application framework you keep, whether you publish, to which registry,
which license, which package scope, when the first Rust or Python member lands, what a free tier
allows, and every product decision above the baseline.

Changesets write GitHub changelogs from `changelog.repo` in `.changeset/config.json`. `lefthook.yml`
is the hook file. They constrain how you release and how you commit. They do not change the graph.

## Corrections for reuse

Applications choose `organizationPolicy` explicitly. The `existing` policy leaves membership alone;
`personal` retains the personal workspace preset. Session packages remain WorkOS specific.

`Database.withPrincipal` only establishes transaction local role and claims. Application code creates
its identity rows inside that transaction. Using the database wrapper does not require those tables.

The Vite helper receives the consuming workspace root and reads manifest names. UI and views packages
register their own CSS sources. Applications register their feature sources and may style product
components. A shared component is justified by shared behavior, not by a restriction on styling.

JWT verification requires expiration. Provider unavailability preserves sessions, including a refresh
token that rotated before JWKS retrieval failed. WorkOS rotates the refresh token on every exchange
and honours a 30-second replay grace period; the earlier note that the same token came back was
wrong and is withdrawn. A token within 20 seconds of expiry is refreshed early, and a failed early
refresh serves the token that still verified rather than ending anything.
Logout goes through a same-origin POST and then the WorkOS logout URL. Authorization changes take
effect with a renewed access token.

## Skills are written here, under the `lilo` owner

Decision D4 in [the direction](direction.md#decisions-approved-2026-09-23) puts skills in this
repository, with reviewed copies synced to the agent-runtimes catalog later. The owner segment is
`lilo`, chosen when the first skill landed. Skills live at `skills/lilo/<domain>/<skill>/SKILL.md`,
so `skills/lilo/build/start-project/SKILL.md` has the catalog ID `lilo/build/start-project`. A skill
teaches judgment and points at the guides and the reference code. It does not repeat their steps.
Anything checkable belongs in a gate. The catalog sync, and the check that every path a skill cites
exists at its tag, are phase 2 work.
