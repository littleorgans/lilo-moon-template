# services/api

The reference TypeScript service. It authenticates callers with `@littleorgans/auth-http`, reads
and writes Postgres through `@littleorgans/db` under forced row level security, and runs on Hono
over `@hono/node-server`. It is private and never published. A new service starts as a copy of it.

## Endpoints

| Method and path   | Auth                       | Answers                                                                       |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `GET /health`     | none                       | `200 {"status":"ok"}`. Liveness only: it touches no dependency.               |
| `GET /v1/account` | bearer token with `org_id` | `200` with the caller's organization account, or `404 account_not_found`.     |
| `PUT /v1/account` | bearer token with `org_id` | `201` with the account it created, or `200` with the one that already exists. |

An account is `{ "id", "orgId", "createdAt" }`, with `createdAt` in ISO 8601 UTC. Every `/v1`
response carries `Cache-Control: no-store`, and every response carries an `x-request-id`.
PostgreSQL permits `infinity` and `-infinity` in the non-null creation timestamp; `to_char` returns
NULL for those values. An account imported with either value returns 500 `internal`, because it
cannot satisfy the response's required timestamp.

## Layout

```text
src/
├── main.ts                   Process entry: read config, start, stop on SIGTERM or SIGINT
├── server/                   The composition root
│   ├── config.ts             loadServiceConfig, and one log line on an invalid environment
│   ├── auth.ts               requireAuth with an organization check and field-by-field logging
│   ├── database.ts           The pool, from DATABASE_URL, typed by @littleorgans/drizzle-schema
│   ├── app.ts                Middleware, routes and error handling, with no socket
│   ├── service.ts            Listen, and graceful shutdown
│   ├── errors.ts             Error-to-status mapping
│   ├── requests.ts           Request ids and the access log
│   └── log.ts                JSON lines
├── routes/                   URL wiring only
│   ├── health.ts
│   └── account.ts
└── features/accounts/        Typed Drizzle queries, run inside the caller's scoped transaction
    └── account.ts
```

The `/v1` group installs the auth middleware once, so a route added under `/v1` is authenticated
because of where it is mounted. `createApp` in `src/server/app.ts` takes its dependencies as
arguments, which is how the route tests run it through `app.request()` without a socket.

Relative imports name the `.ts` file. `moon run api:dev` runs `src/main.ts` directly through
Node's type stripping, and `tsconfig.build.json` rewrites the imports to `.js` when it emits `dist`.

## Run it

`moon run api:dev` watches the source. `moon run api:start` builds `dist` and runs it. Both load
`/.env.local` and take `PORT` from `moon.yml` (8787). The service reads three variables, validated
by `loadServiceConfig`:

| Variable           | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `PORT`             | 1 to 65535.                                                                              |
| `DATABASE_URL`     | The service's own login role, never the migration owner or a superuser. Treat as secret. |
| `WORKOS_CLIENT_ID` | The same client as the web app. The issuer and JWKS URL are derived from it.             |

An invalid environment prints one `config_invalid` line naming every problem, without values,
and exits 1.

The database needs the migrations shipped in `@littleorgans/db`, then the shipped grant for the
login role (`packages/db/grants/login-role.sql`, Postgres 16 or later). The db package README
walks through both. Without the grant, every `/v1` request fails with 500 and SQLSTATE `42501`
in the log.

## Tenancy

Every `/v1` route runs its queries inside `database.withPrincipal`, which sets the verified claims
for one transaction. The queries have no tenant `WHERE` clause: the policies in the identity
migration decide which rows exist for the caller. `PUT` inserts `app.current_org_id()`, the same
claim the policies read, so the organization never comes from the request. A verified token with
no `org_id` is refused with 403 before any transaction opens.

## Errors

Every failure body is `{"error": "<code>"}` with `Cache-Control: no-store`, the same shape
auth-http uses:

| Status | `error`                                                              | When                                                                                  |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 401    | `missing_token`, `malformed_token`, `expired_token`, `invalid_token` | From auth-http, with a `WWW-Authenticate: Bearer` challenge.                          |
| 403    | `forbidden`                                                          | The token verified but carries no organization.                                       |
| 404    | `not_found`, `account_not_found`                                     | No such route, or no account yet for the caller's organization.                       |
| 503    | `auth_unavailable`                                                   | The identity provider's keys could not be fetched.                                    |
| 503    | `unavailable`                                                        | Postgres is unreachable, shutting down, starting, or out of connection slots.         |
| 500    | `internal`                                                           | Anything else, including a missing grant. The message and stack stay out of the body. |

## Logging

`src/server/log.ts` writes one JSON object per line: errors to stderr, everything else to stdout.
A log field is a scalar or a list of strings, so the type refuses a `Request`, its `Headers` or an
error object. Each record lists the fields it keeps:

- `request`: the request id, method, pathname, status and duration, for every response.
- `auth_rejected`: the request id, rejection code, the verifier's enumerated reason, method and
  pathname. It is logged at `error` for `auth_unavailable` and at `info` otherwise.
- `request_failed`: the request id, the response code, and the error's errno or SQLSTATE code.
  The message is never logged, because a Postgres message can quote the row that failed.

The request id is generated by the service, never read from a request header, and returned as
`x-request-id`. Paths are logged without the query string.

## Shutdown

SIGTERM or SIGINT stops accepting connections, lets requests in flight finish for up to 10
seconds, cuts whatever remains, then closes the pool. The process exits by itself once nothing is
open. A second signal gets Node's default handling, so pressing Ctrl-C twice exits at once.

## Container

`moon run api:container` builds `dist` and runs `pnpm deploy` into `out/`. The deploy writes `dist`,
the manifest and production dependencies, with the workspace libraries copied in as their built
`dist`. It then builds `Dockerfile` from `out/` as `littleorgans-api:local`. The image is
`node:24.19.0-alpine`, pinned by digest, and runs as `node`:

```sh
docker run -p 8787:8787 -e PORT=8787 -e DATABASE_URL=... -e WORKOS_CLIENT_ID=... littleorgans-api:local
```

## Call it from the web app

The web app sends the signed-in person's token through `auth.asUser().fetch`, and only to origins
listed in `serviceOrigins` in `apps/web/src/server/auth.ts`. Inside a cluster, where the service
is reachable only over plain http, list that one origin explicitly:

```ts
serviceOrigins: ["https://api.example.com", { origin: "http://api:3000", insecure: true }],
```

## Tests

- `tests/routes/`: the HTTP surface through `app.request()`, with tokens signed by a test key and
  a recording transaction.
- `tests/server/`: config, error mapping and logging.
- `tests/integration/shutdown.test.ts` and `main.test.ts`: a real listener, shutdown ordering and
  the grace deadline, and the real `src/main.ts` process receiving real signals.
- `tests/integration/database.test.js`: Postgres 17 in Docker, with the shipped migrations and
  grant applied by psql, a fresh login role, and a JWKS endpoint. It proves 401 without a token,
  403 without an organization, and that each organization reads and creates only its own account.
  It is skipped without Docker; CI runs it.
