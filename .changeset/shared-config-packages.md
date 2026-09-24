---
"@littleorgans/tsconfig": minor
"@littleorgans/oxlint-config": minor
"@littleorgans/vite-config": minor
---

Share the workspace configuration as packages instead of files to copy.

- `@littleorgans/tsconfig` holds the strict compiler options. Extend it from the root
  `tsconfig.options.json` with `"extends": "@littleorgans/tsconfig"`.
- `@littleorgans/oxlint-config` holds the lint rules, with a new layout rule: a module under
  `src/features/` must not import `routes/` or the generated route tree. oxlint resolves `extends`
  as a path, so extend `./node_modules/@littleorgans/oxlint-config/oxlintrc.json` and keep
  `ignorePatterns` in your own `.oxlintrc.json`: oxlint does not inherit them.
- `@littleorgans/vite-config/vitest` exports `testDefaults`, the test locations and v8 coverage
  thresholds, for `defineConfig({ test: testDefaults })`. `vitest` is an optional peer.
