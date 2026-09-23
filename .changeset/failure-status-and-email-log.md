---
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
---

A sign-in the provider refuses because it rate-limited the request or is unavailable, the `retry`
disposition, is now served as 503 instead of 400, so monitoring can tell a provider outage from a
person's mistake. Every other failure page, including every refusal made before the provider is
asked, stays 400.

Email-code sign-in failures get their own report, `EmailFailure` (`kind: "email"`, with `step:
"start"` or `"verify"`), instead of reusing `kind: "callback"`. `AuthFailureReport` gains it, and
`EmailStartDeps.log` and `EmailVerifyDeps.log` take it. The default sink, `reportAuthFailure`,
writes `auth.email.failed` with a `step` field for them, where it wrote `auth.callback.failed`.
Action required if an alert or a query matches `auth.callback.failed` to catch email failures, or if
a custom `log` switches exhaustively on `kind`.

`@littleorgans/auth-tanstack` re-exports `loadAuthConfig`, so an application can validate its auth
environment before the server listens rather than on the first request.
