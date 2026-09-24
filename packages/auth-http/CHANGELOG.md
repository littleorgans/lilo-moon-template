# @littleorgans/auth-http

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @littleorgans/auth@0.2.0

## 0.1.0

### Minor Changes

- [#100](https://github.com/littleorgans/lilo-moon-template/pull/100) [`5c459c2`](https://github.com/littleorgans/lilo-moon-template/commit/5c459c2c328f819f5752286b71eff4098a7d658e) Thanks [@srobinson](https://github.com/srobinson)! - Add `@littleorgans/auth-http`, bearer authentication for HTTP services. `createAuthenticator`
  turns a Fetch `Request` into a `Principal` or a rejection, and `rejectionResponse` answers
  missing, malformed, expired and invalid tokens with 401 and a `WWW-Authenticate: Bearer`
  challenge, a refused `authorize` hook with 403, and a JWKS or provider outage with 503. Bodies
  carry only an error code. `@littleorgans/auth-http/hono` adds `requireAuth` Hono middleware, and
  `loadServiceConfig` validates `PORT`, `DATABASE_URL` and `WORKOS_CLIENT_ID`, listing every
  problem at once without echoing values.

  `@littleorgans/auth` is a peer dependency, because the service builds the verifier and
  `auth-http` recognizes its `AuthError` by class. `hono` (`^4.13.0`) is an optional peer, needed
  only for the adapter. Install them alongside the package.

### Patch Changes

- [#112](https://github.com/littleorgans/lilo-moon-template/pull/112) [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d) Thanks [@srobinson](https://github.com/srobinson)! - Published `exports` no longer carry the workspace-only `@littleorgans/source` condition. With it,
  an application running `vite dev` through `@littleorgans/vite-config` resolved these installed
  packages to their TypeScript `src` instead of the compiled `dist`, and Node refuses to strip types
  inside `node_modules`. Every JavaScript entry point now resolves to `dist` under every condition.
- Updated dependencies [[`5c459c2`](https://github.com/littleorgans/lilo-moon-template/commit/5c459c2c328f819f5752286b71eff4098a7d658e), [`53a8bcf`](https://github.com/littleorgans/lilo-moon-template/commit/53a8bcf78ff9d59232655c6d9c282a567dbb4f30), [`af11e53`](https://github.com/littleorgans/lilo-moon-template/commit/af11e533b4b63268760ddfc40037eee9af6e1123), [`2729a45`](https://github.com/littleorgans/lilo-moon-template/commit/2729a4509a3c553734afc21165da572b77d62dbd), [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d)]:
  - @littleorgans/auth@0.1.0
