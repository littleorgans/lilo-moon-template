# Direction: reference implementation, published packages, skills

A proposal, written 2026-09-23 against `main` at `a95bab6`. It turns this repository from a
template (copy the source, rename it, update by rebase) into three things:

- a **reference implementation** of a TypeScript frontend and service;
- **published npm packages** that projects add as dependencies;
- **skills** that teach how frontends and services are built here.

It builds on [the assessment](assessment.md) and [the system overview](system-overview.md).

Evidence markers: **[V]** means verified by running something (see
[Evidence](#evidence)). **[I]** means inferred from reading code or documentation.

Settled inputs:

- Phase 1 is TypeScript only. Rust crates and PyPI packages move to a later phase.
- TypeScript backend services are in scope for phase 1, alongside frontends, auth and persistence.
- Packages are public on the public npm registry. The repository is already public
  (`gh repo view` reports `PUBLIC`) [V].
- No downstream projects exist, so nothing needs migrating and template-only machinery can be
  deleted.
- `HELIOY_PAT` is an org-level token. It is not a personal credential and not a blocker.
- Decisions D1–D10 were approved on 2026-09-23 (see [Decisions](#decisions-approved-2026-09-23)).
  Two items remain open: creating the npm org and confirming WorkOS refresh-token reuse behavior.

## a) Where each part goes

Destinations:

- **Pkg**: a published npm package.
- **Shared**: a reusable GitHub workflow or shared configuration.
- **Skill**: taught by a skill (names refer to [d](#d-skills)).
- **Scaffold**: generated once into a new project, then owned by it (see [e](#e-scaffolding)).
- **Ref**: stays in this repository as reference-only code.
- **Delete**.

### Packages, apps and services

| Path                      | Destination           | Notes                                                                                                                                                                                           |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/auth`           | Pkg (phase 1)         | Framework-free. Works in a plain Node service [V].                                                                                                                                              |
| `packages/auth-workos`    | Pkg (phase 1)         | Needed by `auth-session`. Also usable directly by services that provision organizations.                                                                                                        |
| `packages/auth-session`   | Pkg (phase 1)         | B3 and U3 fixes land here before the first publish. Add a server-side accessor for the current access token so a web app can call a service (see [Services](#services-in-phase-1)).             |
| `packages/auth-tanstack`  | Pkg (phase 1)         | Bound the peer range (`>=1.168` becomes `^1.168.0`).                                                                                                                                            |
| `packages/db`             | Pkg (phase 1)         | Make `drizzle-orm` and `pg` peer dependencies (skew breaks consumers [V]). Ship the identity migrations as package files.                                                                       |
| `packages/theme`          | Pkg (phase 1)         | Unchanged.                                                                                                                                                                                      |
| `packages/ui`             | Pkg (phase 1)         | Move `tailwindcss` to a peer dependency [I]. React peers become `^19`.                                                                                                                          |
| `packages/views`          | Pkg (phase 1)         | React peers become `^19`.                                                                                                                                                                       |
| `packages/vite-config`    | Pkg (phase 1)         | The `publishConfig` export redirect already produces a `dist` export [V]. The peer becomes `vite: ^8`. Later it can also export the shared Vitest configuration.                                |
| `packages/collections`    | Delete                | An example with one caller, the task board. Real packages now demonstrate library shape.                                                                                                        |
| new `packages/auth-http`  | Pkg (phase 1)         | Service seam: a Fetch-standard `Request` → `Principal` bearer authenticator with `AuthError` → 401/503 mapping, plus a small Hono adapter.                                                      |
| new `packages/db-tools`   | Pkg (phase 1 minimal) | CLI. Phase 1: `rls-verify` (generic: every `public` table has RLS enabled and forced, and absent claims return nothing). Phase 2: Atlas and Drizzle wrappers and the Postgres container helper. |
| new `packages/create-app` | Pkg (phase 2)         | `pnpm create @littleorgans/app` scaffolder (see [e](#e-scaffolding)).                                                                                                                           |
| new config packages       | Shared (phase 2)      | `@littleorgans/tsconfig` (from `tsconfig.options.json`), `@littleorgans/oxlint-config` (from `.oxlintrc.json`, if oxlint package `extends` works [I]), and Vitest defaults in `vite-config`.    |
| `apps/web`                | Ref                   | The reference frontend. Scaffold sources come from here. Delete the task board, the Principal dump and the demo title (B10). Keep `/theme` as a documented reference page.                      |
| `services/ping`           | Delete                | The Rust example. Rust returns in phase 3 with a real service.                                                                                                                                  |
| new `services/api`        | Ref (phase 1)         | A reference TypeScript service using `auth-http` and `db`. It is the scaffold source for services.                                                                                              |

### Scripts

| Path                                                                                                                                                               | Destination                           | Notes                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/projects.mjs`, `scripts/lib/create-project.mjs`, `scripts/lib/project-registry.mjs`, `scripts/lib/project-files.mjs`, `scripts/rename-template.sh`        | Delete                                | Template creation, registry and rename. `project-files.mjs` `projectEnvironment` survives only if the published-shape check needs it. |
| `scripts/tests/integration/projects.test.mjs`, `project-environment.test.mjs`                                                                                      | Delete                                | Tests for deleted machinery.                                                                                                          |
| `scripts/consumer-check.mjs`                                                                                                                                       | Ref, rewritten                        | Becomes `root:published-shape` (see [b](#consumer-check-changes)). The generated-project half is deleted.                             |
| `scripts/rls-verify.mjs`                                                                                                                                           | Pkg `db-tools` (generic) + Ref        | The generic assertions move to `db-tools`. The accounts and profiles assertions stay as this repo's test of its own migrations.       |
| `scripts/lib/postgres-container.mjs`, `scripts/atlas-dev.mjs`, `scripts/drizzle-schema.mjs`, `scripts/clean.mjs`                                                   | Pkg `db-tools` (phase 2)              | Until then, Scaffold copies them for projects with a database.                                                                        |
| `scripts/check-security.mjs`                                                                                                                                       | Shared (phase 2) / Scaffold (phase 1) | The audit-ignore policy and secretlint runner. A bin in a repo-tools package, or a step in the reusable CI workflow.                  |
| `scripts/assert-tsgolint-lockstep.mjs`                                                                                                                             | Scaffold (phase 1) / Shared (phase 2) | Needed by any project that pins TypeScript 7 and `oxlint-tsgolint`.                                                                   |
| `scripts/prune-references.mjs`, `scripts/lib/typescript-references.mjs`                                                                                            | Ref                                   | Monorepo maintenance for this repo. It could join a repo-tools bin later.                                                             |
| `scripts/tests/integration/moon-tasks.test.mjs`, `library-build.test.mjs`, `references.test.mjs`, `scripts/tests/versions.test.mjs`, `postgres-container.test.mjs` | Ref                                   | They keep testing this repo's task graph and pins. Drop assertions about deleted tasks.                                               |

### Configuration

| Path                                                                                                                                                       | Destination                          | Notes                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moon.yml` (root)                                                                                                                                          | Split                                | Delete `new-project`, `projects`, `project-register`, `rename`, `rename-verify` and `rename-verifier`. Scaffold the generic gates: `lint`, `lint-fix`, `format*`, `secrets`, `audit`, `tsgolint-lockstep`, `project-refs`, the database tasks. Ref keeps `published-shape`. |
| `.moon/workspace.yml`, `.moon/toolchains.yml`, `.prototools`                                                                                               | Scaffold                             | Owned per project. Skill `lilo-monorepo` explains the pins.                                                                                                                                                                                                                 |
| `.moon/tasks/node.yml`, `node-library.yml`, `node-application.yml`, `rust.yml`                                                                             | Scaffold (phase 1), Shared (phase 2) | Phase 2 shares them through Moon's remote `extends` if it holds up [I]. Add a `node-service` layer for services. `rust.yml` returns in phase 3.                                                                                                                             |
| `pnpm-workspace.yaml`                                                                                                                                      | Scaffold                             | Supply-chain policy plus a catalog with the package versions.                                                                                                                                                                                                               |
| `.npmrc`                                                                                                                                                   | Scaffold                             | Public npm needs no scope or token lines for consumers.                                                                                                                                                                                                                     |
| `tsconfig.options.json`                                                                                                                                    | Shared `@littleorgans/tsconfig`      | TypeScript supports `extends` from a package [I]. Root `tsconfig.json` stays Moon-generated per project.                                                                                                                                                                    |
| `vitest.config.ts`                                                                                                                                         | Shared (via `vite-config`)           | The `inline` regex names the scope. Rename it with the scope decision.                                                                                                                                                                                                      |
| `.oxlintrc.json`                                                                                                                                           | Shared (phase 2), Scaffold (phase 1) | Add `no-restricted-imports` rules that make layout mechanical (features must not import routes).                                                                                                                                                                            |
| `.oxfmtrc.json`, `.secretlintrc.json`, `.secretlintignore`, `.editorconfig`, `.vscode/*`, `.gitignore`, `lefthook.yml`, `commitlint.config.js`, `justfile` | Scaffold                             | Small files. Sharing them would cost more than it saves.                                                                                                                                                                                                                    |
| `renovate.json`                                                                                                                                            | Shared preset                        | Host a preset in this repo that consumers extend with `github>littleorgans/<repo>//renovate/base` [I]. It groups the scope's packages.                                                                                                                                      |
| `.env.example`                                                                                                                                             | Scaffold (one per app type)          | The service variant needs only `WORKOS_CLIENT_ID` and `DATABASE_URL`.                                                                                                                                                                                                       |
| `.changeset/config.json`, `.changeset/*.md`                                                                                                                | Ref                                  | Add a `fixed` group (see [Versioning](#versioning-policy)).                                                                                                                                                                                                                 |
| `.template/`                                                                                                                                               | Delete                               | Template identity and the consumer registry.                                                                                                                                                                                                                                |
| `db/schema.sql`, `db/migrations/*.sql`, `atlas.sum`                                                                                                        | Pkg (`db` ships the SQL) + Scaffold  | Projects get the identity migrations copied into their own `db/migrations/` once. Add a documented `GRANT authenticated TO <login role>` step. Without it `SET LOCAL ROLE` fails for a non-superuser [V].                                                                   |
| `db/drizzle/_generated/`                                                                                                                                   | Ref, adopted (D7)                    | Becomes the typed schema that `packages/db` passes to `drizzle(client, { schema })`. Queries such as `rows.ts` move to typed Drizzle. `drizzle-check` keeps it in sync. The policy misreporting stays documented; `rls-verify` remains the RLS authority.                   |

### Workflows

| Path                            | Destination                  | Notes                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | Shared reusable + Ref caller | Extract to `.github/workflows/moon-ci.yml` with `on: workflow_call`. Projects use `uses: littleorgans/<repo>/.github/workflows/moon-ci.yml@v1`. A public repository's reusable workflows are callable from other repositories [I]. |
| `.github/workflows/release.yml` | Ref                          | Publishes this repository's packages (see [b](#release-workflow-changes)). It is not shared in phase 1.                                                                                                                            |

### Documentation

| Path                                               | Destination                                                  | Notes                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                        | Ref + Skill `lilo-monorepo`                                  | "Add a workspace member", "Configure Moon tasks", "Prove every gate", "Write tests" and the JS/TS rules become skill material. Delete "Create projects and learn from consumers". |
| `docs/code-layout.md`                              | Skill `lilo-web-app`                                         | The skill's primary source.                                                                                                                                                       |
| `docs/auth-screens.md`                             | Skill `lilo-auth`                                            | The screen inventory and failure mapping.                                                                                                                                         |
| `docs/user-entity.md`, `docs/supabase-boundary.md` | Skill `lilo-persistence`                                     | Record model, RLS rules, host portability.                                                                                                                                        |
| `docs/decisions.md`                                | Ref, condensed                                               | Rationale stays. Delete the template-lineage paragraphs. Skills link to it.                                                                                                       |
| `docs/how-to-instantiate.md`                       | Rewrite → `docs/guides/adopt-web-app.md`, `adopt-service.md` | Toolchain setup, ports, env and publishing sections survive. Instantiation, rename and rebase sections are deleted.                                                               |
| `docs/project-lineage.md`                          | Delete                                                       | Describes deleted machinery.                                                                                                                                                      |
| `docs/auth-proposal.md`                            | Delete                                                       | Stale (B8). Its surviving facts already live in `decisions.md`.                                                                                                                   |
| `docs/system-overview.md`, `docs/domain-model.md`  | Ref, updated                                                 | Drop the lineage domain and add packages, publishing and services.                                                                                                                |
| `docs/assessment.md`                               | Ref (point in time)                                          | [c](#c-what-this-makes-obsolete) supersedes its roadmap.                                                                                                                          |
| `README.md`                                        | Rewrite                                                      | Describe it as a reference implementation and package source, not a template.                                                                                                     |

## b) Publishing

### Can each package be published as-is?

Every library packs today. `pnpm pack` resolves `workspace:*` and `catalog:` to concrete versions,
and every tarball contains `dist` JavaScript, `.d.ts` files, source maps and `src`, with no tests
[V]. `consumer-check` already builds and serves the reference app against packed tarballs
installed outside their source workspace [V]. That consumer copies this workspace's
`pnpm-workspace.yaml` catalog, though, so it never exercises version skew. The packed
declarations, emitted by TypeScript 7, typecheck with zero errors from a TypeScript 5.9.3
consumer [V].

| Package         | As-is? | Blockers before first publish                                                                                                                                                                                                                |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | Yes    | License file. Version 0.0.0.                                                                                                                                                                                                                 |
| `auth-workos`   | Yes    | License file. Exact `@workos-inc/node` pin is acceptable because it is encapsulated.                                                                                                                                                         |
| `auth-session`  | No     | **B3** Origin checks and a throttle hook on email start and verify. **U3** single-flight refresh. The token accessor for service calls. License.                                                                                             |
| `auth-tanstack` | Almost | Unbounded peer `@tanstack/react-start >=1.168` [V] becomes `^1.168.0`. License.                                                                                                                                                              |
| `db`            | No     | Exact dependencies on `drizzle-orm@0.45.2` and `pg@8.23.0` [V]. A consumer on drizzle-orm 0.44.7 got a nested second copy and `TS2345` on `tx.execute(sql\`…\`)` [V]. Make both peers. Ship the migrations and the role-grant step. License. |
| `theme`         | Yes    | License.                                                                                                                                                                                                                                     |
| `ui`            | Almost | `tailwindcss` is a dependency, not a peer, so a consumer's `@tailwindcss/vite` can resolve a different copy [I]. Peers become `react ^19`. License.                                                                                          |
| `views`         | Almost | React peers. License.                                                                                                                                                                                                                        |
| `vite-config`   | Almost | Peer `vite >=8` becomes `^8`. License.                                                                                                                                                                                                       |

Cross-cutting findings:

- **LICENSE (B5).** No tarball contains a license file (0 of 10) [V], while every manifest says
  `MIT`. npm does not copy a repository-root LICENSE into workspace packages [I]. Add `LICENSE`
  to each package directory, or copy it in `prepack`.
- **Pre-release pins (U4).** Nitro `3.0.260610-beta` is an application dependency only. No
  library manifest references it [V], so it does not block publishing. TypeScript 7 does not
  block consumers on TypeScript 5.9 [V]. The real exposure is the unbounded peer ranges above.
- **Private and `workspace:` dependencies.** No library depends on a private package, and pnpm
  rewrites `workspace:*` to exact versions [V]. Exact internal pins mean the family must be
  released together. That fits a fixed version (below).
- **Engines.** Every package requires `node >=24.19.0`. That floor becomes a consumer
  requirement. Decided (D8): Node 24, with the `>=24.19.0` floor kept.
- **`HELIOY_PAT` release flow (U7).** It is org-level. It only authors the Version Packages pull
  request. Publishing authenticates to npm separately, so it is not a blocker.
- **Secrets.** `secretlint` over every unpacked tarball found nothing [V]. A regex sweep of all 88
  commits' history for common key formats (Stripe, AWS, GitHub, npm, Slack, PEM) found nothing
  [V]. It is not a substitute for a full-history scanner such as gitleaks, which phase 1 runs
  before the first publish.

### Registry

**Decided: public npm.** GitHub Packages' npm registry requires an auth token to install
even public packages. Every consumer, laptop and CI job would carry token configuration that
public npm removes. Public npm also offers trusted publishing with provenance [I].

Claiming the scope:

- No package exists under `@lilo-moon`. `npm view @lilo-moon/auth` returns `E404` [V].
  `@littleorgans/auth` also returns 404 [V].
- Whether an npm **org** named `lilo-moon` or `littleorgans` exists is unverified. `npm org ls`
  requires `npm login`, which this environment does not have. The unauthenticated
  `/-/org/<name>/package` endpoint returned 404 for both, which is suggestive but not conclusive.
- **Decided (D1): `@littleorgans`.** Creating the free npm org `littleorgans` claims the scope.
  That is still **open**: the user creates it. Renaming `@lilo-moon/*` to `@littleorgans/*` is a
  phase 1 task (1.1). It covers package names, imports, the `@littleorgans/source` export
  condition, the Vitest inline regex, `.changeset/*.md` and `pnpm-lock.yaml`. Nothing has been
  published, so the rename needs no deprecation.

`publishConfig`: every library already sets `"access": "public"` [V]. `.changeset/config.json`
already has `"access": "public"` [V]. Keep both. Add `"provenance": true` only if publishing
with a token. Trusted publishing attaches provenance automatically [I].

### Trusted publishing (OIDC) vs `NPM_TOKEN`

| Option                        | For                                                                                                | Against                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm trusted publishing (OIDC) | No long-lived secret. Provenance is automatic. Publishing is bound to one repository and workflow. | A package must exist before a trusted publisher can be attached (npm/cli#8544, cited in `docs/how-to-instantiate.md`). Needs npm CLI ≥ 11.5 [I]. pnpm/Changesets support under OIDC is unexercised here. |
| `NPM_TOKEN` secret            | Works on day one, including for new packages.                                                      | A leaked automation token can publish anything in the scope, which is a supply-chain compromise for every consumer. It needs rotation.                                                                   |

Recommended sequence:

1. Bootstrap each package once with a short-lived granular token or a maintainer's 2FA publish of
   `0.1.0`.
2. Attach the trusted publisher (repository plus `release.yml`) to each package.
3. Revoke the token.

Every later package, such as `auth-http` or `db-tools`, repeats step 1 once.

### Release workflow changes

`.github/workflows/release.yml`:

1. Gate publishing on tests. Run `moon ci`, or at least build, typecheck, `test-coverage` and
   `published-shape`, before `changeset publish`. This reverses the build-only stance in
   `docs/decisions.md` ("Publishing relies on the protected merge boundary"). Consumers outside
   branch protection now exist, and a bad publish reaches all of them.
2. Keep `permissions: id-token: write`, which is already present, for OIDC. Make sure the job's
   npm is 11.5 or later.
3. Set `vars.NPM_PUBLISH_ENABLED=true` after the bootstrap.
4. Add a post-publish smoke job. In an empty directory, `npm install` the just-published versions
   from the public registry and typecheck a sample importing each entry point.
5. `HELIOY_PAT` keeps authoring the Version Packages pull request. No change.
6. `.changeset/config.json`: add the `fixed` group. Keep `@littleorgans/web` and the reference service
   private and unversioned, and switch `privatePackages.version` to `false`.

### Consumer check changes

`scripts/consumer-check.mjs` becomes `root:published-shape`:

- **Delete** the generated-project half: `createProject`, the rename, and running inside a
  product.
- **Keep** the gate negative proofs, run against `apps/web` in this repo.
- **Keep** the packed build and serve of the reference app.
- **Add** a fresh, non-workspace consumer that installs the tarballs with its own versions:
  - no shared catalog;
  - one skew case, drizzle-orm one minor behind, which fails today [V];
  - a TypeScript 5.x typecheck.
- **Add** `publint` and `@arethetypeswrong/cli` on each tarball [I].
- Scope it in CI by path, as in assessment item 13.

### Versioning policy

- Semantic versioning, starting at `0.1.0`. During `0.x`, a minor bump may break and a patch may
  not. Go to `1.0.0` once two projects run the packages in production.
- **One fixed version for every published package** (Changesets `fixed`). Decided
  (D3). Internal dependencies are exact pins [V], so independent versions would force
  duplicate copies on consumers. A single number also makes "upgrade to 0.4.0" one instruction.
- Every change to a published package needs a changeset. CI enforces it with
  `changeset status --since=origin/main`.
- Peer ranges are caret ranges on the supported major, never open-ended `>=`.
- Remove a public export only after one minor release that marks it `@deprecated`, with a changeset
  entry.
- Skills and guides reference the reference app at a release tag (`v0.x.y`), so text and code
  match the version a project installs.

## Services in phase 1

What a standalone TypeScript service can use today, outside the TanStack Start app:

| Capability                                | Status                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bearer token → `Principal` (`auth`)       | **Works.** A plain `node:http` service using the packed `@lilo-moon/auth` returned 200 with the Principal for a valid token, and 401 `signature` for a forged one [V].                                                                                                                                                           |
| Tenant-scoped queries (`db`)              | **Works.** The same service used `withPrincipal` against Postgres 17 with the repo's migrations applied. Each org saw only its own row under forced RLS [V]. It required a login role with `GRANT authenticated`, which no migration or doc provides [V].                                                                        |
| Migrations and RLS gates                  | **Repo-only.** `atlas-dev.mjs`, `rls-verify.mjs` and `drizzle-schema.mjs` live in `scripts/` and import `scripts/lib/postgres-container.mjs`. `packages/db`'s own integration test imports them by relative path (`packages/db/tests/integration/database.test.js` line 12) [V]. A service repo cannot run them without copying. |
| Organization provisioning (`auth-workos`) | **Works** (framework-free) [I].                                                                                                                                                                                                                                                                                                  |
| `auth-session`                            | **Web-session only.** It needs a `CookieJar` and `WORKOS_REDIRECT_URI` plus `WORKOS_COOKIE_PASSWORD` (`config.ts` lines 29–33). A bearer-token service has neither.                                                                                                                                                              |
| Web app → service calls                   | **Missing.** `Access` exposes only the `Principal`, never the access token (`access.ts` lines 19–26, 97) [V]. A Start server cannot forward the user's token to a service.                                                                                                                                                       |
| Service config                            | **Missing.** There is no loader that builds a verifier from `WORKOS_CLIENT_ID` alone. `createAuthServices` requires the full web config.                                                                                                                                                                                         |
| HTTP framework seam, auth middleware      | **Missing.** There is no bearer extraction or error-to-status mapping. Every service would hand-roll the handler above.                                                                                                                                                                                                          |
| Moon task layer for services              | **Missing.** Only `web-app` applications inherit `build`, `dev` and `preview` (`.moon/tasks/node-application.yml`). A service gets `typecheck` and tests only.                                                                                                                                                                   |
| Service reference and scaffold            | **Missing.** `services/` holds only the Rust `ping`.                                                                                                                                                                                                                                                                             |
| Service-to-service (machine) identity     | **Missing, deferred (D10).** Out of phase 1.                                                                                                                                                                                                                                                                                     |

Gap size, about 8–9 days:

| Item                                                                                               | Days |
| -------------------------------------------------------------------------------------------------- | ---- |
| `auth-http`: Fetch-standard `Request` → `Principal`, a Hono adapter, and the service config loader | 2    |
| Token accessor in `auth-session` and `auth-tanstack`                                               | 1    |
| `db`: ship migrations, role-grant step, peer dependencies                                          | 1    |
| `db-tools` minimal `rls-verify`                                                                    | 1.5  |
| `node-service` Moon layer and `services/api` reference with tests                                  | 2.5  |
| `adopt-service` guide                                                                              | 0.5  |

Decided (D5): a framework-neutral Fetch `Request`/`Response` core plus one adapter, because
Start routes already use `Request` and `Response`.

## c) What this makes obsolete

Item numbers refer to the roadmap in [the assessment](assessment.md#roadmap).

Obsolete:

- **2**: `rename-verify` in product CI.
- **3**: the drift test.
- **7**: decoupling product identity from package names.
- **8**: `just update-from-template`.
- **16**: the consumer staleness report. Renovate and `pnpm outdated` replace it.
- The findings they addressed: **U1** (rename and rebase conflicts), **U2** (rebase at scale),
  **B7** (rename verifier), **B9** (dirty registry records).
- **13** (scoping `consumer-check`) survives in a new form: path-scoping `published-shape`.

Still applies, in phase order:

| Item | Status now                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **B3 must ship before the first publish.** The email handlers live in `auth-session`, so every consumer inherits them. The `/api/theme` Origin check moves into a package helper so scaffolded apps get it. |
| 4    | **U3 must ship before the first publish.** Refresh is package code, and a spurious sign-out would reach every consumer.                                                                                     |
| 5    | License. It blocks publishing.                                                                                                                                                                              |
| 6    | Delete `docs/auth-proposal.md` rather than update it.                                                                                                                                                       |
| 9    | Adopt the typed Drizzle schema (D7): pass it to `drizzle(client, { schema })` and move queries to typed Drizzle.                                                                                            |
| 10   | `countVisibleRows` split. It is the example projects copy.                                                                                                                                                  |
| 11   | 503 for outages and email log kind. Package behavior.                                                                                                                                                       |
| 12   | Duplicate `dependsOn`. This repo only.                                                                                                                                                                      |
| 14   | WorkOS contract tests. More valuable now that many projects depend on one package version.                                                                                                                  |
| 15   | Multiple cookie keys. Package behavior.                                                                                                                                                                     |
| 17   | Pre-release pin policy. Now a peer-range and support-window policy.                                                                                                                                         |
| 18   | Condensing docs becomes skill authoring.                                                                                                                                                                    |
| 19   | Demo strings and `/theme` gating. Apply to the reference app and the scaffold.                                                                                                                              |
| new  | Document or migrate `GRANT authenticated TO <login role>` [V].                                                                                                                                              |

## d) Skills

### How skills are structured here

Read from `~/.agent-runtimes` [V]:

- Skill bodies are authored at `skills/<owner>/<domain>/<skill>/SKILL.md`, with YAML frontmatter
  (`name`, `description`) and optional sibling files. `<owner>/<domain>/<skill>` is the
  canonical ID.
- Optional bundles live in `skills/<owner>/settings.toml`.
- Runtimes select skills in `runtimes/<name>/runtime.toml` under `[skills] required` and
  `optional`. `tm/sdlc` uses `tm/sdlc/*`. `tm/frontend` uses `anthropics/frontend/*` and the
  `pbakaus/frontend-core` bundle.
- A generator renders flat, self-contained copies into each runtime home. This run's home holds
  `runtime-home/claude/skills/tm-sdlc-change-implementer/SKILL.md`, for example.
- The catalog README says homes are generated and that bodies are committed in the catalog
  repository, never read from a machine-local store.

### Proposed skills

The owner name is a placeholder (`lilo`). The rule: a skill teaches judgment and points at code;
anything checkable becomes a gate instead.

| Skill                                      | Scope                                                                                                                                                                                                 | Points to                                                                                  | Enforced mechanically instead                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lilo/build/start-project`                 | Day one: run the scaffolder or follow the copy list, choose ports, register the OAuth callback, set env, create the database login role with `GRANT authenticated`, and do the first green `moon ci`. | `docs/guides/adopt-*.md`, `apps/web/src/server/`, `services/api/src/server/`               | The scaffolder, `loadAuthConfig` validation at startup, and the reusable CI workflow.                                                        |
| `lilo/build/web-app`                       | TanStack Start structure: routes are wiring only, `features/<name>/`, the `server/` composition root, route groups carry no auth, loaders branch on `Access`, pages are tested through props.         | `docs/code-layout.md`, `apps/web/src/**`, `apps/web/tests/**`                              | The client-boundary build plugin (`vite-config`), `no-restricted-imports` layout rules [I], coverage floor, exhaustive `switch` on `Access`. |
| `lilo/build/auth`                          | Choose `organizationPolicy`, map access states to screens, failure dispositions, cookie and redirect config, forward tokens from web to service, verify bearer tokens in services.                    | `packages/auth*`, `docs/auth-screens.md`, `docs/decisions.md` (identity)                   | POST-only handlers, Origin checks and throttle inside the packages (after B3), the required-claims verifier, type-level exhaustiveness.      |
| `lilo/build/persistence`                   | Add a table: Atlas desired state, a hand-written policy migration, `atlas migrate hash`, query only through `withPrincipal`, just-in-time provisioning, pooler rules.                                 | `db/`, `packages/db`, `docs/user-entity.md`, `docs/supabase-boundary.md`                   | `db-tools rls-verify` (every table forced), `atlas migrate lint`, `drizzle-check` if kept.                                                   |
| `lilo/build/service`                       | A TypeScript backend service: layout, `auth-http` middleware, config, health endpoint, error-to-status mapping, tests, container build.                                                               | `services/api/**` (new), `packages/auth-http` (new)                                        | The `node-service` Moon layer, `published-shape`, coverage floor.                                                                            |
| `lilo/build/ui-and-themes`                 | Use `ui` and `views`, register CSS sources, decide when to promote a component to a shared package, add a token or theme.                                                                             | `packages/ui`, `packages/views`, `packages/theme`, `docs/code-layout.md` (shared packages) | The `COLOR_TOKENS` type contract, `theme:check-css`, the published-shape CSS utility checks.                                                 |
| `lilo/build/monorepo-gates`                | Moon task layers, adding a member, "prove every gate", test placement and naming, the TypeScript 7 and tsgolint rules.                                                                                | `AGENTS.md`, `.moon/tasks/`, `docs/decisions.md` (gates)                                   | `tsgolint-lockstep`, the format, lint, secrets and audit gates, lefthook and commitlint, the reusable CI workflow.                           |
| `lilo/build/publish-package` (maintainers) | Changesets, the fixed version, peer policy, deprecation, bootstrap and trusted publishing.                                                                                                            | `.changeset/`, `.github/workflows/release.yml`, this page                                  | `changeset status` in CI, `published-shape`, `publint` and `attw`, the post-publish smoke job.                                               |

The domain skills sit beside the `tm/sdlc/*` process skills. `tm/sdlc` and `tm/frontend` would
select them, ideally as one `lilo/build-core` bundle.

### Where they live (decided: D4)

- **(A) Author in the agent-runtimes catalog** under a new owner. This follows the existing model
  directly. Skill text is versioned apart from the code it describes.
- **(B) Author in this repository** (`skills/<skill>/SKILL.md`) and sync reviewed copies into the
  catalog. Behavior and teaching change in one pull request, and CI can check that every path a
  skill cites exists. It needs a sync step, because the catalog does not read machine-local stores.
- **(C) Ship inside npm packages.** Versioned exactly with the code, but runtimes do not read
  `node_modules`.

Decided (D4): (B). Skills are written in this repository and synced to the catalog, with a check
that cited paths exist at the tag the skill names. The owner name (`lilo` is a placeholder) is
chosen when the first skill lands.

## e) Scaffolding

A project now depends on packages instead of copying them. It still needs a small amount of
application-owned glue. Those files are generated once and then belong to the project. Nothing
updates them afterwards: fixes reach projects through package upgrades, so glue must stay thin.

Generated on day one:

- **Workspace root:**
  - `package.json` (tool devDependencies), `pnpm-workspace.yaml` (policy and a catalog pinned to
    the package version), `.npmrc`, `.prototools`, `justfile`;
  - `.moon/workspace.yml`, `.moon/toolchains.yml`, `.moon/tasks/*.yml`, root `moon.yml` (generic
    gates);
  - `tsconfig.options.json` (or `extends` of `@littleorgans/tsconfig`), `.oxlintrc.json`,
    `.oxfmtrc.json`, `.secretlintrc.json`, `lefthook.yml`, `commitlint.config.js`;
  - `renovate.json` (extends the preset), `.editorconfig`, `.vscode/`, `.gitignore`,
    `.env.example`;
  - a short `AGENTS.md` that points at the skills;
  - `.github/workflows/ci.yml`, a caller of the reusable `moon-ci.yml`.
- **Web app** (`apps/<name>/`), taken from `apps/web` at the release tag:
  - `package.json`, `moon.yml` (`web-app`), `tsconfig.json`, `vite.config.ts`;
  - `src/router.tsx`, `src/styles.css`;
  - `src/routes/__root.tsx`, `index.tsx`, `app.tsx`;
  - `(auth)/{callback.ts,session-error.tsx,verify-email.tsx}`;
  - `api/auth/{start.ts,signout.ts,email/start.ts,email/verify.ts}`;
  - optionally `theme.tsx` and `api/theme.ts`;
  - `src/server/{auth.ts,database.ts,theme.ts}` (the composition root), `src/features/auth/search.ts`;
  - `tests/integration/routes.test.tsx`.
- **Service** (`services/<name>/`), taken from `services/api`:
  - `package.json`, `moon.yml` (`node-service`), `tsconfig.json`;
  - `src/main.ts`, `src/server/{config.ts,auth.ts,database.ts}`, `src/routes/health.ts`;
  - `tests/`.
- **Database** (either app type):
  - `db/schema.sql`;
  - `db/migrations/` with the identity migrations copied from `@littleorgans/db` and a role-grant
    migration template;
  - `atlas.sum`.

Invocation, both ways:

- **Phase 1: skill plus guide, no CLI.** `lilo/build/start-project` walks through
  `docs/guides/adopt-*.md`, which lists exact files to copy from the tagged reference app and the
  `pnpm add` lines. It costs nothing to build and unblocks waiting projects. It is also the least
  deterministic option.
- **Phase 2: `pnpm create @littleorgans/app --web|--service|--db`** (`packages/create-app`), with the
  skill invoking it. The CLI does the deterministic writing. The skill handles the judgment calls:
  organization policy, ports, whether a database is needed. The CLI's templates are generated from
  the reference app at release time and tested in `published-shape`, so they cannot drift from
  it.

## f) Phased plan

The sizes assume one engineer who knows the code. Items marked ∥ can run in parallel with other
work.

### Phase 1a: publish the web stack (about 7–8 working days)

| #   | Item                                                                                                                                                                                                                                       | Days | Depends on                | Decisions        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------- | ---------------- |
| 1.1 | Rename the scope `@lilo-moon` → `@littleorgans` (D1) across manifests, imports, the source export condition, Vitest config, changesets and lockfile. Add MIT `LICENSE` per package (D2). The npm org itself is created by the user (open). | 0.75 | npm org exists before 1.8 | D1, D2 (decided) |
| 1.2 | **B3:** Origin check and throttle hook on email start and verify. Package helper for the `/api/theme` Origin check.                                                                                                                        | 1    | —                         | —                |
| 1.3 | **U3:** single-flight refresh, with reuse-rejection handling. Includes a 0.5-day WorkOS spike to confirm rotation behavior.                                                                                                                | 1.5  | Staging credentials       | —                |
| 1.4 | **Secrets sweep:** full-history gitleaks, tarball secretlint, rotate anything found.                                                                                                                                                       | 0.5  | ∥                         | —                |
| 1.5 | Manifest hygiene: peers (`drizzle-orm`, `pg`, `tailwindcss`), caret peer ranges, LICENSE per package, version `0.1.0`, `fixed` group.                                                                                                      | 1    | 1.1                       | D3, D8           |
| 1.6 | Delete template machinery (see [a](#a-where-each-part-goes)) and the examples (D6): `collections`, `services/ping`, the task board and demo residue. Rewrite README and AGENTS.                                                            | 1    | ∥                         | D6               |
| 1.7 | `published-shape`: fresh consumer, skew case, TypeScript 5.x, `publint` and `attw`.                                                                                                                                                        | 1    | 1.5                       | —                |
| 1.8 | Release: gate publishing on the full `moon ci` (D9), bootstrap-publish `0.1.0`, attach trusted publishers, post-publish smoke.                                                                                                             | 1    | 1.2–1.5, 1.7              | D9               |
| 1.9 | `docs/guides/adopt-web-app.md` with copy list, env and ports, plus a thin `lilo/build/start-project` skill.                                                                                                                                | 1    | 1.6                       | D4               |

1.2 through 1.4 come before 1.8. Nothing is published before the security fixes and the sweep.
The web-stack packages (`auth*`, `db`, `theme`, `ui`, `views`, `vite-config`) are installable at
the end of 1.8, about day 7.

### Phase 1b: services (about 8–9 working days, can overlap 1a after 1.5)

| #    | Item                                                                         | Days | Depends on | Decisions |
| ---- | ---------------------------------------------------------------------------- | ---- | ---------- | --------- |
| 1.10 | `auth-http` plus the service config loader                                   | 2    | 1.5        | D5        |
| 1.11 | Token accessor in `auth-session` and `auth-tanstack` for web → service calls | 1    | 1.3        | —         |
| 1.12 | `db`: ship migrations, role-grant migration and docs                         | 1    | 1.5        | —         |
| 1.13 | `db-tools` minimal (`rls-verify`)                                            | 1.5  | 1.12       | —         |
| 1.14 | `node-service` Moon layer and `services/api` reference with tests            | 2.5  | 1.10, 1.12 | D5        |
| 1.15 | `docs/guides/adopt-service.md`, then publish `0.2.0`                         | 0.5  | 1.13, 1.14 | —         |

Phase 1 total is about 16 engineer-days. With two people it takes about 9 working days: web
packages around day 7, services around day 9 or 10.

### Phase 2 (after phase 1, about 21 days)

| Item                                                                                                   | Days | Depends on | Decisions    |
| ------------------------------------------------------------------------------------------------------ | ---- | ---------- | ------------ |
| Full skill set (d), with path-existence check and catalog sync                                         | 4    | 1.9        | D4           |
| `create-app` CLI, with templates generated from the reference app and tested in `published-shape`      | 4    | 1.15       | —            |
| Shared config packages (`tsconfig`, `oxlint-config`, Vitest), Renovate preset, reusable `moon-ci.yml`  | 3    | 1.6        | —            |
| `db-tools` full: Atlas and Drizzle wrappers (typed schema generation, D7), Postgres container, `clean` | 2    | 1.13       | D7 (decided) |
| Assessment carry-overs: B1 (adopt the typed Drizzle schema, D7), B2, B4, B6, B10 (items 9–12, 19)      | 3    | —          | D7 (decided) |
| Switch the reference app from workspace source to the published packages (D9)                          | 1    | 1.15       | D9 (decided) |
| WorkOS contract tests and one browser sign-in test (item 14)                                           | 2    | —          | —            |
| Multiple cookie keys (item 15)                                                                         | 2    | —          | —            |

### Later

- Rust crates and PyPI packages: port the `Principal`, verifier and scoped-transaction contracts,
  which were designed for this ("a second language implementing the same contract",
  `packages/auth/src/errors.ts`). Add per-language release tooling, because Changesets cannot see `Cargo.toml` or
  `pyproject.toml` (`docs/decisions.md`). Each language is L-sized.
- Machine-to-machine service identity, deferred (D10).
- `1.0.0` and a support-window policy (item 17).

## g) Risks: guide plus skills vs template

What gets worse:

1. **Glue drifts and has no update path.** Scaffolded routes, composition roots and CI callers
   diverge per project, and a bug in glue must be fixed by hand in every project. `/api/theme`'s
   missing Origin check lives in app code today. Mitigation: move logic into packages, keep glue
   to wiring, and publish "action required" notes in changesets.
2. **Skills advise; gates enforce.** An agent can ignore or misread a skill. Skill text also
   drifts from code unless it is pinned to tags and path-checked. The template carried its
   conventions in working code a project physically had.
3. **The public API becomes a contract.** Every exported helper is a support commitment,
   including the test helpers `seal` and `unseal` that `auth-session` exports. Refactors that were
   free inside one repository now need semantic-versioning judgment and deprecation cycles.
4. **Version skew and peer conflicts.** The template gave every project one lockfile-consistent
   set. Packages let a project mix versions. The drizzle-orm case already fails [V].
5. **Supply-chain concentration.** One compromised or bad release reaches every project on its
   next install. OIDC, gated publishing and the smoke job reduce the risk but do not remove it.
6. **Security flaws are visible to everyone.** The source is already public, but installable
   packages attract more scrutiny. B3 and U3 must land first, and a disclosure policy
   (`SECURITY.md`) should exist before `0.1.0`.
7. **Day one gets thinner.** A template produced a running, gated system. Phase 1 relies on a
   copy-list guide, which is the least reliable onboarding until the CLI lands.
8. **The reference app is less representative.** It consumes workspace source, not published
   tarballs until phase 2, when it switches to the published packages (D9). Until then
   `published-shape` carries that weight.
9. **More release lines to maintain:** packages, scaffold templates, skills and the reusable
   workflow each need a version and a compatibility story. That is a lot for a small team.
10. **Unproven pieces:**
    - Moon remote task `extends` [I];
    - oxlint config `extends` from a package [I];
    - pnpm and Changesets publishing under npm OIDC [I];
    - the service reference, which has never been deployed.

What gets better: fixes reach projects through `pnpm update`. There is no rename, no rebase and no
conflicting initialization commit. Package boundaries become real, and the same auth and database
contracts serve both frontends and services.

## Decisions (approved 2026-09-23)

The user approved all ten on 2026-09-23.

| #   | Decision                            | Outcome                                                                                                        |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D1  | npm scope                           | `@littleorgans`. The rename from `@lilo-moon` is phase 1 task 1.1.                                             |
| D2  | License                             | MIT, with a `LICENSE` file in every published package.                                                         |
| D3  | Versioning                          | One fixed version for all published packages (Changesets `fixed`).                                             |
| D4  | Skill location                      | Written in this repository and synced to the agent-runtimes catalog.                                           |
| D5  | Service HTTP framework              | A Fetch `Request`/`Response` core plus one adapter.                                                            |
| D6  | Examples                            | Delete `collections`, `services/ping` and the task board. `/theme` stays as a reference page.                  |
| D7  | Drizzle                             | Adopt the typed schema. Queries move to typed Drizzle, and `drizzle-check` keeps the artifact honest.          |
| D8  | Node engine floor                   | Node 24 (`>=24.19.0`).                                                                                         |
| D9  | Publish gate and reference app      | Publish only after the full `moon ci` passes. The reference app switches to the published packages in phase 2. |
| D10 | Machine-to-machine service identity | Deferred.                                                                                                      |

## Still open

- **Create the npm org `littleorgans`.** A user action. It must exist before the bootstrap
  publish in task 1.8.
- **WorkOS refresh-token reuse behavior is unverified.** Task 1.3 (U3) needs it confirmed against
  a staging environment before the single-flight refresh design is final.

## Evidence

Run on 2026-09-23 in the `docs/system-overview` worktree and disposable directories:

- **Packing.** `moon run :build`, then `pnpm pack` for all 10 libraries. Packed manifests:
  `workspace:` and `catalog:` resolved, `license: MIT`, `access: public`, no license file, no
  tests. The `vite-config` `publishConfig` export redirect was applied.
- **TypeScript 5.9.3 consumer** (npm, outside the workspace) importing `auth`, `auth-session`,
  `db`, `theme`, `ui/components/button` and `views/sign-in`:
  - with `skipLibCheck: true`, zero errors;
  - with `skipLibCheck: false`, zero errors in `@lilo-moon/*` files; the only errors are in
    drizzle-orm's own declarations.
- **Skew case.** With drizzle-orm 0.44.7 in the consumer, `tx.execute(sql\`select 1\`)`fails
with`TS2345`. npm nested drizzle-orm 0.45.2 under `@lilo-moon/db`.
- **Standalone service.** `node:http` with the packed `auth` and `db`, a local JWKS, and Postgres
  17 with both migrations applied and a `svc` login role granted `authenticated`:
  - valid tokens for `org_a` and `org_b` each returned 200 and only their own `accounts` row;
  - no token returned 401;
  - a forged signature returned 401 `signature`.
- **Registry.** `npm view @lilo-moon/auth` and `npm view @littleorgans/auth` returned `E404`.
  `npm org ls` was unavailable without login.
- **Repository.** `gh repo view littleorgans/lilo-moon-template` reports `PUBLIC`.
- **Secrets.** `secretlint` over every unpacked tarball exited 0. A `git log -p --all -G` sweep of
  88 commits for Stripe, AWS, GitHub, npm and Slack key formats and PEM private keys found no
  matches.
- **Skills.** Structure read from `~/.agent-runtimes/README.md`,
  `runtimes/tm-sdlc/runtime.toml`, `runtimes/frontend/runtime.toml` and this run's home.

Everything marked [I] was not run. In particular: npm OIDC under pnpm and Changesets, Moon remote
`extends`, oxlint package `extends`, the `tailwindcss` peer conflict, reusable-workflow access,
and every size estimate.
