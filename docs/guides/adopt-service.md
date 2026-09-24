# Adopt the packages in a service

> Still on `0.1.0`? Use [this guide at `v0.1.0`](https://github.com/littleorgans/lilo-moon-template/blob/v0.1.0/docs/guides/adopt-service.md),
> which copies the service by hand.

This guide adds a TypeScript HTTP service on the published `@littleorgans/*` packages at `^0.2.0`.
The service authenticates callers with `@littleorgans/auth-http` and reads Postgres through
`@littleorgans/db` under row level security. `@littleorgans/create-app` writes it from the
reference service, [`services/api`](../../services/api/README.md), at the release. After that, the
project owns it.

A service lives at `services/<name>/` in a Moon workspace. It can sit beside a web app in that
app's workspace, or be the only project in a workspace of its own. It always has the database:
`loadServiceConfig` requires `DATABASE_URL`, so `--service` implies `--db`.

The commands name the service `api`, and its directory name is its Moon project id. The
`lilo/build/start-project` skill
([`skills/lilo/build/start-project/SKILL.md`](../../skills/lilo/build/start-project/SKILL.md))
covers the judgment calls.

## 1. Create it

Install the tools as [step 1 of the web app guide](adopt-web-app.md#1-install-the-tools)
describes, then:

```sh
pnpm create @littleorgans/app acme --service --service-port 8787                                # standalone
pnpm create @littleorgans/app acme --web --organization-policy personal --service   # beside a web app
```

`--service-name` (default `api`) and `--service-port` (default `8787`, the reference's) name and
place it. [The web app guide](adopt-web-app.md#2-create-the-project) covers the web app's flags and
what the command writes at the root. Follow the steps it prints: commit, `pnpm install`, commit
the lockfile.

To add a service to a workspace that already has a web app, create a scratch project with
`--service`, the same `--name` and the service's own name and port, then move its
`services/<name>/` into your workspace. Merge the root integration described in
[Add an app to an existing repository](adopt-web-app.md#add-an-app-to-an-existing-repository),
including the `node-service` task layer and catalog entries. Run `pnpm install`, `moon sync`
and `moon ci --force`. If your workspace has no database
yet, take that too, as [the web app guide's step 5](adopt-web-app.md#5-set-up-the-database)
describes.

A standalone service needs none of the web session's variables, so its `.env.example` holds only
`WORKOS_CLIENT_ID` and `DATABASE_URL`. The web layer `.moon/tasks/node-application.yml` and the web
entries in the catalog stay unused until a web app joins the workspace.

The service is the reference service with the project's names. Its README describes the reference
and is left out; write your own when the service has endpoints of its own.

| Path under `services/api/`                                  | What it is                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                                               | The process entry: read the config, start, stop on SIGTERM or SIGINT.                                           |
| `src/server/config.ts`                                      | `loadServiceConfig`, with one `config_invalid` log line on a bad environment.                                   |
| `src/server/auth.ts`                                        | `requireAuth` from `auth-http/hono`, which refuses a token without an organization, and field-by-field logging. |
| `src/server/database.ts`                                    | The pool from `DATABASE_URL`, typed by the project's schema, `@acme/drizzle-schema`.                            |
| `src/server/{app,service,errors,requests,log}.ts`           | Routes and middleware, listen and drain, error-to-status mapping, request ids, and JSON logs.                   |
| `src/routes/health.ts`                                      | Unauthenticated liveness.                                                                                       |
| `src/routes/account.ts`, `src/features/accounts/account.ts` | The worked example of a tenant-scoped route. Keep it until your first route replaces it.                        |
| `tests/`                                                    | Route, config, logging and shutdown tests, and the Postgres integration test.                                   |
| `moon.yml`                                                  | The `node-service` layer (`build`, `dev`, `start`), `PORT` for `dev` and `start`, and `container`.              |
| `tsconfig.build.json`, `Dockerfile`                         | The `dist` build and the runtime image.                                                                         |

`tests/integration/database.test.js` starts Postgres with `withPostgres` from
`@littleorgans/db-tools`, a development dependency of the service. `jose` signs test tokens in
`tests/support.ts`. `@littleorgans/db` takes `drizzle-orm`, `pg` and `@types/pg` as peers, and
the `@littleorgans/auth-http/hono` adapter takes `hono`; the service's manifest supplies them, and
`pnpm peers check` prints `No peer dependency issues found`. `test` and `test-coverage` are
`cache: false`, because the database is not a file input.

## 2. Configuration

`loadServiceConfig` from `@littleorgans/auth-http`
([`packages/auth-http/src/config.ts`](../../packages/auth-http/src/config.ts)) reads three
variables once at startup, in `src/server/config.ts`:

| Variable           | Rule                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `PORT`             | 1 to 65535. Set by `tasks.dev.env` and `tasks.start.env` in `moon.yml`, or by the platform. |
| `DATABASE_URL`     | A `postgres://` URL for the service's own login role (step 3).                              |
| `WORKOS_CLIENT_ID` | The web app's client. The issuer and JWKS URL are derived from it.                          |

A bad environment prints one `config_invalid` line naming every problem, without values, and
exits 1. Moon loads the root `.env.local` for `dev` and `start`. Beside a web app, both projects
read that one file, so locally they share `DATABASE_URL` and `WORKOS_CLIENT_ID`. In deployment,
give each one its own login role.

## 3. The database, the login role and the grant

The service needs the identity migrations applied and a login role holding the shipped grant. The
project already has `db/migrations/` and the database gates; [What `--db`
wrote](adopt-web-app.md#what---db-wrote) in the web app guide describes them.

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

## 4. Reach the first green `moon ci`

```sh
moon ci --force
```

`--force` runs every task rather than only those the last commit touched. Nothing needs fixing
first: before a release, `published-shape` runs a standalone service, and one beside a web app,
through this same first run.

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

## 5. Build the container

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
  registry versions. The project's `@acme/drizzle-schema` is a workspace library, so the limit
  applies even when every `@littleorgans/*` dependency comes from npm. Do not rebuild from `out/`
  on another machine.
- **Library `src` in the image.** The published packages ship `src` beside `dist`, for source
  maps, so `node_modules/@littleorgans/*/src` is in the image. It is never loaded, and it adds size,
  not risk.
- The task does not run in CI (`runInCI: false`), and the image has never been deployed. A pipeline
  that pushes images is the project's to build.

## 6. Call it from the web app

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

## 7. No service-to-service identity

A service accepts only a person's token, forwarded by a web app. No machine identity exists for
one service to call another, or for a job to call a service, and none is planned for phase 1
(decision D10 in [the direction](../direction.md#decisions-approved-2026-09-23)). A service that
must call another service forwards the caller's own token, or it waits for that work.
