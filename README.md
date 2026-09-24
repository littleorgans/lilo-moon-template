# lilo-moon-template

A reference implementation of a TypeScript web app and service, and the source of the
`@littleorgans/*` npm packages they are built from. Projects add the packages as dependencies and
follow the reference app and service for the thin glue they own. The name is historical: this is
not a template, and projects do not copy, rename or rebase it.

## Status

`0.1.0` is published. Eleven of the packages below are on npm at that version with provenance,
and the `v0.1.0` tag and GitHub release mark the commit they were built from. `@littleorgans/tsconfig`,
`@littleorgans/oxlint-config` and `@littleorgans/create-app` first publish in `0.2.0`. Every package shares one
version (the Changesets `fixed` group), so install them all at the same version. During `0.x` a
minor release may break. [Releasing the packages](docs/releasing.md) covers how a release is made.

## Packages

| Package                                                                                    | Purpose                                                                                                           | Key peers                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [`@littleorgans/auth`](https://www.npmjs.com/package/@littleorgans/auth)                   | Verifies an identity provider access token and maps its claims to a `Principal`.                                  | none                                               |
| [`@littleorgans/auth-workos`](https://www.npmjs.com/package/@littleorgans/auth-workos)     | WorkOS login flows and identity provider API calls.                                                               | none                                               |
| [`@littleorgans/auth-session`](https://www.npmjs.com/package/@littleorgans/auth-session)   | Sealed session cookies, CSRF state, the redirect sign-in handlers, and calls to services as the signed-in person. | none                                               |
| [`@littleorgans/auth-tanstack`](https://www.npmjs.com/package/@littleorgans/auth-tanstack) | Binds the session to TanStack Start requests, cookies and route options.                                          | `@tanstack/react-start` ^1.168                     |
| [`@littleorgans/auth-http`](https://www.npmjs.com/package/@littleorgans/auth-http)         | Bearer authentication for services on Fetch `Request` and `Response`, a Hono adapter and a config loader.         | `@littleorgans/auth`, `hono` ^4.13 (optional)      |
| [`@littleorgans/db`](https://www.npmjs.com/package/@littleorgans/db)                       | Postgres transactions scoped to a `Principal` by row level security, with the identity migrations and grant.      | `drizzle-orm` ^0.45, `pg` ^8.15, `@types/pg` ^8.15 |
| [`@littleorgans/db-tools`](https://www.npmjs.com/package/@littleorgans/db-tools)           | The `rls-verify` CLI, which proves row level security holds in your own database.                                 | `pg` ^8.15, `@littleorgans/db` (optional)          |
| [`@littleorgans/theme`](https://www.npmjs.com/package/@littleorgans/theme)                 | Typed design token contract, product themes, preferences and the CSS generated from them.                         | none                                               |
| [`@littleorgans/ui`](https://www.npmjs.com/package/@littleorgans/ui)                       | Shared React components: shadcn primitives, layout, typography and the Tailwind entry stylesheet.                 | `react` ^19, `react-dom` ^19, `tailwindcss` ^4     |
| [`@littleorgans/views`](https://www.npmjs.com/package/@littleorgans/views)                 | Screens composed from `ui`, with labels and paths supplied by the application.                                    | `react` ^19, `react-dom` ^19                       |
| [`@littleorgans/vite-config`](https://www.npmjs.com/package/@littleorgans/vite-config)     | Resolves workspace packages to source in an application's Vite config; `./vitest` holds the shared test defaults. | `vite` ^8, `vitest` ^4.1 (optional)                |
| [`@littleorgans/tsconfig`](https://www.npmjs.com/package/@littleorgans/tsconfig)           | The strict compiler options a workspace's `tsconfig.options.json` extends.                                        | none                                               |
| [`@littleorgans/oxlint-config`](https://www.npmjs.com/package/@littleorgans/oxlint-config) | The lint rules a workspace's `.oxlintrc.json` extends, including the feature and route layout rule.               | `oxlint` ^1.79                                     |
| [`@littleorgans/create-app`](https://www.npmjs.com/package/@littleorgans/create-app)       | `pnpm create @littleorgans/app`: writes a new project from the reference app and service at the release.          | none                                               |

[`auth-session`](packages/auth-session/README.md), [`auth-http`](packages/auth-http/README.md),
[`db`](packages/db/README.md), [`db-tools`](packages/db-tools/README.md),
[`tsconfig`](packages/tsconfig/README.md), [`oxlint-config`](packages/oxlint-config/README.md) and
[`create-app`](packages/create-app/README.md) have their own READMEs. [Use the shared configuration](docs/guides/shared-config.md) covers the
config packages, the Renovate preset and the reusable CI workflow together. Applications own their tables,
provisioning and login roles. Payments, CRM, Zustand persistence, Convex, system theme mode, saved
user theme editing and service-to-service identity are not implemented.

## The reference app and service

Both are private and never published. They use the packages from this workspace, not from npm.

`apps/web` is a TanStack Start app. It shows the glue a project owns: grouped routes wire URLs,
named server modules in `src/server/` compose services, and `features/<name>/` owns each feature's
model, UI and server behavior. [Code layout](docs/code-layout.md) is the structure to follow. The
signed-in page shows the session's user and organization and the rows a scoped transaction can see.
`/theme` is a reference page for the components and themes, served by the dev server only. The
product's name and sign-in copy are in `src/server/product.ts`. `organizationPolicy` in
`src/server/auth.ts` selects `personal`, which provisions a personal workspace, or `existing`,
which leaves membership unchanged. `src/styles.css` imports the UI stylesheet and the views source
registration, and registers the app's own sources. Published packages do not scan neighboring
directories.

`services/api` is a Hono service. It authenticates callers with `auth-http` and reads and writes
Postgres through `db` under forced row level security. It answers `GET /health` and
`GET`/`PUT /v1/account`. Its `build`, `dev` and `start` tasks come from the `node-service` Moon
layer in [`.moon/tasks/node-service.yml`](.moon/tasks/node-service.yml): `dev` runs the TypeScript
source through Node's type stripping, and `start` runs the built `dist`. `api:container` builds a
Docker image. [Its README](services/api/README.md) covers configuration, errors, logging and tests.

## Start a project

```sh
pnpm create @littleorgans/app acme --web --organization-policy personal --db
```

`@littleorgans/create-app` writes a new project: the workspace root, a web app, a service or
both, and optionally Postgres, all taken from the reference app and service at the release it
belongs to. The project installs the packages from npm and owns the small amount of glue it was
given. [Adopt the packages in a web app](docs/guides/adopt-web-app.md) and
[Adopt the packages in a service](docs/guides/adopt-service.md) cover the choices it takes as
flags and the steps it leaves to you: the OAuth callback, the environment, the database login role
and the first green `moon ci`. The `lilo/build/start-project` skill
([`skills/lilo/build/start-project`](skills/lilo/build/start-project/SKILL.md)) drives the command
and the judgment calls. Read the guides at the tag that matches the version you install.

## Work in this repository

Follow [AGENTS.md](AGENTS.md). [Maintain this repository](docs/maintaining.md) covers the
toolchain, members, the database baseline and the CI runner. [Releasing the
packages](docs/releasing.md) covers publishing. [The decision record](docs/decisions.md) explains
the tool choices, [the system overview](docs/system-overview.md) maps packages, seams, runtime and
CI, and [the domain model](docs/domain-model.md) defines the terms. [The
direction](docs/direction.md) is the plan that replaced the template with packages, and [the
assessment](docs/assessment.md) is a review from before that change.

### Set up

Install just, proto, and the Moon version in `.prototools`
([Install the tools first](docs/maintaining.md#install-the-tools-first)), then run:

```bash
just setup
pnpm install
just check
just ci
```

### Start locally

Copy `.env.example` to `.env.local` and fill in the WorkOS values. The redirect URI must match the
running app. The web app signs people in without `DATABASE_URL`. The service requires it, with the
migrations and grant that [its README](services/api/README.md#run-it) describes.

```bash
moon run web:dev
moon run api:dev
```

The reference app runs on port 5199 and the service on 8787.

### Verification

`just check` repairs formatting and lint issues, then verifies the graph. `just ci` is read only
and runs what CI runs. CI runs `test-coverage` once per JavaScript project; `test` remains for
focused local runs. Docker enables the real Postgres checks locally. CI requires them when a schema
exists.

`root:published-shape` copies the workspace into a disposable repository, builds the reference
app, proves its typecheck, test, lint and format gates reject deliberate violations, and checks its
HTTP and CSS behavior. It packs every library, runs `publint` and `attw` on each tarball, and
repeats the app check with the tarballs installed, including on `db`'s lowest peer versions. A
separate npm consumer outside any workspace imports every entry point and typechecks it with
TypeScript 5 and `skipLibCheck: false`. It runs a service on the packed `auth-http` and `db`
against a real Postgres with the shipped migrations and grant, then runs the packed `rls-verify`. A
`drizzle-orm` below `db`'s peer range must fail the install. CI runs the task when code, manifests,
the lockfile or Moon configuration change, and the release gate runs it on the tarballs it
publishes.

Postgres containers and their default ports are derived from the checkout path. `just clean`
removes only that checkout's container and Moon cache. Set `LILO_PG_PORT` if a port is occupied.
