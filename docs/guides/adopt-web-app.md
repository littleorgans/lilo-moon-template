# Adopt the packages in a web app

> Release status: these instructions target the upcoming `0.2.0` release, which includes typed
> database schemas, the full database tools and `@littleorgans/create-app`. Run the registry/tag
> commands after that release exists. For the published `0.1.0`, use the guide at `v0.1.0`: it
> copies the glue by hand and has no typed schema option.

This guide starts a new project with a TanStack Start web app on the published
`@littleorgans/*` packages at `^0.2.0`. `@littleorgans/create-app` writes the project: the
workspace root, the web app and, if you want one, the database. The project installs the packages
from npm and owns every file it was given. Fixes reach it through package upgrades, not through
running the command again.

The command does the deterministic writing. This guide covers the decisions it asks you for and
the steps it leaves to you, in order. For a TypeScript service, alone or beside the web app, see
[Adopt the packages in a service](adopt-service.md). The `lilo/build/start-project` skill
([`skills/lilo/build/start-project/SKILL.md`](../../skills/lilo/build/start-project/SKILL.md))
covers the judgment calls.

The commands name the project `acme` and the app `web`. The app's directory name is also its
Moon project id, so `apps/portal` runs as `portal:build`.

## 0. Decide first

Each decision is a flag. Nothing here has a default that hides it: the command requires the
organization policy, and it prints every default it takes.

- **Organization policy** (`--organization-policy`). `personal` gives every new user their own
  organization at first sign-in. `existing` leaves membership to you. It is written to
  `organizationPolicy` in `apps/<name>/src/server/auth.ts`.
