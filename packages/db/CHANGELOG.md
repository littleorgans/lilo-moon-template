# @littleorgans/db

## 0.2.0

### Minor Changes

- [#122](https://github.com/littleorgans/lilo-moon-template/pull/122) [`770d052`](https://github.com/littleorgans/lilo-moon-template/commit/770d0521cefd3e7fdb7b399eb35ea78428300dcd) Thanks [@srobinson](https://github.com/srobinson)! - `createDatabase` takes the project's Drizzle schema as a new `schema` option, such as the module
  `db-tools drizzle-generate` writes, and types every scoped transaction by it. `Database`,
  `DatabaseOptions` and `ScopedTransaction` gain a `TSchema` type parameter, so
  `withPrincipal`'s `tx` is `NodePgDatabase<typeof schema>` and `tx.query` is typed. The parameter
  defaults to Drizzle's empty schema, so code that passes no schema and names the types without an
  argument compiles and behaves as before.

  The schema describes tables and columns only. Row level security still decides which rows a query
  sees, and `rls-verify` remains the check that proves the policies.

### Patch Changes

- Updated dependencies []:
  - @littleorgans/auth@0.2.0

## 0.1.0

### Minor Changes

- [#103](https://github.com/littleorgans/lilo-moon-template/pull/103) [`a66f0bd`](https://github.com/littleorgans/lilo-moon-template/commit/a66f0bd2b7c673bfe9fd7fded4c1c9060db3718e) Thanks [@srobinson](https://github.com/srobinson)! - Ship the identity migrations and a login-role grant, so a service can set up its own database
  without this repository. `migrations/` holds the raw SQL that creates the `accounts` and
  `profiles` tables, their forced row level security policies, and the `authenticated` role that
  `withPrincipal` switches to. Apply the files in file-name order with `psql` or any migration tool.
  Atlas is not required.

  `grants/login-role.sql` grants `authenticated` to the role your service logs in as, with
  `INHERIT FALSE, SET TRUE, ADMIN FALSE`. Pass the role name as the psql variable `login_role`.
  Without this grant every `withPrincipal` call fails with
  `permission denied to set role "authenticated"`. It needs Postgres 16 or later. The new README
  covers setup, the role model and least privilege.

- [#112](https://github.com/littleorgans/lilo-moon-template/pull/112) [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d) Thanks [@srobinson](https://github.com/srobinson)! - `@types/pg` (`^8.15.0`) is now a peer dependency, beside `pg`. A scoped transaction is Drizzle's
  `NodePgDatabase`, and the result of `tx.execute()` is typed by `@types/pg`. Without it, those
  results became `any` without an error, so a query result assigned to the wrong type compiled.
  npm and pnpm's default settings install the peer for you. With `autoInstallPeers: false`, add
  `@types/pg` to your devDependencies.

- [#97](https://github.com/littleorgans/lilo-moon-template/pull/97) [`af11e53`](https://github.com/littleorgans/lilo-moon-template/commit/af11e533b4b63268760ddfc40037eee9af6e1123) Thanks [@srobinson](https://github.com/srobinson)! - Publish under the `@littleorgans` npm scope instead of `@lilo-moon`. Imports and the workspace
  source export condition move from `@lilo-moon/*` and `@lilo-moon/source` to `@littleorgans/*` and
  `@littleorgans/source`. Every package now ships an MIT `LICENSE`. Nothing was published under the
  old scope, so no deprecation is needed.

- [#99](https://github.com/littleorgans/lilo-moon-template/pull/99) [`ce6522b`](https://github.com/littleorgans/lilo-moon-template/commit/ce6522b96f682a2e39ba8294652ce1ba551958dd) Thanks [@srobinson](https://github.com/srobinson)! - Consumers now own the versions of shared runtime libraries. `@littleorgans/db` takes `drizzle-orm`
  (`^0.45.0`) and `pg` (`^8.15.0`) as peer dependencies instead of exact dependencies, so an
  application on another 0.45 release shares one Drizzle copy with the package rather than failing
  to typecheck against a nested second copy. `@littleorgans/ui` takes `tailwindcss` (`^4.0.0`) as a
  peer. Install these alongside the packages.

  Open-ended peer ranges become caret ranges on the supported major: React `^19.0.0`,
  `@tanstack/react-start` `^1.168.0` and Vite `^8.0.0`. All published packages now release together
  at one version.

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

- [#59](https://github.com/littleorgans/lilo-moon-template/pull/59) [`4e58cc5`](https://github.com/littleorgans/lilo-moon-template/commit/4e58cc55114f2c1fe6209f3c710c15dad6162009) Thanks [@srobinson](https://github.com/srobinson)! - Add the Principal-scoped Postgres access layer: withPrincipal is the only
  place claims enter the database.

### Patch Changes

- [#112](https://github.com/littleorgans/lilo-moon-template/pull/112) [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d) Thanks [@srobinson](https://github.com/srobinson)! - Published `exports` no longer carry the workspace-only `@littleorgans/source` condition. With it,
  an application running `vite dev` through `@littleorgans/vite-config` resolved these installed
  packages to their TypeScript `src` instead of the compiled `dist`, and Node refuses to strip types
  inside `node_modules`. Every JavaScript entry point now resolves to `dist` under every condition.
- Updated dependencies [[`5c459c2`](https://github.com/littleorgans/lilo-moon-template/commit/5c459c2c328f819f5752286b71eff4098a7d658e), [`53a8bcf`](https://github.com/littleorgans/lilo-moon-template/commit/53a8bcf78ff9d59232655c6d9c282a567dbb4f30), [`af11e53`](https://github.com/littleorgans/lilo-moon-template/commit/af11e533b4b63268760ddfc40037eee9af6e1123), [`2729a45`](https://github.com/littleorgans/lilo-moon-template/commit/2729a4509a3c553734afc21165da572b77d62dbd), [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d)]:
  - @littleorgans/auth@0.1.0
