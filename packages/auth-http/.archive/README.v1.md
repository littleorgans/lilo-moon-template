# @littleorgans/auth-http

Bearer-token authentication for HTTP services. The core turns a Fetch `Request` into a
`Principal` or a rejection, and a rejection into a `Response`. It uses only Web-standard
`Request`, `Response` and `Headers`, so it runs anywhere those exist. One framework adapter,
for [Hono](https://hono.dev), lives at a separate entry point.

The package also loads and validates a service's environment.

## Install

```sh
pnpm add @littleorgans/auth-http @littleorgans/auth
pnpm add hono @hono/node-server   # only for the Hono adapter on Node
```

`@littleorgans/auth` is a peer dependency. You build the verifier with it, and `auth-http`
recognizes the verifier's `AuthError` by class, so both must share one copy. `hono` is an optional
peer: a service that uses only the core never installs it.

## Use it with Hono

```ts
import { serve } from "@hono/node-server";
import { createVerifier } from "@littleorgans/auth";
import { loadServiceConfig } from "@littleorgans/auth-http";
import { requireAuth } from "@littleorgans/auth-http/hono";
import type { AuthEnv } from "@littleorgans/auth-http/hono";
import { Hono } from "hono";

const config = loadServiceConfig();
const verify = createVerifier(config.verifier);

const app = new Hono<AuthEnv>()
  .use(
    "/api/*",
    requireAuth({
      verify,
      onRejection: (rejection) => {
        if (rejection.code === "auth_unavailable") console.error(rejection.cause);
      },
    }),
  )
  .get("/api/me", (c) => c.json(c.var.principal));

serve({ fetch: app.fetch, port: config.port });
```

Build the verifier once per process. It caches the provider's keys, and building one per request
would put the JWKS endpoint on every request's path.

## Use the core without a framework

```ts
import { createAuthenticator, rejectionResponse } from "@littleorgans/auth-http";

const authenticate = createAuthenticator({ verify });

export async function handle(request: Request): Promise<Response> {
  const result = await authenticate(request);
  if (!result.ok) return rejectionResponse(result.rejection);
  return Response.json({ userId: result.principal.userId });
}
```

## API

```ts
function createAuthenticator(options: AuthenticatorOptions): Authenticator;
function rejectionResponse(rejection: Rejection): Response;
function loadServiceConfig(env?: Environment): ServiceConfig; // throws ConfigError

interface AuthenticatorOptions {
  verify: Verifier; // from createVerifier in @littleorgans/auth
  authorize?: (principal: Principal, request: Request) => boolean | Promise<boolean>;
  onRejection?: (rejection: Rejection, request: Request) => void;
}
type Authenticator = (request: Request) => Promise<Authentication>;
type Authentication = { ok: true; principal: Principal } | { ok: false; rejection: Rejection };
interface Rejection {
  code: RejectionCode;
  cause?: AuthError; // for server logs only
}

// @littleorgans/auth-http/hono
function requireAuth(options: AuthenticatorOptions): MiddlewareHandler<AuthEnv>;
interface AuthEnv {
  Variables: { principal: Principal };
}
```

## Responses

Every rejection body is `{"error": "<code>"}` with `Content-Type: application/json`. The body never
contains the verifier's message, the failed check, or a key id. `onRejection` receives the
`AuthError` cause so the server can log it.

| Condition                                                 | Status                                   | `WWW-Authenticate`             | `error`            |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------ | ------------------ |
| No Authorization header, or a scheme other than Bearer    | 401                                      | `Bearer`                       | `missing_token`    |
| Bearer with no token, a non-token68 value, or two headers | 401                                      | `Bearer error="invalid_token"` | `malformed_token`  |
| Verifier: `malformed`                                     | 401                                      | `Bearer error="invalid_token"` | `malformed_token`  |
| Verifier: `expired`                                       | 401                                      | `Bearer error="invalid_token"` | `expired_token`    |
| Verifier: `signature`, `issuer`, `audience`, `claims`     | 401                                      | `Bearer error="invalid_token"` | `invalid_token`    |
| `authorize` returned false                                | 403                                      | none                           | `forbidden`        |
| Verifier: `unavailable` (JWKS or provider down)           | 503                                      | none                           | `auth_unavailable` |
| Any other error thrown by `verify` or `authorize`         | propagates, so the framework answers 500 |                                |                    |

Notes on the table:

- `expired_token` is separate so a client knows a refresh will fix it. The other token failures
  share `invalid_token`, so a response never tells a forger which check to work on.
- A provider outage is a 503, not a 401. The token may be valid, and a 401 would tell the client
  to discard it and sign the person out.
- RFC 6750 suggests 400 for a malformed request. A malformed Authorization header gets a 401
  here instead, so a client needs only one "re-authenticate on 401" path.

### Where the token comes from

Only the `Authorization: Bearer <token>` header is read. The scheme is case-insensitive. RFC 6750
also allows an `access_token` query parameter and a form body field. This package reads neither:

- a query parameter leaks into access logs, browser history and `Referer` headers;
- a form body must be consumed before the handler runs, and it lets a cross-site form post
  arrive authenticated.

Cookies belong to `@littleorgans/auth-session`, which pairs them with CSRF defences.

## Service configuration

`loadServiceConfig(env = process.env)` reads:

| Variable           | Rule                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `PORT`             | Required. An integer from 1 to 65535.                                  |
| `DATABASE_URL`     | Required. A `postgres://` or `postgresql://` URL. Treated as a secret. |
| `WORKOS_CLIENT_ID` | Required. `client_` followed by letters and digits.                    |

It returns `{ port, databaseUrl, workosClientId, verifier }`. `verifier` holds the issuer and JWKS
URL derived from the client id; pass it straight to `createVerifier`. A service needs no API key,
redirect URI or cookie password.

On failure it throws one `ConfigError` that lists every missing or invalid variable, for example:

```text
Invalid service environment:
  - PORT must be an integer from 1 to 65535
  - WORKOS_CLIENT_ID is missing
```

Messages name variables and rules, never values. It follows the same approach as
`loadAuthConfig` in `@littleorgans/auth-session`: no schema library, and `process.env` is read only
as a default argument, so tests pass their own environment.

## Why Hono

The core is framework-neutral (decision D5 in `docs/direction.md`), and this package ships
exactly one adapter. The candidates were Hono, Fastify and plain `node:http`:

- **Fit with the core.** A Hono handler already holds a standard `Request` (`c.req.raw`) and
  returns a standard `Response`, so the adapter is a few lines of wiring with no conversion.
  Fastify and `node:http` use Node's `IncomingMessage` and `ServerResponse`, so an adapter must
  translate headers and bodies both ways, and that translation is where bugs live.
- **Runtime reach.** Hono runs on Node 24 through `@hono/node-server`, and also on Bun, Deno,
  Cloudflare Workers and other edge runtimes. Fastify is Node only. `node:http` is Node only.
- **Weight.** `hono` has no dependencies. `@hono/node-server` depends only on its `hono` peer.
  Fastify 5 installs about 50 packages (15 direct dependencies).
- **A second adapter.** The core is `createAuthenticator` plus `rejectionResponse`. A Fastify or
  `node:http` adapter would be another subpath (`./fastify`), with that framework as an optional
  peer. It would convert the request, call the core, and write the response. Nothing in the core
  changes.
- **The reference service.** `services/api` (task 1.14) needs routing, JSON handling and a
  testable app. `app.request()` runs a Hono app in process without a socket. Plain `node:http`
  would make the reference hand-roll routing that every service would then copy.

Start routes in the web app already use `Request` and `Response`, so Hono keeps the web and service
halves on the same primitives.
