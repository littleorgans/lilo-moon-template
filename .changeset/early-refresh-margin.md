---
"@littleorgans/auth-session": minor
---

Refresh an access token that verifies but expires within 20 seconds (`REFRESH_MARGIN_SECONDS`), so
`readUserAccess` no longer forwards a token that expires on the way to the service. `exp` is read
only after the signature has verified, and a token without a numeric `exp` is served as before. The
early refresh goes through the existing shared refresh. If it fails for any reason, including a
provider outage or `invalid_grant`, the person stays signed in on the token that verified, the
cookie is left alone apart from a rotated replacement kept when its verification was unavailable,
and the failure is logged with the new `TokenFailure` status `signed-in`. An expired token is
handled exactly as before.
