# @littleorgans/db-tools

## 0.1.0

### Minor Changes

- [#109](https://github.com/littleorgans/lilo-moon-template/pull/109) [`d5974c8`](https://github.com/littleorgans/lilo-moon-template/commit/d5974c87047c0ce248a1a65e3f1285ba6efdc8da) Thanks [@srobinson](https://github.com/srobinson)! - Add `@littleorgans/db-tools` and its `rls-verify` command, which proves row level security holds
  in your own Postgres database without copying this repository's scripts. It checks that the
  request role cannot bypass row level security, that every table is enabled and forced, and that
  absent or expired claims reveal no rows.

  By default it only reads. The session is read-only from its startup parameters, so a login trigger
  cannot write either, every verification transaction is explicitly read-only and rolled back, and
  catalog reads ignore the database's search path. `--disposable` instead creates a scratch database
  on the same server, applies migrations (by default the ones `@littleorgans/db` ships) and an
  optional seed, verifies it and drops it. Exit codes separate a failed check (1) from a usage error
  (2) and a setup failure (3), and output never includes the password. `rlsChecks`, `asRole` and
  `runChecks` let a project run its own schema-specific checks alongside. `pg` (`^8.15.0`) is a peer
  dependency, and `@littleorgans/db` an optional one.

### Patch Changes

- [#112](https://github.com/littleorgans/lilo-moon-template/pull/112) [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d) Thanks [@srobinson](https://github.com/srobinson)! - Published `exports` no longer carry the workspace-only `@littleorgans/source` condition. With it,
  an application running `vite dev` through `@littleorgans/vite-config` resolved these installed
  packages to their TypeScript `src` instead of the compiled `dist`, and Node refuses to strip types
  inside `node_modules`. Every JavaScript entry point now resolves to `dist` under every condition.
- Updated dependencies [[`a66f0bd`](https://github.com/littleorgans/lilo-moon-template/commit/a66f0bd2b7c673bfe9fd7fded4c1c9060db3718e), [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d), [`af11e53`](https://github.com/littleorgans/lilo-moon-template/commit/af11e533b4b63268760ddfc40037eee9af6e1123), [`ce6522b`](https://github.com/littleorgans/lilo-moon-template/commit/ce6522b96f682a2e39ba8294652ce1ba551958dd), [`2729a45`](https://github.com/littleorgans/lilo-moon-template/commit/2729a4509a3c553734afc21165da572b77d62dbd), [`352e84b`](https://github.com/littleorgans/lilo-moon-template/commit/352e84b91f5535d55c6d297237f559ec736f783d), [`4e58cc5`](https://github.com/littleorgans/lilo-moon-template/commit/4e58cc55114f2c1fe6209f3c710c15dad6162009)]:
  - @littleorgans/db@0.1.0
