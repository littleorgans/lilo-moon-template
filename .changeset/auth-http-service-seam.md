---
"@littleorgans/auth-http": minor
---

Add `@littleorgans/auth-http`, bearer authentication for HTTP services. `createAuthenticator`
turns a Fetch `Request` into a `Principal` or a rejection, and `rejectionResponse` answers
missing, malformed, expired and invalid tokens with 401 and a `WWW-Authenticate: Bearer`
challenge, a refused `authorize` hook with 403, and a JWKS or provider outage with 503. Bodies
carry only an error code. `@littleorgans/auth-http/hono` adds `requireAuth` Hono middleware, and
`loadServiceConfig` validates `PORT`, `DATABASE_URL` and `WORKOS_CLIENT_ID`, listing every
problem at once without echoing values.

`@littleorgans/auth` is a peer dependency, because the service builds the verifier and
`auth-http` recognizes its `AuthError` by class. `hono` (`^4.13.0`) is an optional peer, needed
only for the adapter. Install them alongside the package.
