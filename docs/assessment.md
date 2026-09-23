# Assessment and roadmap

> Phase 1 removed the template machinery this review describes: project creation, the rename, the
> consumer registry, `collections` and `services/ping`.

An assessment of `main` at `a95bab6` (#95), written 2026-09-23. It records strengths, weaknesses
and risks, with evidence, and proposes a prioritized roadmap. The
[verification log](#verification-log) says which claims were checked by running something and
which come from reading the code. This page is a point-in-time review, not a contract. Reconcile or
delete it as items land.

## The Good

**1. The gates are proven to fail, not just to pass.** `root:consumer-check` plants a type error, a
failing assertion, a floating promise, malformed formatting and a missing CSS source registration
in a real generated project. It asserts that each is rejected (`scripts/consumer-check.mjs` lines
226–264). `scripts/rls-verify.mjs` states that each assertion was proven to fail when its
protection is removed. `docs/decisions.md` ("What a green gate actually proves") records three past
incidents where a gate passed while checking nothing. Few templates encode this discipline in code.

**2. Row level security is tested by behavior, not by reading artifacts.** `root:rls-verify`
applies the migrations to a real Postgres and checks six properties: tenant scoping, subject
scoping, fail-closed on absent claims, refused cross-tenant insert, claims not surviving the
transaction, and every `public` table having RLS enabled and forced. The last check catches a
future table added without a policy. The `nullif` guard for the empty-string GUC after `COMMIT` is
explained and tested (`db/migrations/20260822081700_identity.sql` lines 37–49).

**3. Auth is split along real seams.** `packages/auth` has no vendor SDK. `auth-workos` confines the
SDK behind a structural `WorkOSClient`. `auth-session` knows no web framework (`CookieJar`).
`auth-tanstack` is about 230 lines of binding. The package tests (133 in `auth-session`, 61 in
`auth-workos`, 25 in `auth`, 21 in `auth-tanstack`) cover state checks, error translation and
refresh paths without network access. `Access` is a discriminated union and
`loadWorkspaceOrRedirect` switches on it exhaustively
(`apps/web/src/features/workspace/server/load-workspace.ts` lines 57–77). A new state is a compile
error, not a blank page.

**4. Auth security details are correct in the places that usually go wrong.**

- The OAuth `state` is 32 random bytes, compared in constant time, and spent on first check
  (`packages/auth-session/src/session.ts` lines 107–125, `callback.ts` lines 118–123).
- The session is sealed with AES-256-GCM using an HKDF-derived key, and the password must be at
  least 32 characters (`config.ts` lines 63–70).
- Sign-out is POST-only with an `Origin` check (`signout.ts` lines 18–22).
- Organization provisioning is idempotent through `externalId`, with the conflict error
  special-cased (`auth-workos/src/errors.ts` lines 116–123).
- Theme redirects accept only same-origin referers (`apps/web/src/server/theme.ts` lines 14–25).

**5. Project creation is careful.** Creation reserves the destination with an atomic `mkdir`. It
cleans up on failure, keeps the project if only registration fails, refuses shallow and
product-as-template sources, rejects symlink aliases into the template, strips credentials from
stored URLs, and writes one registry file per project to avoid lost updates. Each behavior has a
test in `scripts/tests/integration/projects.test.mjs`, including concurrent creators. Generation
from a real checkout took 17 s and produced a project that passed 47 Moon tasks.

**6. The supply-chain posture is strong for a template.** Configuration in `pnpm-workspace.yaml`
blocks dependency lifecycle scripts and exotic transitive sources, and makes new versions wait 24
hours. Install fails when a version's publish trust is weaker than earlier releases. Audit ignores
require a GHSA id, a reason and an expiry, validated by `scripts/check-security.mjs`. GitHub Actions
are pinned by SHA. The TypeScript and tsgolint pins are a gate, not a convention
(`root:tsgolint-lockstep`).

**7. The build graph is precise.** Moon tasks declare real inputs, including compiler
configuration (`.moon/tasks/node-library.yml`). Layer and tag filters keep web tasks off non-web
apps. `scripts/tests/integration/moon-tasks.test.mjs` tests the task shape itself. The
client-boundary Rolldown plugin fails a build that ships a server module to the browser
(`packages/vite-config/src/index.ts` lines 42–62).

**8. Library packaging is exercised end to end.** `consumer-check` packs every library and
installs the tarballs outside the workspace. It rebuilds, serves, and checks HTML, CSS utilities
and a theme cookie round trip. The `@lilo-moon/source` condition gives source-level development
without making Node consumers load TypeScript.

## The Bad

**B1. The generated Drizzle schema is maintained by two gates but imported by nothing.** `packages/db`
calls `drizzle(client)` with no schema (`packages/db/src/database.ts` line 52). The only query site
uses raw `sql` templates (`apps/web/src/features/workspace/server/rows.ts` lines 41–51).
`db/drizzle/_generated/schema.ts` misreports the SELECT policies (its own header says so).
`root:drizzle-generate` and `root:drizzle-check` keep that artifact in sync, spending a Docker
Postgres in CI, but no code consumes it. Drizzle is used as a SQL executor, not as a typed query
layer.

**B2. A function named "count" writes.** `countVisibleRows` inserts `accounts` and `profiles` rows
before counting (`rows.ts` lines 35–52), and it runs from a GET loader (`routes/app.tsx`). The
just-in-time provisioning is intended (`docs/user-entity.md`). Hiding it in a diagnostic count on a
GET path is the pattern products will copy.

**B3. The email-code endpoints lack the Origin check that sign-out has.** `startEmailSignIn` and
`completeEmailSignIn` accept any cross-origin POST (`packages/auth-session/src/email.ts` lines
42–76, 93–136). A cross-origin POST to `/api/auth/email/start` reached the WorkOS call in a local
probe. `signOut` refuses the same request with 403 (`signout.ts` line 20). `SameSite=Lax` on the
email cookie blunts login CSRF on the verify step. Nothing stops a third-party page from making the
application send codes to arbitrary addresses, and there is no rate limiting in the app.
`/api/theme` also accepts cross-origin POSTs. That is low impact, but it is inconsistent.

**B4. Failure pages use one status for every cause.** `failurePage` always returns 400
(`packages/auth-session/src/failure.ts` lines 107–113), including the `retry` disposition for
provider outages and rate limits. Monitoring cannot tell a user error from an outage by status.
Email-start failures are logged as `auth.callback.failed` because they reuse
`kind: "callback"` (`email.ts` line 61, `auth-tanstack/src/log.ts` line 20).

**B5. Packages claim a license that the repository does not ship.** Every library `package.json`
declares `"license": "MIT"`, while `docs/how-to-instantiate.md` (retired; its surviving sections are in `docs/maintaining.md` and `docs/guides/`) line 89 says there is no `LICENSE`
file and tells the adopter to add one. Tarballs therefore ship an MIT claim without the license
text. A project that later chooses a different license inherits a wrong claim unless someone edits
every manifest.

**B6. Dependencies are declared twice.** `apps/web/moon.yml` `dependsOn` repeats the workspace
dependencies already in `apps/web/package.json`. `docs/how-to-instantiate.md` (retired; its surviving sections are in `docs/maintaining.md` and `docs/guides/`) has to tell adopters
to edit both when removing `collections`. With `syncProjectWorkspaceDependencies: true`, Moon can
infer these edges from the manifest.

**B7. `root:rename-verifier` proves almost nothing, and the useful check is not in CI.** The
verifier confirms that the token list and file list are non-empty. It then runs `verify_absent` and
discards the result (`scripts/rename-template.sh` line 44). The check that matters in a product,
`rename-verify`, is `runInCI: false` (`moon.yml` lines 77–83), so nothing in a product's CI flags a
template token that returns in a template update (see U1).

**B8. Some documentation is stale.**

- `docs/auth-proposal.md` line 210 lists `@mantine/hooks` as settled and line 445 lists it as a
  dependency. It is in no manifest or catalog.
- The same file still asks whether `db/drizzle/_generated/` should move into `packages/db`
  (line 481).
- `AGENTS.md` line 188 requires that docs describe only state present on the current branch.
- About 1,900 lines of narrative docs and essay-length code comments mix rationale, history
  ("measured 2026-08-24") and instructions. They are valuable as a record but costly to navigate.
  Before this change there was no single map of the system.

**B9. The template's working tree is dirty after every creation.** `registerProject` writes the
tracked consumer record into the template (`scripts/lib/project-registry.mjs` lines 91–98) and does
not commit it. A creator who forgets to commit it loses the record. On a shared template, records
arrive through unrelated pull requests.

**B10. The reference app carries demo residue into every product.** The document title is
hard-coded to "Task board" (`apps/web/src/routes/__root.tsx` line 39). The public, unauthenticated
`/theme` lab ships as a production route. The signed-in page prints the whole `Principal` JSON. All
of this is documented as replaceable. It is also what a hurried product ships.

## The Ugly

**U1. The upgrade path conflicts with the identity rewrite, and one failure mode is silent.**
Creation rewrites `@lilo-moon`, `littleorgans` and `lilo-moon-template` across about 77 tracked
files, including the lockfile and pending changesets, in one initialization commit. Updates are
`git rebase upstream/main`, which replays that commit on top of every template change.
Reproduced in disposable repositories:

- A template commit that adds a new file importing `@lilo-moon/collections` rebases cleanly. The
  product then fails `web:typecheck` with `TS2307: Cannot find module '@lilo-moon/collections'`.
  Only `just rename-verify`, which is not in CI, names the cause.
- A template commit that edits any line containing a token, such as an import in `task-board.tsx`,
  conflicts inside the product's initialization commit on every rebase that includes it.
- Re-running `scripts/rename-template.sh <org> <scope> <slug>` after the rebase repaired the first
  case. That step is not documented.

The problem grows with the template's rate of change and with the number of projects. Token
occurrences outside imports, such as a new package's `@lilo-moon/source` export condition, a
changeset naming `@lilo-moon/*`, or a repository URL, fail more quietly or not at all.

**U2. Rebase-based updates do not scale to a product with collaborators.** The documented
procedure rewrites every product commit since creation on every template update
(`docs/project-lineage.md` lines 85–101). The docs acknowledge the coordination cost. For a product
with a protected, shared `main`, rebase is effectively unavailable. Merging `upstream/main` is
neither documented nor tested, and a merge reintroduces the U1 token problem as merge conflicts.

**U3. Concurrent requests can sign a user out when refresh tokens rotate.** When an access token
expires (about 300 s, per the comment in `access.ts` lines 57–61), each request that sees it calls
`refreshTokens` with the same refresh token (`access.ts` lines 63–83). There is no single-flight
guard. If WorkOS rotates refresh tokens and rejects a reused one, the losing request classifies the
failure as `ended`, clears the session cookie and redirects to sign-in. This is inferred, not
reproduced: it needs a live WorkOS environment. The current app has one authenticated loader, so
the exposure is small today. It grows with parallel server functions, prefetching and multiple tabs.

**U4. The stack is pinned to pre-release and fast-moving majors.** Nitro is a beta
(`pnpm-workspace.yaml` line 32: `3.0.260610-beta`). TanStack Start 1.168 changes quickly.
TypeScript 7 (`tsgo`) has no `tsserver`, so it needs a special editor setup. Vite 8 and Rolldown
are new. The oxlint-tsgolint pin encodes the TypeScript patch version. Each product inherits these
pins and, per `docs/how-to-instantiate.md` (retired; its surviving sections are in `docs/maintaining.md` and `docs/guides/`), is told not to change them. Upgrades flow through the
same fragile rebase (U1).

**U5. The session secret has no rotation path.** One `WORKOS_COOKIE_PASSWORD` derives one key
(`config.ts` lines 63–70). Rotating it makes every existing cookie unreadable, which signs everyone
out. The session cookie lives a year (`session.ts` line 84). The design is sound, but it leaves no
room for routine key rotation or incident response without a mass logout. Addressed for rotation
by `WORKOS_COOKIE_PASSWORD_PREVIOUS` (roadmap item 15); the procedure is in
`packages/auth-session/README.md`. Incident response still means a mass logout, by design.

**U6. Live provider behavior is untested.** WorkOS behaviors the code depends on include `aud`
being absent, refresh preserving `org_id`, `external_id_already_used` arriving as a 400 generic
error, and one-time-code error codes. They are recorded as manual "measured" comments. No test runs
against a WorkOS staging environment, and no browser-level test signs in. A silent SDK or API change
would surface in production first. The structural `WorkOSClient` catches type-level SDK changes
only.

**U7. The template maintainer is a single point of knowledge.** The docs explain decisions through
incidents the maintainer lived through, so the reasoning lives with one person and a long narrative.
The consumer registry depends on maintainers remembering to inspect products. Nothing turns what
products learn into template changes, and nothing tells a product that its template revision is
stale. (The release workflow's `HELIOY_PAT` is an org-level token, not a personal credential, so it
is not part of this risk.)

**U8. CI cost grows with every change.** `consumer-check` runs `runInCI: "always"` with
`cache: false`. It performs two full installs, two builds and server probes on every pull request,
even a docs-only one. Locally it ran in about a minute with a warm pnpm store. On a cold runner it
is the long pole, and it will grow with each new app or package.

### Resolved during this review

- `root:audit` failed on the growth-patterns tip because of a new high advisory in `js-yaml`
  (GHSA-2883-xcg3-v3hh) reached through commitlint and secretlint. `moon ci` was red for reasons
  unrelated to code. The merge of #95 bumped `js-yaml` to 4.3.2, and `root:audit` passes on
  `a95bab6`. The structural point stands: an uncached, time-dependent audit makes CI fail on any
  day a new advisory lands.
- `packages/ui/src/hooks/.gitkeep` was an empty placeholder that contradicted `AGENTS.md` line 164.
  #95 removed it.

## Roadmap

Sizes: S is up to half a day, M is one to three days, L is a week or more.

### Now

| #   | Item                                                                                                                                                                                            | Why                                                                                                      | Size | Depends on                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---- | -------------------------------- |
| 1   | Add an `Origin` check, and a per-address or per-IP throttle hook, to the email start and verify handlers. Give `/api/theme` the same `Origin` check.                                            | B3. Closes the cross-site code-sending path and makes POST handling consistent.                          | S    | —                                |
| 2   | Add a downstream-only identity gate: run `rename-verify` in `moon ci` when `.template-origin.json` exists. Document "re-run the rename after `rebase upstream/main`" in both update procedures. | U1, B7. Turns a silent failure into a named one using existing code. Verified to repair the silent case. | S    | —                                |
| 3   | Add a `scripts-test` case where the template adds a new file containing a scope token and edits a token line, then asserts what the documented update procedure produces.                       | U1. The current rebase test uses a token-free change, so it misses the failure.                          | S    | 2                                |
| 4   | Single-flight the refresh in `readAccess` per session within a process. Treat a reused-refresh-token rejection as a retry that re-reads the cookie, not as `ended`.                             | U3. Prevents spurious sign-outs as the app gains parallel loaders.                                       | M    | Confirm WorkOS rotation behavior |
| 5   | Resolve the license inconsistency: ship a `LICENSE` and keep MIT, or remove the `license` fields and let the rename set them.                                                                   | B5. Published tarballs currently misstate their terms.                                                   | S    | Owner decision                   |
| 6   | Update `docs/auth-proposal.md` for `@mantine/hooks` and the settled `_generated` location, or mark the file historical.                                                                         | B8. Enforces the repository's own documentation rule.                                                    | S    | —                                |

### Next

| #   | Item                                                                                                                                                                                                                                                                                                                                | Why                                                                                                        | Size | Depends on                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------- |
| 7   | Decouple product identity from package identity. Options: (a) products keep the template scope, or a neutral internal scope such as `@app/*`, for workspace packages and rename only publishable names at publish time; (b) make the rename a re-runnable, idempotent step invoked by an `update-from-template` script after fetch. | U1, U2. Removes the main source of update conflicts. Option (a) makes most template patches apply cleanly. | L    | 2, 3; owner decision on publishing  |
| 8   | Provide `just update-from-template`: fetch upstream, merge or rebase (configurable), re-apply identity, `pnpm install`, `moon sync`, then run gates. Document merge as the default for shared branches.                                                                                                                             | U2. Makes updates safe for collaborative products and testable in `scripts-test`.                          | M    | 7                                   |
| 9   | Either use the generated Drizzle schema, for example by passing it to `drizzle(client, { schema })` and moving `rows.ts` to typed queries, or drop `drizzle-generate`, `drizzle-check` and the artifact.                                                                                                                            | B1. Removes a CI Postgres run that protects nothing, or makes it pay for itself.                           | M    | —                                   |
| 10  | Split provisioning out of `countVisibleRows` into an explicit `ensureTenantRows` step called once after sign-in or in the loader, and name it for what it does.                                                                                                                                                                     | B2. Products copy the example, so it should model the intended pattern.                                    | S    | —                                   |
| 11  | Return 503 for `retry` dispositions, and give email failures their own log `kind`.                                                                                                                                                                                                                                                  | B4. Makes monitoring and alerting meaningful.                                                              | S    | —                                   |
| 12  | Let Moon infer `apps/web` project edges from `package.json`, or add a check that the two agree.                                                                                                                                                                                                                                     | B6. One source of truth for dependencies.                                                                  | S    | Confirm Moon 2.5 inference behavior |
| 13  | Scope `consumer-check` in CI: run it when `scripts/`, `packages/`, `apps/`, `.moon/` or manifests change, not on docs-only changes.                                                                                                                                                                                                 | U8. Faster pull requests without weakening the gate on relevant changes.                                   | S    | —                                   |

### Later

| #   | Item                                                                                                                                                                                  | Why                                                                            | Size | Depends on                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- | ------------------------- |
| 14  | Add a scheduled contract test against a WorkOS staging environment for the measured behaviors, and one browser end-to-end sign-in via email code.                                     | U6. Detects provider drift before production.                                  | M    | Staging credentials in CI |
| 15  | Support multiple cookie keys (current plus previous) for session unsealing, with documented rotation. Consider a shorter session lifetime with sliding renewal.                       | U5. Enables key rotation without a mass logout.                                | M    | —                         |
| 16  | Add a staleness report to `just projects`: behind-by commit count per consumer, from the recorded repository and `git ls-remote`, and optionally an issue in each product repository. | U7. Closes the feedback loop the registry exists for.                          | M    | 8                         |
| 17  | Define an upgrade policy for pre-release pins (Nitro beta, TypeScript 7, TanStack Start): who bumps them, how products follow, and a tested rollback.                                 | U4. Products are told not to change the pins, so the template owns their risk. | M    | 8                         |
| 18  | Condense `docs/decisions.md` and long code comments into a short rules section plus an archived history, and link incidents instead of re-narrating them.                             | B8, U7. Lowers onboarding cost for people and agents.                          | M    | —                         |
| 19  | Make the reference app's product-facing strings (title, sign-in copy) configuration in `server/`, and gate `/theme` behind a development flag.                                        | B10. Reduces demo residue shipped by products.                                 | S    | —                         |

## Verification log

### Verified by running (worktree `lilo-moon-template-docs`, macOS, Docker running, Moon 2.5.1, pnpm 11.22.0)

- On the growth-patterns tip `e7d0df8`, `moon check --all` failed at `root:audit` on
  GHSA-2883-xcg3-v3hh. After rebasing onto `a95bab6`, `moon run root:audit` passes.
- `moon exec --on-failure continue` ran every other gate on `e7d0df8`: `:build`, `:typecheck`,
  `:test-coverage`, `:lint`, `:test`, `theme:check-css`, `root:format-check`, `root:project-refs`,
  `root:tsgolint-lockstep`, `root:scripts-test` (26 tests), `root:secrets`, `root:drizzle-check`,
  `root:rls-verify` (6 of 6 ok), `root:atlas-lint`, `root:rename-verifier` and
  `root:consumer-check`. All 59 tasks passed, including consumer-check's four negative proofs and
  its CSS-registration rejection. `a95bab6` differs from `e7d0df8` only in `pnpm-lock.yaml` and one
  deleted `.gitkeep`.
- Test counts: auth-session 133, auth-workos 61, web 50, theme 27, auth 25, views 23,
  auth-tanstack 21, db 19, ui 16, vite-config 6, collections 4, ping 2, scripts 26.
- `just new-project demo2 --dest /tmp/lmt-drift --org demo-org --ref e7d0df8`, run from a clone of
  the template, finished in 17 s. It produced `origin` and `upstream` remotes, `HEAD^` equal to the
  selected revision, `.template-origin.json` with `setup: installed`, and an uncommitted consumer
  record in the template. In the generated project, 47 Moon tasks passed, `consumer-check` skipped
  as a consumer, and `just rename-verify` passed.
- `scripts/projects.mjs create --no-install` produced a project whose initialization commit touched
  78 files, including `.changeset/*.md` and `pnpm-lock.yaml`.
- U1: a template commit adding `import { partition } from "@lilo-moon/collections"` rebased cleanly
  into the product, which then failed `web:typecheck` with TS2307 and failed `just rename-verify`.
  Re-running the rename fixed both. A template commit editing a token line made the rebase stop with
  a conflict in the initialization commit.
- B3: the built server was started with placeholder WorkOS credentials. A POST to
  `/api/auth/email/start` with `Origin: https://evil.example` reached the provider call (400 with a
  logged `unauthorized` provider failure). The same POST to `/api/auth/signout` returned 403, and to
  `/api/theme` returned 303.

### Inferred from reading the code

- U3, the refresh race. It depends on WorkOS refresh-token rotation semantics, which were not
  exercised.
- U5, U6, U7 and U8, and the upgrade-risk assessment in U4.
- B1 (Drizzle schema unused), confirmed by `git grep` for imports of `_generated`. B2, B4, B5, B6,
  B8, B9 and B10 come from reading the cited files.
- The CI and release workflow behavior described in the [system overview](system-overview.md). No
  GitHub Actions run was triggered.
- Real WorkOS sign-in, email delivery and Supabase hosting were not exercised.
