# @littleorgans/oxlint-config

The [oxlint](https://oxc.rs/docs/guide/usage/linter) rules the `@littleorgans/*` packages, the
reference app and the reference service lint with. It enables the correctness, suspicious and perf
categories, the type-aware promise rules, and one layout rule: a module under `src/features/` must
not import from `routes/` or the generated route tree. The route imports the feature, never the
reverse.

## Install

```sh
pnpm add --save-dev @littleorgans/oxlint-config oxlint oxlint-tsgolint
```

`oxlint` is a peer dependency. The config names rules by the oxlint release that defines them, and
oxlint refuses a config that names a rule it does not know, so install at least the release in the
peer range. `oxlint-tsgolint` runs the type-aware rules under `oxlint --type-aware`, and its version
must encode the TypeScript release you compile with.

## Use it

oxlint resolves `extends` entries as paths relative to the config file, not as package names, so
point at the installed file. In the workspace root's `.oxlintrc.json`:

```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": ["./node_modules/@littleorgans/oxlint-config/oxlintrc.json"],
  // oxlint does not inherit ignorePatterns through extends, so each workspace lists its own.
  "ignorePatterns": [
    "**/dist/**",
    "**/.output/**",
    "**/build/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/*.gen.*",
    "**/_generated/**",
  ],
}
```

Rules, their options, plugins, categories and overrides come from the package. Rules set in your
own file after `extends` take precedence.
