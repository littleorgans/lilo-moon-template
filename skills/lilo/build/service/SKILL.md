---
name: service
description: Build a TypeScript HTTP service on @littleorgans/auth-http and @littleorgans/db, following the services/api reference for layout, configuration, bearer auth, the health endpoint, error-to-status mapping, logging, shutdown, tests and the container. Use when adding an endpoint, feature or middleware to a service built from the littleorgans reference, or deciding how a service should fail, log or be tested.
---

# Build a service

`services/api` is the reference: a Hono app on `@hono/node-server` that authenticates with
`@littleorgans/auth-http` and reads and writes through `@littleorgans/db`. A new service starts as
a copy of it through `@littleorgans/create-app` ([start-project](../start-project/SKILL.md)).
`services/api/README.md` lists its endpoints, variables, error codes, log records and tests; this
skill covers the judgment behind them. Every path here is in `littleorgans/lilo-moon-template`.
Read them at the tag that matches the installed `@littleorgans/*` version.

Token verification is [auth](../auth/SKILL.md). Tables and queries are
[persistence](../persistence/SKILL.md).

## Where code goes

- `src/main.ts` only reads config, starts, and stops on a signal.
- `src/server/` is the composition root: config, auth, database, the app, errors, logging,
  shutdown. `createApp` in `services/api/src/server/app.ts` takes every dependency as an argument,
  which is what lets tests run the whole HTTP surface through `app.request()` without a socket.
- `src/routes/` is URL wiring only. `src/features/<name>/` owns the queries, run inside the
  caller's scoped transaction, as `services/api/src/features/accounts/account.ts` does.
- Mount a tenant route under `/v1`. The group installs the auth middleware once, so a route is
  authenticated by where it is mounted. A route outside the group is public: say why when adding
  one.
- Relative imports name the `.ts` file. `dev` runs the source through Node's type stripping, and
  the build rewrites the imports.

## Configuration

`loadServiceConfig` reads `PORT`, `DATABASE_URL` and `WORKOS_CLIENT_ID` and throws once, naming
every problem without a value. The service needs no API key, cookie password or redirect URI;
adding one is a sign the work belongs in the web app. Validate a variable of your own in
`src/server/config.ts`, where `readConfig` turns an invalid environment into one `config_invalid`
line and no start, so a bad deploy fails before it takes a request.

## How it fails

The reference's own failure bodies use `{"error": "<code>"}` with `Cache-Control: no-store`, the shape auth-http
uses. Hono `HTTPException` responses pass through unchanged, so choose middleware with that
exception in mind. Keep the reference's split, in `services/api/src/server/errors.ts`:

- 401 auth rejection codes and 503 `auth_unavailable` come from auth-http. A provider outage is never a 401.
- 403 when the token verified but the request is not allowed, such as a token with no
  organization.
- 503 `unavailable` when Postgres is unreachable, starting, shutting down or out of connections:
  the client may retry.
- 500 `internal` for everything else. The message and stack never reach the body, and a missing
  grant lands here too, which is why its SQLSTATE is logged.

A new error gets a code only when a client acts on it differently; otherwise it is `internal`.

## Logging

`services/api/src/server/log.ts` writes JSON lines whose fields are scalars or string lists, so a
`Request`, its headers or an error object cannot be logged by type. Keep that. Log an error's
errno or SQLSTATE code, never its message: a Postgres message can quote the row. Generate the
request id in the service and return it; never read one from a request header.

## Health and shutdown

`GET /health` answers without touching a dependency. It is liveness, so a database outage does not
get the process restarted. On SIGTERM the service stops accepting, lets requests finish for up to
10 seconds, then closes the pool. Keep new resources inside that order.

## Tests

`services/api/tests/` shows the split: routes through `app.request()` with tokens signed by a test
key, server modules on their own, and `tests/integration/` for a real listener, real signals and a
real Postgres with the shipped migrations and grant. The database test skips without Docker, and CI
runs it. A new tenant route gets a test that another organization cannot read or write its rows.

## Build and container

The `node-service` Moon layer (`.moon/tasks/node-service.yml`) gives a service tagged
`node-service` its `build`, `dev` and `start`. The port lives in the service's own `moon.yml`, not
the layer. `api:container` in `services/api/moon.yml` deploys the service with `pnpm deploy` and
builds its `Dockerfile`, a pinned Node image that runs as `node`. Pushing images is the project's
own pipeline.

## Gates

`build`, `typecheck` and the per-file coverage floor run for every service in `moon ci`. The
container build and the route-mounting rule are not checked by any gate.