- **Ports** (`--web-port`, default `5199`, the reference's). Pick the web app's port now, because
  the OAuth callback you register depends on it (step 3). Development and preview share it.
- **Database** (`--db`). The web app signs people in without one. Without `--db`, skip step 5.
- **Web app, service, or both** (`--web`, `--service`). A service lives in the same workspace
  under `services/<name>/` and always has the database
  ([Adopt the packages in a service](adopt-service.md)).
- **Names** (`--web-name`, default `web`, and `--name`, default the directory's name). `--name` is
  the root package name and the scope of the project's own packages, such as `@acme/web` and
  `@acme/drizzle-schema`. Complete package names, including their scope, must fit npm's
  214-character limit. With a database, the generated login roles must also fit Postgres's
  63-character limit.

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

Moon's Node and pnpm serve its tasks. `pnpm create` and the install in step 2 run outside Moon, so
a Node `24` and a pnpm `11` must also be on your `PATH`. Any version manager will do.

## 2. Create the project

```sh
pnpm create @littleorgans/app acme --web --organization-policy personal --web-port 5199 --db
```

`npm create @littleorgans/app acme -- --web …` does the same; npm passes flags to the command only
after `--`. At a terminal, the command asks for any choice step 0 lists that has no default. In a
script it fails and names each missing flag instead. [Its README](../../packages/create-app/README.md)
lists every option.

It writes into a new or empty directory and prints what it took by default and the steps that
follow. Nothing is installed or committed yet. Follow the printed steps, which are the ones below:
commit, then install, which turns on the Git hooks, then commit the lockfile.

```sh
cd acme
git init -b main && git add -A && git commit -m "chore: start from @littleorgans/create-app"
pnpm install
git add pnpm-lock.yaml && git commit -m "chore: lock dependencies"
```

Moon needs a commit before it can run. The first install sets up the hooks, which call Moon.

pnpm waits a day before installing a newly published version (`minimumReleaseAge` in
`pnpm-workspace.yaml`), and that applies to `@littleorgans/*` too. To install a release on the day
it ships, list it under `minimumReleaseAgeExclude` (for example `"@littleorgans/auth@0.2.0"`), and
remove the entry afterwards.

### Add an app to an existing repository

Generate a scratch project with the destination's `--name` and the new app's name and flags.
Move `apps/<name>/` and, if absent, `db/drizzle/` into the destination. Compare and merge the
workspace globs, catalog entries, root development dependencies, `.moon/tasks/` layers,
`tsconfig.options.json`, Vitest and lint configuration, formatter internal import scope,
`.gitignore` environment rules, and `.env.example` variables. An existing Moon workspace already
has many of these; preserve its policy and other projects. Add the database pieces from step 5
only when needed. Run `pnpm install`, `moon sync` (which updates project references), then
`moon ci --force`. Register the new callback and configure the ignored environment as below.

### What it wrote

The files come from this repository at the release tag: the reference app, the typed schema
package, the workspace root and the migrations `@littleorgans/db` ships. The build of
`@littleorgans/create-app` generates them from that commit, and `root:published-shape` runs each
kind of project it writes through its own first `moon ci --force` before a release, so they cannot
drift from the reference. What differs from the reference is what tied it to this repository:
`workspace:` dependencies become `catalog:` pins at the release, the names, ports and organization
policy become yours, and this repository's publishing tools, tests and documentation stay behind.

| Files                                                                                           | Purpose                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.prototools`, `.moon/workspace.yml`, `.moon/toolchains.yml`                                    | The Moon, Node and pnpm pins. `.prototools` also pins Atlas, for `atlas migrate hash`.                                                              |
| `.moon/tasks/node.yml`, `node-library.yml`, `node-application.yml`, `node-service.yml`          | Tasks every project inherits: typecheck and tests, plus build, dev, preview or start by kind.                                                       |
| `moon.yml`, `scripts/`                                                                          | The workspace-wide gates (lint, format, secrets, audit, lockstep, references, and with `--db` the database gates), and the scripts two of them run. |
| `package.json`, `pnpm-workspace.yaml`, `.npmrc`                                                 | Tool versions, the catalog with every `@littleorgans/*` package at `^0.2.0`, and the supply-chain policy.                                           |
| `tsconfig.json`, `tsconfig.options.json`, `vitest.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json` | Project references, and the compiler, test and coverage, lint and format settings shared by every project.                                          |
| `.secretlintrc.json`, `.secretlintignore`, `lefthook.yml`, `commitlint.config.js`               | Secret scanning, the pre-commit subset of the gates, and Conventional Commits.                                                                      |
| `.github/workflows/ci.yml`, `renovate.json`, `justfile`, `.editorconfig`, `.vscode/`            | CI runs `moon ci` through this repository's workflow at `v0.2.0`, dependency updates, aliases, editor settings.                                     |
| `.env.example`, `.gitignore`, `AGENTS.md`                                                       | The variables the project reads, what Git ignores, and a pointer for agents to the skills and the reference.                                        |
| `db/drizzle/`                                                                                   | The typed Drizzle schema as a workspace package, `@acme/drizzle-schema`, which the app queries through.                                             |

`tsconfig.options.json`, `.oxlintrc.json`, `vitest.config.ts`, `renovate.json` and `ci.yml`
extend or call shared pieces from this repository instead of holding the settings themselves.
[Use the shared configuration](shared-config.md) explains each. `.oxfmtrc.json` sorts imports from
the project's own scope (`@acme/`) as internal ones, after the packages.

A project now owns `packageManager`, `engines`, the catalog pins and the Moon version. Upgrade
them together: `.prototools` and `versionConstraint` must name the same Moon version, and
`tsgolint-lockstep` fails when `typescript` and `oxlint-tsgolint` disagree.

The web app, `apps/web/`, is the reference app with the project's names:

| Path under `apps/web/`                                     | What it is                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `vite.config.ts`                                           | Plugins, the development port, and `workspaceSourceConfig` from `@littleorgans/vite-config`.             |
| `moon.yml`                                                 | The `web-app` task layer, and the preview port, equal to the development port.                           |
| `src/server/auth.ts`                                       | The composition root: `createAuthRuntime` with `organizationPolicy`, `throttle` and `serviceOrigins`.    |
| `src/server/throttle.ts`                                   | The in-memory email sign-in throttle (see [Operate it](#7-operate-it)).                                  |
| `src/server/database.ts`                                   | The pool, built lazily from `DATABASE_URL`, and `null` without one, typed by the project's schema.       |
| `src/server/identity.ts`                                   | `ensureIdentityRows`: the caller's `accounts` and `profiles` rows, created just in time.                 |
| `src/server/theme.ts`                                      | The theme cookie, and the Origin-checked `/api/theme` handler.                                           |
| `src/server/product.ts`                                    | The product's name and sign-in copy, and `SHOW_THEME_LAB`, which serves `/theme` on the dev server only. |
| `src/server/startup.ts`                                    | A Nitro plugin that validates the auth environment before the standalone Node server listens.            |
| `src/routes/(auth)/`, `src/routes/api/auth/`               | The OAuth callback, the email code page and the session error page, plus sign-in, email and sign-out.    |
| `src/routes/__root.tsx`, `index.tsx`, `app.tsx`            | The document shell, the sign-in page and the signed-in page.                                             |
| `src/features/workspace/`                                  | The signed-in page's loader and view. Replace it, keeping the `ensureIdentityRows` call.                 |
| `src/routes/theme.tsx`, `src/routes/api/theme.ts`          | Optional: the `/theme` reference page, 404 in a production build, and its POST route.                    |
| `src/router.tsx`, `src/routeTree.gen.ts`, `src/styles.css` | The router, its generated route tree (rewritten by every build), and the stylesheet registrations.       |
| `tests/`                                                   | The route, wiring and feature tests. The coverage floor is per file, so keep them with the files.        |

`@littleorgans/db` takes `drizzle-orm`, `pg` and `@types/pg` as peers, and `@littleorgans/ui`
takes `tailwindcss`. The app's manifest supplies all four, so each package uses the app's single
copy. `pnpm peers check` prints `No peer dependency issues found`.

Keep `/theme` for the first green run. Removing it later means deleting its two routes, running
`moon run web:build` to regenerate `routeTree.gen.ts`, and updating the tests that name those
routes. `moon run web:typecheck web:test` lists them.

Replace the product's name and sign-in copy in `apps/web/src/server/product.ts`; the routes and
tests read them from there. This module is public data bundled for the browser as well as SSR:
never put secrets or service imports in it. To serve the theme lab in production, set
`SHOW_THEME_LAB` to `true` there; it is then public, so add your product's access checks if it
should not be. `/api/theme` remains available for product theme controls and redirects to `/`
when no same-origin referer is supplied.

## 3. Claim the ports and register the callback

- **Development:** `server.port` in `apps/web/vite.config.ts` (`--web-port`, with `strictPort`, so
  a busy port fails rather than moving).
- **Preview:** `PORT` under `tasks.preview.env` in `apps/web/moon.yml`. The command writes the same
  port there, so one callback serves both. Keep them equal.
- **Callback:** `WORKOS_REDIRECT_URI` is `http://localhost:<port>/callback` locally and your
  public `https://` URL in production. Register each one on the WorkOS application under
  **Redirects**, including the port. A mismatch fails at the provider with an error that points at
  the wrong system. Only you can register it, and sign-in fails until you do.
- **Several apps:** give each one its own port and callback. Auth cookies are namespaced by client
  id and redirect URI, and the theme cookie by origin, so apps on one host do not overwrite each
  other's cookies.
- **Postgres:** the database gates (step 5) run in a container that `db-tools` names and ports
  after the checkout's absolute path, so separate clones and worktrees get separate containers.
  Set `LILO_PG_PORT` when that port is taken. Run `just clean` before you change it for an
  existing container. Unlabelled containers from the old scripts still run the gates, but cleanup
  refuses to delete them; inspect and remove them manually when they are disposable.

## 4. Set the environment

```sh
cp .env.example .env.local
```

Fill in `.env.local`: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_REDIRECT_URI` (step 3), and a
random `WORKOS_COOKIE_PASSWORD` of at least 32 characters (`openssl rand -base64 32` prints one).
With a database, set `DATABASE_URL` to the login role from step 5. Without one, `.env.example` has
no `DATABASE_URL`, and the app's `database()` is `null`.

Moon loads `.env.local` for `dev` and `preview`. Vite does not, so running `vite`
directly starts without it. `loadAuthConfig`
([`packages/auth-session/src/config.ts`](../../packages/auth-session/src/config.ts)) validates the
values. It names every missing variable at once, refuses a cookie password under 32 characters,
and refuses a non-HTTPS redirect URI except on localhost. The standalone Node server that
`moon run web:preview` runs checks it before it listens (`src/server/startup.ts`) and exits on a
bad value, so a deploy fails instead of its first request. Other Nitro presets may initialize
plugins on a cold request; this repository does not claim a pre-listen guarantee for them, so
verify startup and readiness when adopting another preset. The dev server skips the check only
when every auth value is absent or empty, so the UI runs without credentials; a partial or invalid
configuration fails it in development too. Errors name the variable without printing its value,
including a malformed redirect URI.
The generated `WORKOS_COOKIE_PASSWORD` is empty, so copying the example unchanged fails
validation. Generate a fresh secret with `openssl rand -base64 32` and set it only in `.env.local`.
Leave `WORKOS_COOKIE_PASSWORD_PREVIOUS` empty until you rotate the cookie password.

## 5. Set up the database

Skip this step if the app has no database. To add one to a project created without `--db`, create
a scratch project with the same names and `--db`, and move its `db/migrations/`, `db/schema.sql`,
`db/rls-seed.sql` across. Merge the database tasks and `clean` change from root `moon.yml`, the
root development dependencies, any missing catalog entries from `pnpm-workspace.yaml`, and the
database paragraph of `.env.example`. Preserve your existing tasks, dependencies, secrets and
migrations; do not replace root files wholesale. Run `pnpm install`, `moon sync` and `moon ci --force`.

### What `--db` wrote

- `db/migrations/`: the two identity migrations `@littleorgans/db` ships, and their `atlas.sum`.
  The project's own migrations join them here.
- `db/schema.sql`: the Atlas desired state, holding `accounts` and `profiles`, the user entity
  described in [The user entity](../user-entity.md).
- `db/rls-seed.sql`: one row per table, so the `rls-verify` claim checks have rows to hide. Add a
  row for every table you add.
- In the root `package.json`: `@littleorgans/db-tools`, its `pg` peer, and `drizzle-kit`.
- In the root `moon.yml`: the database tasks below, and a `clean` task that also removes the
  checkout's Postgres container.

| Task                    | Runs                                         | In `moon ci` |
| ----------------------- | -------------------------------------------- | ------------ |
| `root:atlas-diff`       | `db-tools atlas-diff`                        | No           |
| `root:atlas-lint`       | `db-tools atlas-lint`                        | Yes          |
| `root:atlas-apply`      | `db-tools atlas-apply`                       | No           |
| `root:drizzle-generate` | `db-tools drizzle-generate`                  | No           |
| `root:drizzle-check`    | `db-tools drizzle-check`                     | Yes          |
| `root:rls-verify`       | `db-tools rls-verify --seed db/rls-seed.sql` | Yes          |

Every one uses the `db-tools` defaults `db/migrations`, `db/schema.sql` and
`db/drizzle/_generated`. `db/schema.sql` is the applicability boundary: without it every task
skips before Docker or Atlas starts. The three checks skip locally without Docker and say so. In
CI, which sets `CI`, they fail instead. They are `cache: false` because the database is not a file
input: a cached pass would stand in for a run that never happened. `atlas-lint` lints the
migrations added since `MOON_BASE`, which `.github/workflows/ci.yml` sets to the pull request's
base, or the latest migration without it.

The gates need Docker, Atlas and drizzle-kit. `.prototools` pins Atlas, so `proto install` puts it
on `PATH`, and `drizzle-kit` is a root development dependency.
[The db-tools README](../../packages/db-tools/README.md#install) says why each one is installed the
way it is.

`db/drizzle/_generated/schema.ts` is the typed Drizzle schema of those migrations. `drizzle-check`
keeps it honest, and `moon run root:drizzle-generate` rewrites it after your migrations change.
Commit it, and never edit it by hand. The app imports it as `@acme/drizzle-schema`, and
`createDatabase({ connectionString, schema })` types every scoped transaction by it. It records
tables and columns, not security: `rls-verify` is the authority on the policies.

### In a real database

To set up a real database (Postgres 16 or later), follow
[the db package's setup](../../packages/db/README.md#set-up-the-database), reading the migrations
from `db/migrations/` instead of `node_modules`. The command printed these steps with your names.
As the migration owner:

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

To add a table, add it to `db/schema.sql` and run `moon run root:atlas-diff`, which writes the
versioned migration. Atlas does not model row level security, so add a hand-written migration that
enables and forces it and creates the table's policies, then run
`atlas migrate hash --dir file://db/migrations`. Add a row to `db/rls-seed.sql`, and finish with
`moon run root:drizzle-generate`. The `rls-verify` gate fails on any `public` table that is not
forced. `moon run root:atlas-apply` applies pending migrations to the database in `DATABASE_URL`.

## 6. Reach the first green `moon ci`

```sh
moon ci --force
```

`--force` runs every task, where a plain `moon ci` checks only what the last commit touched. It
runs typecheck, build, coverage, lint, format, secrets, audit, the lockstep and reference checks,
and, with a database, `atlas-lint`, `drizzle-check` and `rls-verify`. Nothing may fail, and nothing
needs fixing first: before a release, `published-shape` runs a web app, a service and both through this same first run. Without Docker the database checks
skip locally and say so; CI runs them. CI runs `moon ci` from `.github/workflows/ci.yml`.

Then run the app:

```sh
moon run web:dev
```

Sign in once with Google and once with an emailed code, and land on `/app`. `moon run web:preview`
serves the production build on the preview port.

## 7. Operate it

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
`serviceOrigins`. [Adopt the packages in a service](adopt-service.md#6-call-it-from-the-web-app)
covers the setup.

### Rotating the cookie password

Changing `WORKOS_COOKIE_PASSWORD` on its own signs everyone out. To rotate without that, make the
new password current and list the old one in `WORKOS_COOKIE_PASSWORD_PREVIOUS`. With more than one
instance, first deploy the new password as a previous one. Remove the old password only once the
application's WorkOS **Maximum session length** has passed since the last instance sealing with it
stopped, using the longest value that setting has held meanwhile, and at most a year. The
[auth-session README](../../packages/auth-session/README.md#rotate-the-cookie-password) gives the
steps and why each is timed as it is. A leaked password is replaced outright, never listed as
previous.

## Upgrade

Every release publishes all the packages at one version. Change the `@littleorgans/*` catalog
entries and the `moon-ci.yml` tag together (the `littleorgans` Renovate group does), run
`pnpm install`, and read the changelog of each package for "action required" notes, which are glue
changes to make by hand. Compare your glue against the reference at the new tag, not against
`main`. Running `@littleorgans/create-app` again writes a new project; it never updates one.
