# @littleorgans/create-app

Starts a new project on the published `@littleorgans/*` packages: a Moon workspace with a
TanStack Start web app, a TypeScript HTTP service, or both, and optionally Postgres with its
migrations and database gates.

```sh
pnpm create @littleorgans/app acme --web --organization-policy personal --db
npm create @littleorgans/app acme -- --web --organization-policy personal --db
```

The project then owns every file. Fixes reach it through package upgrades, not by running this
again. Requires Node.js 24.19 or later.

## What it writes

The files come from the reference app, the reference service and the workspace root in
[littleorgans/lilo-moon-template](https://github.com/littleorgans/lilo-moon-template), at the
release this package belongs to. Its build generates them from that commit, and the release checks
that each kind of project it writes passes its own `moon ci`. The template is never edited by hand.

- **Every project:** the workspace root (Moon, pnpm, TypeScript, lint, format, secrets, hooks,
  Renovate, the CI caller), a short `AGENTS.md`, and the typed Drizzle schema package in
  `db/drizzle/`, which the glue imports.
- **`--web`:** `apps/<name>/`, the TanStack Start app with the sign-in routes and the
  `src/server/` composition root.
- **`--service`:** `services/<name>/`, the Hono service with bearer auth, its tests and its
  `Dockerfile`. A service always gets the database, because `loadServiceConfig` requires
  `DATABASE_URL`.
- **`--db`:** `db/migrations/` with the identity migrations `@littleorgans/db` ships,
  `db/schema.sql`, `db/rls-seed.sql`, and the database tasks in the root `moon.yml`.

Every `@littleorgans/*` package is pinned at this release in the `pnpm-workspace.yaml` catalog, and
`.github/workflows/ci.yml` calls the reusable workflow at the matching `v<version>` tag.

## Options

| Option                           | Meaning                                                                                               | Default                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------ |
| `<directory>`                    | Where to write. It must be new or empty (an empty Git repository is fine).                            | Required                 |
| `--web`                          | Add a web app.                                                                                        |                          |
| `--web-name <name>`              | Its directory under `apps/` and its Moon project id.                                                  | `web`                    |
| `--web-port <port>`              | Its dev and preview port. The OAuth callback you register names it.                                   | The reference's, `5199`  |
| `--organization-policy <policy>` | `personal` gives each new user an organization at first sign-in; `existing` leaves membership to you. | Required with `--web`    |
| `--service`                      | Add a service. Implies `--db`.                                                                        |                          |
| `--service-name <name>`          | Its directory under `services/` and its Moon project id.                                              | `api`                    |
| `--service-port <port>`          | Its `PORT` for `dev` and `start`.                                                                     | The reference's, `8787`  |
| `--db`, `--no-db`                | Add Postgres.                                                                                         | None for a web app alone |
| `--name <name>`                  | The root package name and the scope of the project's own packages (`@<name>/web`).                    | The directory's name     |

Names are lowercase letters, digits and dashes, starting with a letter. Every choice is a flag, so
a script or an agent runs it without a terminal. At a terminal it asks only for what has no
default: the directory, what to create, the organization policy, and whether a web app alone gets
a database. It prints every default it took, with the flag that changes it.

Nothing is installed or committed. The command ends by printing the remaining steps: the install
and first commit, the OAuth callback to register, the environment, the database login role and its
grant, and the first `moon ci --force`.
[Adopt the packages in a web app](https://github.com/littleorgans/lilo-moon-template/blob/main/docs/guides/adopt-web-app.md)
explains each step. Read it at the tag that matches the version you installed.

Exit codes: 0 created, 1 failed (for example, the directory is not empty), 2 usage error.
