# @littleorgans/auth-session

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @littleorgans/auth@0.2.1
  - @littleorgans/auth-workos@0.2.1

## 0.2.0

### Minor Changes

- [#117](https://github.com/littleorgans/lilo-moon-template/pull/117) [`d9df2d3`](https://github.com/littleorgans/lilo-moon-template/commit/d9df2d366bc0eee83f0f02f7b08a1927e22dfeee) Thanks [@srobinson](https://github.com/srobinson)! - Rotate the session cookie password without signing anyone out. `WORKOS_COOKIE_PASSWORD_PREVIOUS`
  takes retired passwords, comma-separated, or as a JSON array of exact strings for a password
  containing a comma or surrounding whitespace. Every cookie is still sealed with
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

- [#120](https://github.com/littleorgans/lilo-moon-template/pull/120) [`6adb29b`](https://github.com/littleorgans/lilo-moon-template/commit/6adb29bc3df289b4fb58748d3f4c094e3c782708) Thanks [@srobinson](https://github.com/srobinson)! - A sign-in the provider refuses because it rate-limited the request or is unavailable, the `retry`
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

### Patch Changes

- Updated dependencies []:
  - @littleorgans/auth@0.2.0
  - @littleorgans/auth-workos@0.2.0

## 0.1.0

### Minor Changes

- [#111](https://github.com/littleorgans/lilo-moon-template/pull/111) [`83e4b64`](https://github.com/littleorgans/lilo-moon-template/commit/83e4b64f8240ef92e3fff34b414354928bcffbfa) Thanks [@srobinson](https://github.com/srobinson)! - Refresh an access token that verifies but expires within 20 seconds (`REFRESH_MARGIN_SECONDS`), so
  `readUserAccess` no longer forwards a token that expires on the way to the service. `exp` is read
  only after the signature has verified, and a token without a numeric `exp` is served as before. The
  early refresh goes through the existing shared refresh. If it fails for any reason, including a
  provider outage or `invalid_grant`, the person stays signed in on the token that verified, the
  cookie is left alone apart from a rotated replacement kept when its verification was unavailable,
  and the failure is logged with the new `TokenFailure` status `signed-in`. An expired token is
  handled exactly as before.

- [#102](https://github.com/littleorgans/lilo-moon-template/pull/102) [`2a91cdd`](https://github.com/littleorgans/lilo-moon-template/commit/2a91cdded721aec988b970f5522ca7e52234229a) Thanks [@srobinson](https://github.com/srobinson)! - The email sign-in handlers refuse cross-origin POSTs and ask a throttle before calling the provider.
  `startEmailSignIn` and `completeEmailSignIn` answer 403 unless the request's `Origin` equals the
  application's own, exactly as sign-out always has, so a page on another site can no longer make a
  visitor's browser send codes. Their deps gain `origin` and a required `throttle`, which is asked
  about the client and the lower-cased address before each provider call; a refusal is a 429 with
  `Retry-After`. An address over 254 characters, RFC 5321's limit, is refused with 400 before the
  throttle or the provider sees it.

  `createAuthRuntime` requires a `throttle` option. The packages ship no rate limiter, because one
  kept in a single process's memory is wrong for any deployment with more than one instance: back it
  with a shared store, or pass one that always allows when something in front of the application
  already limits these routes. The runtime also gains `origin()`, and `refuseCrossOrigin` is exported
  for an application's own POST routes.

- [#97](https://github.com/littleorgans/lilo-moon-template/pull/97) [`af11e53`](https://github.com/littleorgans/lilo-moon-template/commit/af11e533b4b63268760ddfc40037eee9af6e1123) Thanks [@srobinson](https://github.com/srobinson)! - Publish under the `@littleorgans` npm scope instead of `@lilo-moon`. Imports and the workspace
  source export condition move from `@lilo-moon/*` and `@lilo-moon/source` to `@littleorgans/*` and
  `@littleorgans/source`. Every package now ships an MIT `LICENSE`. Nothing was published under the
  old scope, so no deprecation is needed.

- [#93](https://github.com/littleorgans/lilo-moon-template/pull/93) [`2729a45`](https://github.com/littleorgans/lilo-moon-template/commit/2729a4509a3c553734afc21165da572b77d62dbd) Thanks [@srobinson](https://github.com/srobinson)! - Prepare the baseline libraries for independent consumers. Require expiring access tokens, preserve
  sessions during provider outages, namespace application cookies, and use POST signout with the
  provider logout redirect. Organization provisioning is an explicit application policy, and database
  scoping no longer inserts application rows.

  Keep TanStack server route boundaries visible to the compiler. The route option factories are
  replaced by literal server configuration and a shared postHandlers helper. Browser builds now reject
  server dependencies. Vite configuration takes the consuming workspace root and publishes compiled
  exports. CSS source registration works from installed libraries, themes accept application names,
  and heading size can be chosen independently of document level.

  These changes intentionally revise the initial APIs before the first external release.

- [#110](https://github.com/littleorgans/lilo-moon-template/pull/110) [`955f141`](https://github.com/littleorgans/lilo-moon-template/commit/955f1411efeb92266b17d8cac6fae2de687607e2) Thanks [@srobinson](https://github.com/srobinson)! - `serviceOrigins` accepts `{ origin: "http://api:3000", insecure: true }` next to plain strings, so
  a web app can call a service over plain http inside a cluster. The opt-in is per origin: it covers
  that exact scheme, host and port, and there is no setting that allows http everywhere. `insecure`
  must be `true`, and an insecure entry must be `http`. String entries keep the old rule (HTTPS except
  on localhost), and the error for a refused http origin now names the object form.
  `InsecureServiceOrigin` and `ServiceOrigin` are exported from both packages.

- [#107](https://github.com/littleorgans/lilo-moon-template/pull/107) [`b9e9ac0`](https://github.com/littleorgans/lilo-moon-template/commit/b9e9ac0c00d0bf48967be0429ea12f3fa337d640) Thanks [@srobinson](https://github.com/srobinson)! - Add a way for server code to call a service as the signed-in person. `readUserAccess` in
  `@littleorgans/auth-session`, exposed as `asUser()` on the `@littleorgans/auth-tanstack` runtime,
  returns the same five states as `Access`. The signed-in state carries a `fetch` that sets
  `Authorization: Bearer` with the person's access token, refreshed through the existing shared
  refresh when it has expired. There is no accessor for the raw token: it lives only in that
  function's closure, so it cannot be returned from a loader, serialised or logged by accident.

  `fetch` sends only to origins listed in the new `serviceOrigins` runtime option (HTTPS except on
  localhost, origin only, empty by default) and rejects anything else before a request is made.
  `anonymous`, `ended`, `broken` and `unavailable` carry no `fetch` and are never thrown.

### Patch Changes

- [#101](https://github.com/littleorgans/lilo-moon-template/pull/101) [`fad4cdd`](https://github.com/littleorgans/lilo-moon-template/commit/fad4cdd0e5db39973131afd13dbeb4d65f6c6311) Thanks [@srobinson](https://github.com/srobinson)! - Concurrent requests that refresh one expired session now share a single provider call. WorkOS
  rotates the refresh token on every use, so parallel loaders each spending the same token could see
  one of them refused with `invalid_grant` and clear the cookie the others had just renewed. The call
  is shared in process memory, keyed by a SHA-256 digest of the refresh token and removed when it
  settles; each request still verifies the result and writes its own cookie. Separate instances rely
  on WorkOS's 30-second reuse window.

- [#112](https://github.com/littleorgans/lilo-moon-template/pull/112) [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d) Thanks [@srobinson](https://github.com/srobinson)! - Published `exports` no longer carry the workspace-only `@littleorgans/source` condition. With it,
  an application running `vite dev` through `@littleorgans/vite-config` resolved these installed
  packages to their TypeScript `src` instead of the compiled `dist`, and Node refuses to strip types
  inside `node_modules`. Every JavaScript entry point now resolves to `dist` under every condition.
- Updated dependencies [[`5c459c2`](https://github.com/littleorgans/lilo-moon-template/commit/5c459c2c328f819f5752286b71eff4098a7d658e), [`bba230c`](https://github.com/littleorgans/lilo-moon-template/commit/bba230c1301cd2c04e258749395dff97b2abe4d8), [`53a8bcf`](https://github.com/littleorgans/lilo-moon-template/commit/53a8bcf78ff9d59232655c6d9c282a567dbb4f30), [`af11e53`](https://github.com/littleorgans/lilo-moon-template/commit/af11e533b4b63268760ddfc40037eee9af6e1123), [`2729a45`](https://github.com/littleorgans/lilo-moon-template/commit/2729a4509a3c553734afc21165da572b77d62dbd), [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d)]:
  - @littleorgans/auth@0.1.0
  - @littleorgans/auth-workos@0.1.0
