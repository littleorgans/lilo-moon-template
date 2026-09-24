---
name: auth
description: Make sign-in, session and bearer-token decisions with the @littleorgans auth packages, covering organization policy, which screen each access state and failure reaches, configuration, throttling, Origin checks, calling a service as the signed-in person, and verifying tokens in a service. Use when changing how people sign in, what a session failure shows, how a web app calls a service, or how a service authenticates requests.
---

# Decide auth

The auth packages already implement the flows, the cookie, refresh, Origin checks and token
verification. What is left to a project is a set of choices and where it wires them. Every path
here is in `littleorgans/lilo-moon-template`. Read them at the tag that matches the installed
`@littleorgans/*` version.

- `docs/auth-screens.md`: one screen per state a token can put a person in, and the failure
  mappings. It is the reference for every "what does the person see" question.
- `docs/decisions.md`, "Identity and entitlements": why the packages are split the way they are.
- `packages/auth-session/README.md` and `packages/auth-http/README.md`: configuration, responses
  and the cookie password rotation.

Where the loader code goes is [web-app](../web-app/SKILL.md). The rows a signed-in person needs are
[persistence](../persistence/SKILL.md). The service around the middleware is
[service](../service/SKILL.md).

## The choices a project owns

All of them sit in `apps/<name>/src/server/auth.ts`, the `createAuthRuntime` call
(`apps/web/src/server/auth.ts` in the reference). Change them there, never in a package copy.

- **`organizationPolicy`.** `personal` creates an organization at first sign-in, keyed on the user
  so a retry cannot make two. `existing` leaves membership to an invitation or admin flow the
  product already has. Under `existing` a person without an organization signs in, sees no tenant
  rows, and every service refuses them with 403. Switching later changes nothing for people who
  already have one.
- **Roles.** A new organization's creator gets the environment's default role. Whether a creator
  should hold more is a product decision the packages do not take: define the role in WorkOS, then
  pass `roleSlugs`, as `docs/auth-screens.md` describes. Do not grant WorkOS's `admin`; it governs
  WorkOS's own widgets, not the product.
- **Entitlements** arrive as names in the token (`entitlements` on the `Principal`), never as
  quantities. Gate on "does this organization have the feature", prefix names per product, and read
  seat counts off the request path. `docs/user-entity.md` explains why.
- **`throttle`** is required and has no default. `apps/web/src/server/throttle.ts` counts in one
  process's memory, which is right for one instance only. Before a second instance, replace it with
  a store every instance shares, keeping the keys and limits. `clientOf` reads the socket address:
  behind a proxy you control, read the forwarded one instead, and never trust a forwarded header a
  client can set.
- **`log`** defaults to one JSON line on stderr per refused sign-in or failed token. Once the
  project has real logging, pass its sink here, or failures miss the aggregator.
- **`serviceOrigins`** is empty by default, so the person's token goes nowhere. List each service
  origin when the app first calls one.

## What each state shows

`auth.access()` and `auth.asUser()` return `signed-in`, `anonymous`, `ended`, `broken` or
`unavailable`. None of them throws. Keep the reference's destinations; each encodes a decision.

- `ended` clears the cookie and says only that the session ended. It never names the failed check,
  because that tells an attacker which one to change.
- `broken` means the provider really signed a token we cannot read: our outage. The cookie stays,
  the screen has no sign-in button, and the failure is logged.
- `unavailable` is a provider or key outage: offer a retry, keep the session.
- A refused sign-in at the callback renders the package's own page with a status that tells
  monitoring whose fault it is (503, 500 or 400). Route those failures through `log`; do not
  replace the page with a catch-all that answers 200.

## Configuration

`loadAuthConfig` names every missing or invalid variable at once, and never a value. The runtime
only reads it on first use, so the reference validates before listening with a Nitro plugin,
`apps/web/src/server/startup.ts`. Keep it: without it a bad cookie password fails the first
request instead of the deploy. `WORKOS_REDIRECT_URI` is also the app's origin for every Origin
check, so behind a TLS-terminating proxy it must be the public `https://` URL.

## Web app to service

Call a service with `auth.asUser()` and its `fetch`. It exists only in the `signed-in` state, sets
the bearer token itself, and sends only to `serviceOrigins`. There is no accessor for the raw token,
by design: a string can be returned from a loader or logged. Map the other four states exactly as a
loader maps `Access`, and do not keep the result beyond the request that read it.

## In a service

`requireAuth` from `@littleorgans/auth-http/hono` authenticates, and
`services/api/src/server/auth.ts` shows the judgment around it:

- Build the verifier once per process with `createVerifier`; it caches the provider's keys.
- Put tenant rules in `authorize`: the reference refuses a token without an organization with 403
  before any transaction opens.
- In `onRejection`, log selected fields. Never log the request or spread the event: it holds the
  `Authorization` header.
- A provider outage is 503 `auth_unavailable`, never 401: a 401 tells the client to discard a token
  that may be valid.
- Only the `Authorization` header carries a token. Cookies belong to the web app.

There is no machine identity (decision D10). A service that must call another forwards the
caller's own token, and a background job cannot call a service yet. Say so rather than inventing a
shared secret.

## What is enforced for you

- The package handlers answer only POST where state changes, refuse a missing or foreign `Origin`,
  and ask the throttle before WorkOS; their own tests hold that.
- The verifier requires `exp` and `sub` and maps every failure to an `AuthFailure` reason
  (`packages/auth/src/verify.ts`).
- `throttle` is a required option, so omitting it fails typecheck.
- An unhandled access state fails typecheck where the loader keeps its `never` default.

Your own POST routes are not covered: call `refuseCrossOrigin(request, auth.origin())` first, as
`apps/web/src/server/theme.ts` does.
