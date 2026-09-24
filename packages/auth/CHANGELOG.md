# @littleorgans/auth

## 0.2.0

## 0.1.0

### Minor Changes

- [#57](https://github.com/littleorgans/lilo-moon-template/pull/57) [`53a8bcf`](https://github.com/littleorgans/lilo-moon-template/commit/53a8bcf78ff9d59232655c6d9c282a567dbb4f30) Thanks [@srobinson](https://github.com/srobinson)! - Add the portable JWKS token verification seam, with typed AuthFailure reasons and no
  provider SDK on the path.

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

### Patch Changes

- [#100](https://github.com/littleorgans/lilo-moon-template/pull/100) [`5c459c2`](https://github.com/littleorgans/lilo-moon-template/commit/5c459c2c328f819f5752286b71eff4098a7d658e) Thanks [@srobinson](https://github.com/srobinson)! - Classify malformed provider key sets and corrupt public key material as authentication
  unavailability rather than a bad client token. Propagate unknown runtime failures so the
  application can log them and return a server error.

- [#112](https://github.com/littleorgans/lilo-moon-template/pull/112) [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d) Thanks [@srobinson](https://github.com/srobinson)! - Published `exports` no longer carry the workspace-only `@littleorgans/source` condition. With it,
  an application running `vite dev` through `@littleorgans/vite-config` resolved these installed
  packages to their TypeScript `src` instead of the compiled `dist`, and Node refuses to strip types
  inside `node_modules`. Every JavaScript entry point now resolves to `dist` under every condition.
