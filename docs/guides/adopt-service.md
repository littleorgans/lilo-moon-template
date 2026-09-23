# Adopt the packages in a service

This guide adds a TypeScript HTTP service on the published `@littleorgans/*` packages at `^0.1.0`.
The service authenticates callers with `@littleorgans/auth-http` and reads Postgres through
`@littleorgans/db` under row level security. It is a copy of the reference service,
[`services/api`](../../services/api/README.md), taken at the release tag. After the copy, the
project owns it.

A service lives at `services/<name>/` in a Moon workspace. It can sit beside a web app in that
app's workspace, or be the only project in a workspace of its own:

- **Beside a web app:** finish [Adopt the packages in a web app](adopt-web-app.md), then start
  here at step 2.
- **Standalone:** do steps 1–3 of [Adopt the packages in a web app](adopt-web-app.md#1-install-the-tools)
  (tools, the reference at the tag, the workspace root), then start here at step 1.

The commands name the service `api`, and its directory name is its Moon project id. If you choose
another name, change it everywhere it appears. The `lilo/build/start-project` skill
([`skills/lilo/build/start-project/SKILL.md`](../../skills/lilo/build/start-project/SKILL.md))
covers the judgment calls.

## 1. Standalone only: the service environment

A standalone service needs none of the web session's variables. Replace the copied `.env.example`
with:

```sh
# Copy to .env.local. Every .env* file is gitignored except this one. Moon loads .env.local for the
# service's dev and start tasks. PORT comes from services/api/moon.yml.

# Public. The same WorkOS client as the web app that calls this service. The issuer and JWKS URL
# are derived from it.
WORKOS_CLIENT_ID=client_xxxxxxxxxxxxxxxxxxxxxxxxxx

# SECRET. The service's own login role, never the migration owner or a superuser.
DATABASE_URL=postgres://acme_api:password@host:5432/app?sslmode=require
```

The web layer `.moon/tasks/node-application.yml` and the web entries in the catalog stay unused
until a web app joins the workspace. Commit:

```sh
git add -A
git commit -m "chore: set up the workspace for a service"
```

## 2. Copy the service

```sh
mkdir -p services
cp -R "$REF"/services/api services/api
rm services/api/README.md
```

The README describes the reference. Write your own when the service has endpoints of its own.
[The scaffold copy list](../direction.md#e-scaffolding) names `src/main.ts`,
`src/server/{config,auth,database}.ts`, `src/routes/health.ts` and `tests/`. Those import the rest
of `src/`, so copy all of it:

| Path under `services/api/`                                  | What it is                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                                               | The process entry: read the config, start, stop on SIGTERM or SIGINT.                                           |
| `src/server/config.ts`                                      | `loadServiceConfig`, with one `config_invalid` log line on a bad environment.                                   |
| `src/server/auth.ts`                                        | `requireAuth` from `auth-http/hono`, which refuses a token without an organization, and field-by-field logging. |
| `src/server/database.ts`                                    | The pool from `DATABASE_URL`.                                                                                   |
| `src/server/{app,service,errors,requests,log}.ts`           | Routes and middleware, listen and drain, error-to-status mapping, request ids, and JSON logs.                   |
| `src/routes/health.ts`                                      | Unauthenticated liveness.                                                                                       |
| `src/routes/account.ts`, `src/features/accounts/account.ts` | The worked example of a tenant-scoped route. Keep it until your first route replaces it.                        |
| `tests/`                                                    | Route, config, logging and shutdown tests, and the Postgres integration test.                                   |
| `tsconfig.build.json`, `Dockerfile`                         | The `dist` build and the runtime image. Both are used as copied.                                                |

`tests/integration/database.test.js` imports `scripts/lib/postgres-container.mjs` from the
workspace root by a relative path. That import is why the service sits two levels down, at
`services/<name>/`.

Three files carry this repository's workspace wiring. Replace them. `services/api/package.json`:

```json
{
  "name": "@acme/api",
  "version": "0.0.0",
  "private": true,
  "files": ["dist"],
  "type": "module",
  "engines": {
    "node": ">=24.19.0"
  }
}
```

`services/api/moon.yml`. The `node-service` tag with the `application` layer inherits `build`,
`dev` and `start` from `.moon/tasks/node-service.yml`. The service owns its port:

```yaml
language: "typescript"
layer: "application"
tags: ["node-service"]

tasks:
  dev:
    env:
      PORT: "8787"
  start:
    env:
      PORT: "8787"
  # `pnpm deploy` writes dist and production dependencies to out/, and the image is built from it.
  container:
    type: "run"
    script: >-
      rm -rf out &&
      pnpm --config.inject-workspace-packages=true --filter @acme/api deploy --prod out &&
      docker build --file Dockerfile --tag acme-api:local out
    deps:
      - "~:build"
    options:
      cache: false
      runInCI: false
  # The integration test starts Postgres through the root container helper, so a cached pass
  # proves nothing about the database.
  test:
    inputs:
      - "/scripts/lib/postgres-container.mjs"
    options:
      cache: false
  test-coverage:
    inputs:
      - "/scripts/lib/postgres-container.mjs"
    options:
      cache: false
```

`services/api/tsconfig.json`, which is the reference's without its project references:

```json
{
  "extends": "../../tsconfig.options.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "compilerOptions": {
    "outDir": "../../.moon/cache/types/services/api",
    "types": ["node"],
    "rewriteRelativeImportExtensions": true
  }
}
```

Install. `@littleorgans/db` takes `drizzle-orm`, `pg` and `@types/pg` as peers, and the
`@littleorgans/auth-http/hono` adapter takes `hono`:

```sh
pnpm install
pnpm add --filter @acme/api @littleorgans/auth@catalog: @littleorgans/auth-http@catalog: @littleorgans/db@catalog: @hono/node-server@catalog: hono@catalog: drizzle-orm@catalog: pg@catalog:
pnpm add --filter @acme/api -D @types/node@catalog: @types/pg@catalog: jose@catalog:
pnpm peers check
```

`jose` signs test tokens in `tests/support.ts`. `pnpm peers check` must print
`No peer dependency issues found`.

## 3. Configuration

`loadServiceConfig` from `@littleorgans/auth-http`
([`packages/auth-http/src/config.ts`](../../packages/auth-http/src/config.ts)) reads three
variables once at startup, in `src/server/config.ts`:

| Variable           | Rule                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `PORT`             | 1 to 65535. Set by `tasks.dev.env` and `tasks.start.env` in `moon.yml`, or by the platform. |
| `DATABASE_URL`     | A `postgres://` URL for the service's own login role (step 4).                              |
| `WORKOS_CLIENT_ID` | The web app's client. The issuer and JWKS URL are derived from it.                          |

A bad environment prints one `config_invalid` line naming every problem, without values, and
exits 1. Moon loads the root `.env.local` for `dev` and `start`. Beside a web app, both projects
read that one file, so locally they share `DATABASE_URL` and `WORKOS_CLIENT_ID`. In deployment,
give each one its own login role.

## 4. The database, the login role and the grant

The service needs the identity migrations applied and a login role holding the shipped grant.

- **Standalone:** do [In the project](adopt-web-app.md#in-the-project) from the web app guide's
  database step. Read `services/api/node_modules/` wherever it says `apps/web/node_modules/`.
- **Beside a web app:** `db/migrations/` and the `rls-verify` gate already exist.

For a real database, apply the migrations as
[In a real database](adopt-web-app.md#in-a-real-database) describes. Then give the service its own
login role, so that you can revoke it without touching the web app's. As the migration owner:

```sh
psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE acme_api LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;"
psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "\\password acme_api"
psql -X "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v login_role=acme_api \
  -f services/api/node_modules/@littleorgans/db/grants/login-role.sql
```

The service's `DATABASE_URL` names `acme_api`. Without the grant, every `/v1` request fails with
500, and the log shows SQLSTATE `42501`. The grant and the role rules are explained in
[the db package README](../../packages/db/README.md#set-up-the-database).

## 5. Reach the first green `moon ci`

```sh
pnpm install
moon sync
moon run root:format
moon run api:typecheck api:build api:test
git add -A
git commit -m "feat: add the api service"
moon ci
```

With Docker running, `api:test` includes `tests/integration/database.test.js`. It starts Postgres
17, applies the shipped migrations and grant to a fresh login role, and proves 401 without a
token, 403 without an organization, and that each organization reads and creates only its own
account. Without Docker it is skipped locally. CI always runs it.

Copy `.env.example` to `.env.local` and fill it in, if you have not already. Run the service with
`moon run api:dev`, which watches the TypeScript source, or with `moon run api:start`, which builds
`dist` and runs it. From another terminal:

```sh
curl -i http://localhost:8787/health        # 200 {"status":"ok"}
curl -i http://localhost:8787/v1/account    # 401 {"error":"missing_token"}
```

## 6. Build the container

```sh
moon run api:container
docker run --rm -p 8787:8787 -e PORT=8787 -e DATABASE_URL=... -e WORKOS_CLIENT_ID=... acme-api:local
```

`api:container` builds `dist` and runs `pnpm deploy --prod` into `services/api/out/`: `dist`, the
manifest, and production dependencies. It then builds the `Dockerfile` from `out/` as
`acme-api:local`. The image is `node:24.19.0-alpine`, pinned by digest, and runs as `node`.
`docker stop` sends SIGTERM, which lets in-flight requests finish for up to 10 seconds and then
closes the pool.

Known limits:

- **Absolute paths in `pnpm deploy`.** When a dependency is a workspace package, as the libraries
  are for the reference service in this repository, the deployed `out/package.json` and lockfile
  record the build machine's absolute path to it. With the packages from npm, the dependencies are
  registry versions. That limit returns if the project gains workspace libraries of its own, so do
  not rebuild from `out/` on another machine.
- **Library `src` in the image.** The published packages ship `src` beside `dist`, for source
  maps, so `node_modules/@littleorgans/*/src` is in the image. It is never loaded, and it adds size,
  not risk.
- The task does not run in CI (`runInCI: false`), and the image has never been deployed. A pipeline
  that pushes images is the project's to build.

## 7. Call it from the web app

The web app calls the service as the signed-in person with `auth.asUser()`. It never touches the
token itself. `asUser()` returns the same five states as `access()`. Only `signed-in` carries a
`fetch`, which sets `Authorization: Bearer` and sends only to origins listed in `serviceOrigins`.
Anything else is rejected before a request is made. List the service's origin in
`apps/web/src/server/auth.ts`:

```ts
export const auth = createAuthRuntime({
  // ...the existing options
  serviceOrigins: [
    "http://localhost:8787",
    "https://api.acme.example",
    { origin: "http://api:8787", insecure: true },
  ],
});
```

- A string must be `https`, or `http` on localhost, and it names an origin only, with no path.
- Plain `http` inside a cluster is listed one origin at a time as
  `{ origin, insecure: true }`, because the person's token crosses that network readable by
  anything on the path. No setting allows `http` everywhere.
- An empty list, the default, refuses every call.

In a server function or loader:

```ts
const access = await auth.asUser();
if (access.status === "signed-in") {
  const response = await access.fetch(new URL("/v1/account", apiOrigin));
}
```

`apiOrigin` is the app's own configuration, for example an environment variable. Hold the result
no longer than the request that produced it. See `UserAccess` in
[`packages/auth-session/src/delegate.ts`](../../packages/auth-session/src/delegate.ts) and
`asUser` in [`packages/auth-tanstack/src/runtime.ts`](../../packages/auth-tanstack/src/runtime.ts).

## 8. No service-to-service identity

A service accepts only a person's token, forwarded by a web app. No machine identity exists for
one service to call another, or for a job to call a service, and none is planned for phase 1
(decision D10 in [the direction](../direction.md#decisions-approved-2026-09-23)). A service that
must call another service forwards the caller's own token, or it waits for that work.
