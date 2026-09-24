# Use the shared configuration

From `0.2.0`, a project takes its compiler options, lint rules, test defaults, Renovate settings and
CI job from this repository instead of copying the files. Package upgrades and the Renovate group
below deliver fixes to them. This page shows the root files that consume each piece. It assumes the
workspace root from [Adopt the packages in a web app](adopt-web-app.md), step 3, with the
`@littleorgans/*` catalog entries at `^0.2.0`. Add two entries to that catalog:

```yaml
catalog:
  "@littleorgans/oxlint-config": "^0.2.0"
  "@littleorgans/tsconfig": "^0.2.0"
```

The root `package.json` from that step already pins `oxlint`, `oxlint-tsgolint`, `vitest` and
`@vitest/coverage-v8`, which these packages use.

This repository consumes the same pieces through the same files, so its root is a working example.

## Compiler options

```sh
pnpm add --save-dev --workspace-root @littleorgans/tsconfig@catalog:
```

`tsconfig.options.json`, which every project's `tsconfig.json` extends:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@littleorgans/tsconfig"
}
```

The root `tsconfig.json` stays as `moon sync` writes it, extending `./tsconfig.options.json`.

## Lint rules

```sh
pnpm add --save-dev --workspace-root @littleorgans/oxlint-config@catalog:
```

oxlint reads `extends` entries as paths relative to the config file, not as package names.
`.oxlintrc.json`:

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

The rules include the layout rule from [Code layout](../code-layout.md): a module under
`src/features/` must not import `routes/` or the generated route tree.

## Test defaults

```sh
pnpm add --save-dev --workspace-root @littleorgans/vite-config@catalog:
```

`vitest.config.ts`, which the inherited `test` and `test-coverage` tasks pass to every project:

```ts
import { testDefaults } from "@littleorgans/vite-config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({ test: testDefaults });
```

`testDefaults` sets where tests live and the per-file v8 coverage floor (80/75/80/80). To change a
setting, spread it: `defineConfig({ test: { ...testDefaults, testTimeout: 10_000 } })`.

## Dependency updates

`renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>littleorgans/lilo-moon-template//renovate/base"]
}
```

Renovate reads `renovate/base.json` from this repository's default branch each run. The preset
updates the Node, pnpm and Moon pins in `.moon/` and `.prototools`, keeps `typescript` and
`oxlint-tsgolint` in one pull request, and puts every `@littleorgans/*` package and the
`moon-ci.yml` tag below in one `littleorgans` pull request, because they release together. To hold
the preset at a release instead, append the tag: `…//renovate/base#v0.2.0`.

## CI

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  moon:
    name: Moon
    permissions:
      contents: read
    uses: littleorgans/lilo-moon-template/.github/workflows/moon-ci.yml@v0.2.0
    with:
      runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}

  ci:
    name: CI
    needs: moon
    if: always()
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Require moon ci to pass
        run: test "$RESULT" = success
        env:
          RESULT: ${{ needs.moon.result }}
```

The called workflow checks out your repository, installs the Node pinned in `.moon/toolchains.yml`
and Moon from `.prototools`, runs `pnpm install --frozen-lockfile`, then `moon ci`. Your root
`moon.yml` decides what `moon ci` runs, including `secrets`, `audit` and `tsgolint-lockstep`.
When the base revision is not a commit in the checkout (a new branch's all-zero SHA, a force
push's replaced commit, or an event without a base), the workflow uses `moon ci --force` to check
every task.
Put an exact three-part version in a block-style `node.version` setting; plain, single-quoted and
double-quoted values, indentation changes, CRLF and trailing comments are supported. Ranges and
inline YAML mappings are not supported by the bootstrap reader.

- **The tag.** Call a release tag, `@v<version>`, matching your `@littleorgans/*` version. The
  `littleorgans` Renovate group moves both together and pins the tag to its commit digest. No
  floating `@v0` tag exists: release tags never move.
- **Secrets.** The workflow declares none, so pass none. `secrets: inherit` would hand it every
  secret the caller can read.
- **Permissions.** It needs `contents: read` and can only narrow what the calling job grants.
- **Concurrency.** Keep it in the caller only. A called workflow reports the caller's workflow name,
  so a group of its own would cancel the caller.
- **The required check.** The called job reports as `Moon / moon ci`. Require `CI` in branch
  protection: that job always runs, and it fails unless `moon ci` succeeded. A skipped required
  check would count as passing.
- **Organization policy.** GitHub runs a public repository's reusable workflow from another
  organization only when your organization allows it: **Settings → Actions → General → Policies**,
  either all actions and reusable workflows, or an allow list that includes
  `littleorgans/lilo-moon-template/.github/workflows/moon-ci.yml@*`.
