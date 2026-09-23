# Adopt the packages in a web app

This guide starts a new project with a TanStack Start web app on the published
`@littleorgans/*` packages at `^0.1.0`. The project installs the packages from npm and copies a
small amount of glue from the reference app in this repository. It then owns that glue. Fixes
reach it through package upgrades, not through copying the glue again.

Work through it from top to bottom. Each step says what to run and which files it writes. For a
TypeScript service, set up the workspace root here and then follow
[Adopt the packages in a service](adopt-service.md). The `lilo/build/start-project` skill
([`skills/lilo/build/start-project/SKILL.md`](../../skills/lilo/build/start-project/SKILL.md))
covers the judgment calls this checklist leaves to you.

The commands name the project `acme` and the app `web`. The app's directory name is also its
Moon project id, so `apps/portal` runs as `portal:build`. If you choose another name, change it
everywhere it appears.

## 0. Decide first

- **Organization policy.** `personal` gives every new user their own organization at first
  sign-in. `existing` leaves membership to you. It is set in `src/server/auth.ts`.
- **Ports.** Pick the web app's development port and preview port now, because the OAuth callback
  you register depends on them (step 5).
- **Database.** The web app signs people in without one. Without a database, skip step 6 and
  delete the `rls-verify` task from the root `moon.yml`.
- **Web app, service, or both.** A service lives in the same workspace under `services/<name>/`
  ([Adopt the packages in a service](adopt-service.md)).

## 1. Install the tools

Moon installs Node `24.19.0` and pnpm `11.22.0` from `.moon/toolchains.yml`. You install proto,
Moon `2.5.5` and just yourself. Docker runs the database gates locally, and `psql` applies
migrations to a real database.

```sh
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
proto install moon 2.5.5
brew install just    # other platforms: https://github.com/casey/just#installation
moon --version       # must print 2.5.5
```

Finish the proto installer's prompt so that `~/.proto/bin` is on `PATH`. `.moon/workspace.yml`
pins `versionConstraint: "=2.5.5"`, so Moon refuses to run under any other version.

Moon's Node and pnpm serve its tasks. The `npm pkg` and `pnpm` commands in steps 3, 4 and 6 run
outside Moon, so a Node `24` with `npm`, and a pnpm `11`, must also be on your `PATH`. Any version
manager will do. `node --version` and `pnpm --version` must both answer before step 3.

## 2. Fetch the reference at the release tag

Copy the glue from the tag that matches the package version you install, so that the code and the
packages agree:

```sh
git clone --depth 1 --branch v0.1.0 https://github.com/littleorgans/lilo-moon-template.git /tmp/lilo-ref
export REF=/tmp/lilo-ref
```

Every later command reads from `$REF`. To read one file at a tag without cloning, use
`https://raw.githubusercontent.com/littleorgans/lilo-moon-template/v0.1.0/<path>`.

## 3. Create the workspace root

The root holds the Moon workspace, the toolchain pins, the workspace-wide gates and the supply-chain
policy. A standalone service project uses the same root.

```sh
mkdir acme && cd acme
git init -b main
cp "$REF"/{.editorconfig,.gitignore,.npmrc,.prototools,.env.example,.oxlintrc.json,.oxfmtrc.json,.secretlintrc.json,.secretlintignore} .
cp "$REF"/{commitlint.config.js,lefthook.yml,justfile,renovate.json,tsconfig.options.json,vitest.config.ts,package.json,pnpm-workspace.yaml} .
mkdir -p .moon/tasks .vscode .github/workflows scripts/lib
cp "$REF"/.moon/{workspace,toolchains}.yml .moon/
cp "$REF"/.moon/tasks/{node,node-application,node-service}.yml .moon/tasks/
cp "$REF"/.vscode/{extensions,settings}.json .vscode/
cp "$REF"/.github/workflows/ci.yml .github/workflows/
cp "$REF"/scripts/{check-security,assert-tsgolint-lockstep,install-hooks,clean}.mjs scripts/
cp "$REF"/scripts/lib/postgres-container.mjs scripts/lib/
```

Remove this repository's publishing tools from the root manifest, and keep the gate tools:

```sh
npm pkg set name=acme
npm pkg delete license scripts.changeset scripts.changeset:publish scripts.changeset:version
npm pkg delete devDependencies.@arethetypeswrong/cli devDependencies.@changesets/changelog-github devDependencies.@changesets/cli
npm pkg delete devDependencies.publint devDependencies.drizzle-kit devDependencies.drizzle-orm devDependencies.pg devDependencies.@littleorgans/db-tools
```

In `pnpm-workspace.yaml`, add the packages to the top of `catalog:`. They move together, because
every release publishes them all at one version:

```yaml
catalog:
  "@littleorgans/auth": "^0.1.0"
  "@littleorgans/auth-http": "^0.1.0"
  "@littleorgans/auth-tanstack": "^0.1.0"
  "@littleorgans/db": "^0.1.0"
  "@littleorgans/db-tools": "^0.1.0"
  "@littleorgans/theme": "^0.1.0"
  "@littleorgans/ui": "^0.1.0"
  "@littleorgans/views": "^0.1.0"
  "@littleorgans/vite-config": "^0.1.0"
  # ...the reference's third-party pins stay below
```

The rest of that file is policy: build-script approval, the one-day `minimumReleaseAge`, the
trust policy and the audit level. Keep it. The named `catalogs:` hold this repository's peer
ranges and are unused here. The one-day wait also applies to `@littleorgans/*`. To install a
release on the day it ships, list it under `minimumReleaseAgeExclude` (for example
`"@littleorgans/auth@0.1.0"`), and remove the entry afterwards.

Write the root `tsconfig.json`. `moon sync` fills in its references:

```json
{
  "extends": "./tsconfig.options.json",
  "files": [],
  "references": [],
  "compilerOptions": {
    "outDir": ".moon/cache/types"
  }
}
```

Write the root `moon.yml`. It holds the workspace-wide gates. They run once for the whole
workspace, not once per project:

```yaml
# The repository root as a project: the workspace-wide gates run once, not per project.
layer: "application"

# A task holder, not a TypeScript project, so it inherits none of .moon/tasks/node.yml.
workspace:
  inheritedTasks:
    include: []
  mergeStrategies:
    fileGroups: "replace"

fileGroups:
  sources:
    - ".moon/**/*"
    - "apps/**/*"
    - "packages/**/*"
    - "services/**/*"
    - "scripts/**/*"
    - "db/**/*"
    - "!.moon/cache/**/*"
    - "!.moon/docker/**/*"
    - "!**/node_modules/**/*"
    - "!**/dist/**/*"
    - "!**/.output/**/*"
    - "!**/build/**/*"
    - "!**/out/**/*"
    - "!**/coverage/**/*"
    - "!**/*.tsbuildinfo"
    - "package.json"
    - "pnpm-workspace.yaml"
    - "tsconfig.json"
    - "tsconfig.options.json"
  configs: []
  tests: []

tasks:
  clean:
    type: "run"
    script: "node scripts/clean.mjs && moon clean"
    options:
      cache: false
      runInCI: false

  tsgolint-lockstep:
    type: "test"
    command: "node scripts/assert-tsgolint-lockstep.mjs"
    inputs:
      - "package.json"
      - "pnpm-workspace.yaml"
      - "scripts/assert-tsgolint-lockstep.mjs"
    options:
      shell: false
      runInCI: "always"

  lint:
    type: "test"
    command: "oxlint --type-aware --deny-warnings --no-error-on-unmatched-pattern"
    inputs:
      - "@globs(sources)"
      - ".oxlintrc.json"
    options:
      shell: false
      runInCI: "always"

  lint-fix:
    type: "run"
    command: "oxlint --type-aware --fix --no-error-on-unmatched-pattern"
    options:
      shell: false
      cache: false
      runInCI: false

  format-check:
    type: "test"
    command: "oxfmt --check --no-error-on-unmatched-pattern"
    inputs:
      - "@globs(sources)"
      - "*"
      - ".*"
      - "docs/**/*"
      - ".github/**/*"
      - ".vscode/**/*"
    options:
      shell: false
      runInCI: "always"

  format:
    type: "run"
    command: "oxfmt --no-error-on-unmatched-pattern"
    options:
      shell: false
      cache: false
      runInCI: false

  project-refs:
    type: "test"
    script: "test ! -f tsconfig.json || tsc --build --pretty --dry"
    inputs:
      - "apps/*/tsconfig*.json"
      - "packages/*/tsconfig*.json"
      - "services/*/tsconfig*.json"
      - "tsconfig.json"
      - "tsconfig.options.json"
    options:
      runInCI: "always"

  secrets:
    type: "test"
    command: "node scripts/check-security.mjs"
    inputs:
      - "@globs(sources)"
      - "/.github/**/*"
      - "/.env.example"
      - "/.npmrc"
      - "/.secretlintrc.json"
      - "/.secretlintignore"
    options:
      shell: false
      cache: false
      runInCI: "always"

  audit:
    type: "test"
    command: "pnpm audit"
    inputs:
      - "/package.json"
      - "/pnpm-lock.yaml"
      - "/pnpm-workspace.yaml"
    options:
      shell: false
      cache: false
      runInCI: "always"

  # Applies db/migrations to a scratch database and runs rls-verify from @littleorgans/db-tools
  # against it. Skipped locally without Docker; CI always runs it. Delete it if there is no db/.
  rls-verify:
    type: "test"
    command: "node scripts/rls-verify.mjs"
    inputs:
      - "db/migrations/**/*"
      - "db/rls-seed.sql"
      - "scripts/rls-verify.mjs"
      - "scripts/lib/postgres-container.mjs"
      - "package.json"
      - "pnpm-lock.yaml"
    options:
      shell: false
      cache: false
      runInCI: "always"
```

