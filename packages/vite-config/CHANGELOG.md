# @littleorgans/vite-config

## 0.2.0

### Minor Changes

- [#119](https://github.com/littleorgans/lilo-moon-template/pull/119) [`e9b2410`](https://github.com/littleorgans/lilo-moon-template/commit/e9b2410ec0c7e9025acd014697b4b1bb5d6b577b) Thanks [@srobinson](https://github.com/srobinson)! - Share the workspace configuration as packages instead of files to copy.

  - `@littleorgans/tsconfig` holds the strict compiler options. Extend it from the root
    `tsconfig.options.json` with `"extends": "@littleorgans/tsconfig"`.
  - `@littleorgans/oxlint-config` holds the lint rules, with a new layout rule: a module under
    `src/features/` must not import `routes/` or the generated route tree. oxlint resolves `extends`
    as a path, so extend `./node_modules/@littleorgans/oxlint-config/oxlintrc.json` and keep
    `ignorePatterns` in your own `.oxlintrc.json`: oxlint does not inherit them.
  - `@littleorgans/vite-config/vitest` exports `testDefaults`, the test locations and v8 coverage
    thresholds, for `defineConfig({ test: testDefaults })`. `vitest` is an optional peer.

### Patch Changes

- [#121](https://github.com/littleorgans/lilo-moon-template/pull/121) [`0a21004`](https://github.com/littleorgans/lilo-moon-template/commit/0a210042d1b305c989570385577e1f7dc466137c) Thanks [@srobinson](https://github.com/srobinson)! - `testDefaults` leaves a sibling project whose directory name extends the current one (such as
  `packages/db-tools` next to `packages/db`) out of coverage. Vitest treated its files as inside the
  project because their paths start with the project root.

## 0.1.0

### Minor Changes

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
