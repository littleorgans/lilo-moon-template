---
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
---

A sign-in the provider refuses because it rate-limited the request or is unavailable, the `retry`
disposition, is now served as 503 instead of 400, so monitoring can tell a provider outage from a
person's mistake. Known `configuration` and unexpected `provider` failures now return 500.
Ambiguous provider 4xx refusals and unsupported flows stay 400, as do refusals before calling the
provider. Rejected email codes still redirect to code entry. Update status-based dashboards and
response assertions that assumed every failure page was 400.

Email-code sign-in failures get their own report, `EmailFailure` (`kind: "email"`, with `step:
"start"` or `"verify"`), instead of reusing `kind: "callback"`. `AuthFailureReport` gains it, and
`EmailStartDeps.log` and `EmailVerifyDeps.log` take it. The default sink, `reportAuthFailure`,
writes `auth.email.failed` with a `step` field for them, where it wrote `auth.callback.failed`.
Action required if an alert or a query matches `auth.callback.failed` to catch email failures, or if
a custom `log` switches exhaustively on `kind`. A logger explicitly typed to accept only
`CallbackFailure` must also accept `EmailFailure` when used by the email handlers; prefer the
`AuthFailureReport` union for a shared sink. Cookie formats and required environment names do not
change in this release.

`@littleorgans/auth-tanstack` re-exports `loadAuthConfig`, so an application can validate its auth
environment before the server listens rather than on the first request.

Malformed `WORKOS_REDIRECT_URI` errors now name the variable without retaining Node's raw `input`
property, so logging the whole startup exception cannot disclose the supplied value.
