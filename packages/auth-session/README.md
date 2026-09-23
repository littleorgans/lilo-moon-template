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

| Variable                          | Rule                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`                | Required.                                                                                                                           |
| `WORKOS_API_KEY`                  | Required. Server-only secret.                                                                                                       |
| `WORKOS_REDIRECT_URI`             | Required. HTTPS, except `http` on `localhost`, `127.0.0.1` or `[::1]`.                                                              |
| `WORKOS_COOKIE_PASSWORD`          | Required. Secret, at least 32 characters. Seals every session cookie written.                                                       |
| `WORKOS_COOKIE_PASSWORD_PREVIOUS` | Optional. Read-only cookie passwords, comma-separated or a JSON array, each at least 32 characters. Opens cookies, never seals one. |

It throws on the first request that needs configuration, naming every missing variable at once.
Errors name variables and entries by position, never values. A previous password that is empty,
shorter than 32 characters, the same as `WORKOS_COOKIE_PASSWORD`, or listed twice is refused.
Whitespace around each comma-separated entry is ignored. `openssl rand -base64 32` prints a
password that fits that format. To preserve existing passwords containing commas or surrounding
whitespace, use a JSON array of strings instead, for example
`WORKOS_COOKIE_PASSWORD_PREVIOUS='["the exact old password, including its comma"]'` in a shell.
A value beginning with `[` is parsed as JSON; use an array for passwords beginning with `[` too.
JSON strings are used exactly as written, without trimming. An unset or blank variable, or `[]`,
means no previous keys. Malformed JSON is refused without echoing its contents.

The runtime validates lazily on first use. To fail deployment before accepting traffic, call
`loadAuthConfig` (re-exported by `@littleorgans/auth-tanstack`) from code that runs before the
server listens. Under Nitro that is a plugin, not the application's own modules, which Nitro imports
on the first request: `apps/web/src/server/startup.ts` in the reference app is one.

Each password becomes an AES-256-GCM key through HKDF-SHA256. The session cookie holds only the
access and refresh tokens, sealed with the key from `WORKOS_COOKIE_PASSWORD`. A cookie is opened
with that key first, then with each previous key in the order listed. A cookie that no key opens is
treated exactly like a tampered one: the request is anonymous, and nothing is logged or cleared.

The `state` and email cookies are not sealed. `state` is a random value checked against the one the
provider returns, and the email cookie holds the address the person typed, so a rotation does not
touch either.

## Failure pages

A sign-in the provider refuses renders a plain page with no script or stylesheet. The status tells
monitoring whose problem it is: 503 for the `retry` disposition (the provider rate-limited us or is
down) and 400 for everything else, including every refusal made before the provider is asked. The
dispositions, and why only one is a 5xx, are in `docs/auth-screens.md` in the repository.

Every refusal is handed to the `log` dependency as an `AuthFailureReport`: `kind: "callback"` for the
redirect sign-in, `kind: "email"` with `step: "start"` or `"verify"` for the email-code sign-in, and
`kind: "token"` for a token that fails verification.

## Rotate the cookie password

Rotating the password without the steps below signs everyone out, because no cookie in a browser
opens with the new key. With them, nobody is signed out.

1. **Generate** a new password: `openssl rand -base64 32`.
2. **Stage it, if more than one instance serves traffic.** Deploy with the new password added to
   `WORKOS_COOKIE_PASSWORD_PREVIOUS` alongside any retained keys and `WORKOS_COOKIE_PASSWORD`
   unchanged. Wait for the rollout to finish, including upgrading every 0.1.0 instance to this
   version. While a rollout runs, old and new instances serve the same browsers, and an
   old instance cannot open a cookie a new one sealed with a key the old one does not know. It would
   treat that request as signed out. A single instance, or a deployment that replaces every
   instance at once, can skip this step.
3. **Promote it.** Set `WORKOS_COOKIE_PASSWORD` to the new password, list the old one in
   `WORKOS_COOKIE_PASSWORD_PREVIOUS`, retaining any older keys still inside their wait, and deploy.
   During the rollout either current key may seal; once it finishes, every writer uses the new key.
   Cookies sealed with the old key still open, and each one moves to the new key the next
   time its tokens are refreshed. That happens within about five minutes of use, because WorkOS
   access tokens last 300 seconds by default. A cookie is not rewritten merely because an old key
   opened it. A rewrite of an unchanged token pair can land after a concurrent request's refresh
   and put the spent refresh token back in the browser.
4. **Wait** until at least _T_ + _L_.
   - _T_ is when the last instance sealing with the old password stopped serving and its in-flight
     responses were delivered, which is the end of the step 3 rollout. A rollback that seals with
     the old password again restarts the wait.
   - _L_ is, in practice, the application's **Maximum session length** in the WorkOS dashboard
     (Applications, Sessions), capped at the cookie's one-year `Max-Age`. Take the longest value
     the setting has held while the old password was current, not only today's. If you cannot
     establish that, wait the full year.

   Precisely, _L_ = min(_C_, max(_S_, _A_ + _D_)). _C_ is the cookie `Max-Age` (one year). _S_ is
   the longest any session sealed under the old key can last. _A_ is the access token duration, and
   _D_ is the verifier's clock tolerance (five seconds by default) plus clock skew between instances.
   The _A_ + _D_ term covers a session that ends while its access token still verifies locally.
   With any real settings _S_ is far longer, which is why the practical rule is min(_C_, _S_). Every
   cookie sealed with the old key was delivered by _T_. By _T_ + _L_, either the browser has
   discarded it, or its session and its access token have both expired, so removing the key takes
   nothing away from anyone.

5. **Remove** only that old password from `WORKOS_COOKIE_PASSWORD_PREVIOUS` and deploy. Keep all
   other keys whose waits have not elapsed. A cookie still carrying the removed key is anonymous.

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
provider and apply to every client of the session, and the maximum contributes to _S_ in the
rotation rule above. See [WorkOS session settings](https://workos.com/docs/authkit/sessions) for the provider controls.