Write a short `AGENTS.md` that points agents at the skills and the reference:

```md
# AGENTS.md

This project is built on the `@littleorgans/*` packages. Moon owns the task graph and pnpm owns
the packages. `moon ci` is read only and is what CI runs. `just check` repairs formatting and lint.

- Starting or extending the project: the `lilo/build/start-project` skill.
- The glue in `apps/*/src/server/` and `services/*/src/server/` came from
  https://github.com/littleorgans/lilo-moon-template at the tag matching the installed
  `@littleorgans/*` version. Compare against that tag, not `main`.
```

Moon needs a commit before it can run. Commit now, before the first install turns on the Git hooks:

```sh
git add -A
git commit -m "chore: add the workspace root"
```

What each part is for:

| Files                                                                                | Purpose                                                                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `.prototools`, `.moon/workspace.yml`, `.moon/toolchains.yml`                         | The Moon, Node and pnpm pins. `.prototools` also pins Atlas, for `atlas migrate hash`.       |
| `.moon/tasks/node.yml`, `node-application.yml`, `node-service.yml`                   | Tasks every project inherits: typecheck and tests, plus build, dev, preview or start by tag. |
| `moon.yml`, `scripts/`                                                               | The workspace-wide gates, and the Postgres container they run against.                       |
| `package.json`, `pnpm-workspace.yaml`, `.npmrc`                                      | Tool versions, the catalog, and the supply-chain policy.                                     |
| `tsconfig.options.json`, `vitest.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`       | Compiler, test and coverage floor, lint and format settings shared by every project.         |
| `.secretlintrc.json`, `.secretlintignore`, `lefthook.yml`, `commitlint.config.js`    | Secret scanning, the pre-commit subset of the gates, and Conventional Commits.               |
| `.github/workflows/ci.yml`, `renovate.json`, `justfile`, `.editorconfig`, `.vscode/` | CI runs `moon ci`, dependency updates, command aliases, and editor settings.                 |

A project now owns `packageManager`, `engines`, the catalog pins and the Moon version. Upgrade
them together: `.prototools` and `versionConstraint` must name the same Moon version, and
`tsgolint-lockstep` fails when `typescript` and `oxlint-tsgolint` disagree.

## 4. Add the web app

Copy the reference app:

```sh
mkdir -p apps
cp -R "$REF"/apps/web apps/web
```

The whole directory is [the scaffold copy list](../direction.md#e-scaffolding) plus the files
that list imports. All of it is glue that the project now owns:

| Path under `apps/web/`                                     | What it is                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `vite.config.ts`                                           | Plugins, the development port, and `workspaceSourceConfig` from `@littleorgans/vite-config`.          |
| `src/server/auth.ts`                                       | The composition root: `createAuthRuntime` with `organizationPolicy`, `throttle` and `serviceOrigins`. |
| `src/server/throttle.ts`                                   | The in-memory email sign-in throttle (see [Operate it](#8-operate-it)).                               |
| `src/server/database.ts`                                   | The pool, built lazily from `DATABASE_URL`, and `null` without one.                                   |
| `src/server/theme.ts`                                      | The theme cookie, and the Origin-checked `/api/theme` handler.                                        |
| `src/routes/(auth)/`, `src/routes/api/auth/`               | The OAuth callback, the email code page and the session error page, plus sign-in, email and sign-out. |
| `src/routes/__root.tsx`, `index.tsx`, `app.tsx`            | The document shell, the sign-in page and the signed-in page.                                          |
| `src/features/workspace/`                                  | The signed-in page's loader and view. Replace it with your own first feature.                         |
| `src/routes/theme.tsx`, `src/routes/api/theme.ts`          | Optional: the `/theme` reference page and its POST route.                                             |
| `src/router.tsx`, `src/routeTree.gen.ts`, `src/styles.css` | The router, its generated route tree (rewritten by every build), and the stylesheet registrations.    |
| `tests/`                                                   | The route, wiring and feature tests. The coverage floor is per file, so copy them all.                |

Keep `/theme` for the first green run. Removing it later means deleting its two routes, running
`moon run web:build` to regenerate `routeTree.gen.ts`, and updating the tests that name those
routes. `moon run web:typecheck web:test` lists them.

Three files carry this repository's workspace wiring. Replace them. `apps/web/package.json`:

```json
{
  "name": "@acme/web",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
```

`apps/web/moon.yml`, with the preview port you chose. It has no `dependsOn`, because the libraries
are installed now, not built in this workspace:

```yaml
language: "typescript"
layer: "application"
tags: ["web-app"]

tasks:
  preview:
    # Match server.port in vite.config.ts, so dev and preview share one OAuth callback.
    env:
      PORT: "5199"
```

`apps/web/tsconfig.json`, which is the reference's without its project references:

```json
{
  "extends": "../../tsconfig.options.json",
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx", "vite.config.ts"],
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "verbatimModuleSyntax": false,
    "outDir": "../../.moon/cache/types/apps/web"
  }
}
```

Install. `@littleorgans/db` takes `drizzle-orm`, `pg` and `@types/pg` as peers, and
`@littleorgans/ui` takes `tailwindcss`. The app supplies all four, so each package uses the app's
single copy:

```sh
pnpm install
pnpm add --filter @acme/web @littleorgans/auth@catalog: @littleorgans/auth-tanstack@catalog: @littleorgans/db@catalog: @littleorgans/theme@catalog: @littleorgans/ui@catalog: @littleorgans/views@catalog: @tanstack/react-router@catalog: @tanstack/react-start@catalog: react@catalog: react-dom@catalog: drizzle-orm@catalog: pg@catalog:
pnpm add --filter @acme/web -D @littleorgans/vite-config@catalog: @tailwindcss/vite@catalog: @types/node@catalog: @types/pg@catalog: @types/react@catalog: @types/react-dom@catalog: @vitejs/plugin-react@catalog: nitro@catalog: tailwindcss@catalog: vite@catalog:
pnpm peers check
```

The first `pnpm add` warns about peers, and the second one supplies them. `pnpm peers check` must
print `No peer dependency issues found`.

Now set `organizationPolicy` in `apps/web/src/server/auth.ts`. Replace the page title and copy in
`src/routes/__root.tsx` and `src/routes/index.tsx`.

## 5. Claim the ports and register the callback

- **Development:** `server.port` in `apps/web/vite.config.ts` (`5199` in the reference, with
  `strictPort`, so a busy port fails rather than moving).
- **Preview:** `PORT` under `tasks.preview.env` in `apps/web/moon.yml`. Keep it equal to the
  development port so that one callback serves both.
- **Callback:** `WORKOS_REDIRECT_URI` is `http://localhost:<port>/callback` locally and your
  public `https://` URL in production. Register each one on the WorkOS application under
  **Redirects**, including the port. A mismatch fails at the provider with an error that points at
  the wrong system.
- **Several apps:** give each one its own port and callback. Auth cookies are namespaced by client
  id and redirect URI, and the theme cookie by origin, so apps on one host do not overwrite each
  other's cookies.
- **Postgres:** the gates' container name and port are derived from the checkout's absolute path,
  so separate clones and worktrees get separate containers. Set `LILO_PG_PORT` when that port is
  taken. Run `just clean` before you change it for an existing container.

## 6. Set up the database

Skip this step if the app has no database.

### In the project

Take the identity migrations from the installed `@littleorgans/db` into the project's own
`db/migrations/`, where the project's own migrations will join them. Take the Atlas desired-state
schema from the reference. Then add `rls-verify`:

```sh
mkdir -p db/migrations
cp apps/web/node_modules/@littleorgans/db/migrations/* db/migrations/
cp "$REF"/db/schema.sql db/
pnpm add -Dw @littleorgans/db-tools@catalog: pg@catalog:
```

`db/migrations/` now holds the two identity migrations and their `atlas.sum`. `db/schema.sql`
holds `accounts` and `profiles`, the user entity described in
[The user entity](../user-entity.md).

Write `db/rls-seed.sql`, so that the claim checks have rows to hide:

```sql
-- One row per table, so rls-verify's claim checks have rows to hide. Runs as the server login,
-- which bypasses row level security, in a scratch database rls-verify drops afterwards.
INSERT INTO accounts (workos_org_id) VALUES ('org_seed');
INSERT INTO profiles (workos_user_id) VALUES ('user_seed');
```

Write `scripts/rls-verify.mjs`, the script the root `rls-verify` task runs:

```js
// Runs @littleorgans/db-tools' rls-verify against a scratch copy of db/migrations, in the Postgres
// container scripts/lib/postgres-container.mjs manages for this checkout. Skipped locally without
// Docker; CI, which sets CI, fails instead.
import { spawnSync } from "node:child_process";

import { dockerIsAvailable, withPostgres } from "./lib/postgres-container.mjs";

if (!process.env.CI && !dockerIsAvailable()) {
  process.stdout.write("rls-verify skipped locally: Docker is unavailable; CI will run it.\n");
  process.exit(0);
}

await withPostgres("rls-verify", (databaseUrl) => {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "rls-verify",
      "--disposable",
      "--migrations",
      "db/migrations",
      "--seed",
      "db/rls-seed.sql",
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
});
```

### In a real database

To set up a real database (Postgres 16 or later), follow
[the db package's setup](../../packages/db/README.md#set-up-the-database), reading the migrations
from `db/migrations/` instead of `node_modules`. As the migration owner:

```sh
(
  export LC_ALL=C
  for file in db/migrations/*.sql; do
    psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$file" || exit
  done
)
psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE acme_web LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;"
psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "\\password acme_web"
psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v login_role=acme_web \
  -f apps/web/node_modules/@littleorgans/db/grants/login-role.sql
```

The last command runs `GRANT authenticated TO acme_web WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`.
Without it, every scoped query fails with `permission denied to set role "authenticated"`
(SQLSTATE `42501`). The app's `DATABASE_URL` names `acme_web`. It never names the migration owner
or a superuser, because either one bypasses the policies. Then prove the policies hold in that
database, connected as `acme_web`:

```sh
DATABASE_URL="postgres://acme_web:…@host:5432/app" pnpm exec rls-verify
```

When you add a table, add a migration file to `db/migrations/` that enables and forces row level
security and creates the table's policies. Then run `atlas migrate hash --dir file://db/migrations`.
The `rls-verify` gate fails on any `public` table that is not forced. Atlas and Drizzle wrappers
arrive with `db-tools` in phase 2. The workflow this repository uses in the meantime is in
[Maintain this repository](../maintaining.md#the-database-is-baseline-not-an-exemplar).

## 7. Reach the first green `moon ci`

```sh
pnpm install
moon sync
moon run root:format
moon run web:typecheck web:build web:test
git add -A
git commit -m "feat: add the web app"
moon ci
```

`moon sync` adds `apps/web` to the root `tsconfig.json` references. `root:format` rewrites the
files that the edits above left unformatted. `moon ci` then runs typecheck, build, coverage, lint,
format, secrets, audit, the lockstep and reference checks, and `rls-verify`. Nothing may fail.
CI runs the same command from `.github/workflows/ci.yml`.

Set the environment:

```sh
cp .env.example .env.local
```

Fill in `.env.local`: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI` (step 5), and a
random `WORKOS_COOKIE_PASSWORD` of at least 32 characters (`openssl rand -base64 32` prints one).
Set `DATABASE_URL` to the login role from step 6, or delete the line if there is no database.
Then run the app:

```sh
moon run web:dev
```

Moon loads `.env.local` for `dev` and `preview`. Vite does not, so running `vite`
directly starts without it. `loadAuthConfig`
([`packages/auth-session/src/config.ts`](../../packages/auth-session/src/config.ts)) validates the
values on the first request that needs them. It names every missing variable at once, refuses a
cookie password under 32 characters, and refuses a non-HTTPS redirect URI except on localhost. The
comments in `.env.example` describe the reference repository, and the variable names are the same.

Sign in once with Google and once with an emailed code, and land on `/app`. `moon run web:preview`
serves the production build on the preview port.

## 8. Operate it

### Email sign-in throttle and the per-address lockout

`createAuthRuntime` requires a `throttle`, and the packages ship none. Before the email start and
verify steps call WorkOS, they ask the throttle about two keys, in order: the client, then the
lower-cased address. The address on the verify step is the one the code was sent to. The first
refusal becomes a 429 page with `Retry-After`, and the remaining keys are not asked. An address
over 254 characters is refused with 400 before the throttle sees it. A throttle that throws fails
the request. See
[`packages/auth-session/src/throttle.ts`](../../packages/auth-session/src/throttle.ts) and
[`email.ts`](../../packages/auth-session/src/email.ts).

The copied `apps/web/src/server/throttle.ts` counts in fixed ten-minute windows, in process memory:

| Step           | Per client    | Per address   |
| -------------- | ------------- | ------------- |
| `email-start`  | 10 per 10 min | 3 per 10 min  |
| `email-verify` | 30 per 10 min | 10 per 10 min |

What that means in operation:

- **Per-address lockout.** Once an address has used its budget, every request for that address
  gets 429 until its window reopens, whoever sends it. That cap is what bounds guessing a six-digit
  code. It also means anyone can block email sign-in for an address for up to ten minutes by
  spending its budget. Google sign-in is unaffected.
- **One instance only.** Every instance counts on its own, so N instances allow N times each
  budget, and a restart forgets every count. Before you run a second instance, replace
  `memoryThrottle` with a `Throttle` over a shared store such as Redis or your database, keeping
  the same keys and limits. If something in front of the app already limits these routes, pass a
  throttle that always allows.
- **Who the client is.** `clientOf` reads the socket address, `getRequestIP()`. Behind a proxy that
  address is the proxy's, so every visitor shares one budget. Use
  `getRequestIP({ xForwardedFor: true })` only when a proxy you control overwrites that header.
- **Knobs.** `memoryThrottle({ clientOf, limits, now })`: `limits` takes the same shape as
  `EMAIL_LIMITS`, attempts and window per step and key. The `Throttle` type is the contract for a
  replacement.

### Origin checks

Every state-changing POST that the packages handle (email start, email verify and sign-out)
answers 403 unless the request's `Origin` exactly equals the app's own origin. A missing `Origin`
is refused too. The app's origin comes from `WORKOS_REDIRECT_URI`, not from the request, so behind
a proxy that terminates TLS the redirect URI must be the public `https://` URL. Do not serve pages
with `Referrer-Policy: no-referrer`, which makes browsers send `Origin: null`. Any POST route you
add yourself calls `refuseCrossOrigin(request, auth.origin())` from `@littleorgans/auth-tanstack`
first, as `apps/web/src/server/theme.ts` does for `/api/theme`. See
[`packages/auth-session/src/origin.ts`](../../packages/auth-session/src/origin.ts).

### Calling a service

`auth.asUser().fetch` sends the signed-in person's token only to origins listed in
`serviceOrigins`. [Adopt the packages in a service](adopt-service.md#7-call-it-from-the-web-app)
covers the setup.

## Upgrade

Every release publishes all the packages at one version. Change the `@littleorgans/*` catalog
entries together, run `pnpm install`, and read the changelog of each package for "action
required" notes, which are glue changes to make by hand. Compare your glue against the reference
at the new tag (step 2), not against `main`.
