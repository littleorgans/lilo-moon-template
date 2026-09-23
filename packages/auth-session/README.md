# @littleorgans/auth-session

The HTTP half of WorkOS sign-in for a web application: the redirect and email-code sign-in
handlers, the sealed session cookie, the CSRF `state` cookie, sign-out, and `readAccess` and
`readUserAccess`, which turn the session cookie into who is calling on every request. It depends on
no web framework. The application supplies a `CookieJar`, and `@littleorgans/auth-tanstack` is the
adapter for TanStack Start.

## Install

```sh
pnpm add @littleorgans/auth-session
```

## Configuration

`loadAuthConfig(env = process.env)` reads:

| Variable                          | Rule                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`                | Required.                                                                                                         |
| `WORKOS_API_KEY`                  | Required. Server-only secret.                                                                                     |
| `WORKOS_REDIRECT_URI`             | Required. HTTPS, except `http` on `localhost`, `127.0.0.1` or `[::1]`.                                            |
| `WORKOS_COOKIE_PASSWORD`          | Required. Secret, at least 32 characters. Seals every session cookie written.                                     |
| `WORKOS_COOKIE_PASSWORD_PREVIOUS` | Optional. Retired cookie passwords, comma-separated, each at least 32 characters. Opens cookies, never seals one. |

It throws on the first request that needs configuration, naming every missing variable at once.
Errors name variables and entries by position, never values. A previous password that is empty,
shorter than 32 characters, the same as `WORKOS_COOKIE_PASSWORD`, or listed twice is refused.
Whitespace around each previous entry is ignored, so a password used here can contain neither a
comma nor leading or trailing whitespace. `openssl rand -base64 32` prints one that fits.

Each password becomes an AES-256-GCM key through HKDF-SHA256. The session cookie holds only the
access and refresh tokens, sealed with the key from `WORKOS_COOKIE_PASSWORD`. A cookie is opened
with that key first, then with each previous key in the order listed. A cookie that no key opens is
treated exactly like a tampered one: the request is anonymous, and nothing is logged or cleared.

The `state` and email cookies are not sealed. `state` is a random value checked against the one the
provider returns, and the email cookie holds the address the person typed, so a rotation does not
touch either.

## Rotate the cookie password

Rotating the password without the steps below signs everyone out, because no cookie in a browser
opens with the new key. With them, nobody is signed out.

1. **Generate** a new password: `openssl rand -base64 32`.
2. **Stage it, if more than one instance serves traffic.** Deploy with the new password added to
   `WORKOS_COOKIE_PASSWORD_PREVIOUS` and `WORKOS_COOKIE_PASSWORD` unchanged, and wait for the
   rollout to finish. While a rollout runs, old and new instances serve the same browsers, and an
   old instance cannot open a cookie a new one sealed with a key the old one does not know. It would
   treat that request as signed out. A single instance, or a deployment that replaces every
   instance at once, can skip this step.
3. **Promote it.** Set `WORKOS_COOKIE_PASSWORD` to the new password, list the old one in
   `WORKOS_COOKIE_PASSWORD_PREVIOUS`, and deploy. Every cookie written from now on is sealed with the
   new key. Cookies sealed with the old key still open, and each one moves to the new key the next
   time its tokens are refreshed. That happens within about five minutes of use, because WorkOS
   access tokens last 300 seconds by default. A cookie is not rewritten merely because an old key
   opened it. A rewrite of an unchanged token pair can land after a concurrent request's refresh
   and put the spent refresh token back in the browser.
4. **Wait** until at least _T_ + _L_. _T_ is when the last instance sealing with the old password
   stopped serving, which is the end of the step 3 rollout. _L_ is the shorter of the application's
   **Maximum session length** in the WorkOS dashboard (Applications, Sessions) and the session
   cookie's one-year `Max-Age`. Read _L_ from the dashboard rather than assuming the default. A
   cookie sealed with the old key at or before _T_ holds a WorkOS session that started at or before
   _T_. That session has ended by _T_ + _L_, whether or not anyone used it.
5. **Remove** the old password from `WORKOS_COOKIE_PASSWORD_PREVIOUS` and deploy. A cookie that
   still carries the old key now arrives as a signed-out request, which is what its ended session
   would have become at the next refresh anyway.

Rotations may overlap. List every password still inside its wait, newest first, because keys are
tried in the order listed. The list is normally empty, and during a rotation it holds one password.

**If the password leaked, do not list it as previous.** Listing it keeps every cookie sealed with it
valid, including cookies somebody else copied. Replace it and deploy without it, which signs everyone
out. Then revoke the WorkOS sessions whose refresh tokens it could have exposed. A leaked password
decrypts any session cookie it sealed, and the refresh token inside keeps working until WorkOS ends
that session.

## Session lifetime

WorkOS decides how long a session lasts. The cookie does not. In the dashboard, the application's
**Maximum session length** bounds a session from sign-in. **Inactivity timeout** ends one that has
not refreshed for that long. **Access token duration** (300 seconds by default) sets how often a
refresh happens during use. Every refresh rewrites the cookie. The cookie's one-year `Max-Age` is
only how long the browser keeps the envelope, so a session ends when WorkOS ends it, and the next
refresh then fails and signs the person out.

For a shorter session with sliding renewal, set both limits in the WorkOS dashboard, not in code.
The inactivity timeout slides with use, and the maximum length caps it absolutely. Both hold on the
provider and apply to every client of the session, and the maximum is the _L_ in the rotation rule
above.
