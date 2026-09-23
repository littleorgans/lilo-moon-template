---
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
---

Rotate the session cookie password without signing anyone out. `WORKOS_COOKIE_PASSWORD_PREVIOUS`
takes retired passwords, comma-separated. Every cookie is still sealed with
`WORKOS_COOKIE_PASSWORD` only. A cookie is opened with that key first, then with each previous key
in order, and it moves to the current key at its next token refresh. Each previous password must be
at least 32 characters, must not be empty, repeated or equal to the current one, and errors name it
by position, never by value. The sealed format and the key derivation are unchanged, so 0.1.0
cookies and environments work as they are, and a 0.1.0 instance can still open a cookie written by
this version.

`AuthConfig` gains a required `previousCookieKeys`, which breaks code that builds an `AuthConfig` by
hand rather than with `loadAuthConfig`. `SessionCookieDeps` and the sign-out deps take an optional
`previousCookieKeys`, and the new `CookieKeys` type names the pair. `createAuthRuntime` passes the
previous keys to `access`, `asUser` and `endSession`, the paths that read a session. The rotation
procedure, including when a previous password can be removed, is in the auth-session README.
