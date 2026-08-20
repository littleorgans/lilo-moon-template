# Repository contract

This repository is a language agnostic monorepo baseline. Moon owns the task graph for every
language. pnpm is only the JavaScript package manager. The `projects` settings in
`.moon/workspace.yml` define the workspace, and `javascript.packageManager` in
`.moon/toolchains.yml` selects pnpm.

Follow this contract for agent and human changes. Keep every rule true as the repository evolves.

## Run the gates

- Run `just check` during development. The `check` recipe in `justfile` runs `root:format` and
  `root:lint-fix`, then verifies every project with `moon check --all`. It changes files when oxfmt
  or oxlint can fix them.
- Run `just ci` before delivery. The `ci` recipe is an alias for the read only `moon ci` command,
  which is also the command in `.github/workflows/ci.yml` under `jobs.ci`.
- Keep the two recipes distinct. `check` repairs mechanical issues before verification, while `ci`
  proves that a clean checkout needs no repair. There is deliberately no separate `fix` recipe.
- Declare task commands, inputs, outputs, and dependencies in Moon configuration. If a command
  needs substantial logic, implement that logic once in the owning package script or shell script
  and invoke it from Moon. Keep `justfile` as aliases over Moon so local work and CI use one graph.

## Add a workspace member

Follow this procedure so Moon, pnpm, TypeScript, and CI discover the same project.

1. Create the member under `apps/<name>`, `packages/<name>`, or `services/<name>`. Both
   `projects.globs` in `.moon/workspace.yml` and `packages` in `pnpm-workspace.yaml` scan those
   locations.
2. Add `moon.yml` with the real language and layer. A publishable TypeScript library uses:

   ```yaml
   language: "typescript"
   layer: "library"
   ```

   Moon detects the JavaScript toolchain from the `package.json` manifest. Confirm detection and
   schema with `moon toolchain info javascript`. The `language` and `layer` fields in `moon.yml` are
   project metadata and inherited task filters. `inheritedBy.toolchains` in `.moon/tasks/node.yml`
   gives a JavaScript project `typecheck`, `test`, and `test-watch`. Both
   `inheritedBy.toolchains` and `inheritedBy.layers` in `.moon/tasks/node-library.yml` give a
   JavaScript library `build`. Keep application build tasks in their own layer scoped task file.

3. For a JavaScript or TypeScript member, add `package.json` with a unique workspace name. Put
   runtime and development dependencies in that manifest, then reference shared versions with
   `catalog:` from `pnpm-workspace.yaml`. Publishable libraries must define a version plus real
   `exports`, `types`, `files`, and `publishConfig` entries that point at built files. Use
   `packages/collections/package.json` as the package shape.
4. For TypeScript, add `tsconfig.json` with `extends` pointing at the root
   `tsconfig.options.json`, plus `include` entries for source and tests. The library example is
   `packages/collections/tsconfig.json`. Keep `composite`, `declaration`, and `declarationMap` from
   `compilerOptions` in `tsconfig.options.json` because Moon routes typecheck output to its cache.
5. For a publishable library, add `tsconfig.build.json` for the `dist` build. Follow
   `compilerOptions`, `include`, and `exclude` in `packages/collections/tsconfig.build.json`: extend
   the member config, set `composite` and `incremental` to `false`, set `rootDir` to `src`, set
   `outDir` to `dist`, include only `src/**/*.ts`, and exclude tests. `composite: false` lets the
   first compiler pass emit JavaScript without declarations. `incremental: false` keeps build
   information out of `dist`, and `include` limits the published program to source files regardless
   of test filenames. `tasks.build` in `.moon/tasks/node-library.yml` emits
   JavaScript and declarations from that config.
6. Add source and tests, then run `pnpm install` to update the lockfile and workspace links. Keep
   the root `package.json` limited to repository tools because project dependencies belong to the
   project that imports them.
7. Run `moon sync`. The `typescript.syncProjectReferences` and
   `typescript.routeOutDirToCache` settings in `.moon/toolchains.yml` update project references and
   cache output paths. Do not hand edit the generated `references` or cache `outDir` values.
8. Inspect the result with `moon project <project-id>` and `moon task <project-id>:<task>`. These
   commands prove that Moon found the member and applied the intended task layer.
9. Prove the relevant gates can fail, revert each deliberate violation, then run `just check` and
   `just ci`.

## Configure Moon tasks

- Put tasks shared by every JavaScript project in `.moon/tasks/node.yml`. Put a task needed by one
  layer in a file such as `.moon/tasks/node-library.yml` with an `inheritedBy.layers` filter. Every
  JavaScript project inherits `node.yml`, so a library build placed there leaks into applications.
- Write dependency targets with the scope separator, such as `^:typecheck`. Moon parses
  `^typecheck` as a different target and cannot resolve the intended dependency.
- Use `moon check --all` to check all projects. The `:task` all projects form is a CLI target and is
  invalid inside a task dependency.
- Set a task `type` to `build`, `run`, or `test`. Use `build` for tasks that produce outputs, such as
  `typecheck`. Classify validation tasks as `test` and mutating fixers as `run`; `moon check` includes
  builds and tests and must leave the working tree unchanged.
- Configure local behavior with explicit `options`, including `cache: false`, `runInCI: false`, or
  `persistent: true` where required. Moon v2 has no `local: true` task key.
- Run `moon toolchain info <id>` before editing toolchain YAML. The installed plugin prints its
  accepted schema, while online documentation can describe another plugin version.
- Hash every file that can change a build task's outputs in `tasks.<name>.inputs`. The
  `tasks.build.inputs` list in `.moon/tasks/node-library.yml` includes the member manifest, both
  member TypeScript configs, and root `tsconfig.options.json` alongside `@globs(sources)` because
  compiler configuration changes must invalidate cached artifacts.
- After renaming the repository directory, run `moon clean`, remove `node_modules`, and reinstall.
  The Moon cache and installed package links contain absolute paths from the old directory.

## Prove every gate

A gate that passes on an empty repository has proven nothing. Treat this as the repository's
central discipline.

For every change that touches a gate, add a deliberate violation and run the narrow gate. Record
the command, a representative failure line, and the exit code. At minimum, prove a real type error
fails `moon run <project>:typecheck`, a broken assertion fails `moon run <project>:test`, and an
unhandled promise fails `moon run root:lint`. If format selection changes, prove malformed formatting
fails `moon run root:format-check`. Revert each violation before trusting the final green run.

PR #18 is the worked CI example. GitHub Actions run
[32329628242](https://github.com/littleorgans/lilo-moon-template/actions/runs/32329628242) failed on a
deliberate oxfmt violation. Run
[32329693330](https://github.com/littleorgans/lilo-moon-template/actions/runs/32329693330) passed after
the violation was reverted. The red run proves the workflow observed real work; the green run proves
the valid state.

## Write tests

- Put focused project tests directly under `tests/`. Put tests that cross a package, process,
  network, or storage boundary under `tests/integration/`.
- Name both kinds `*.test.*` or `*.spec.*`. The shared `vitest.config.ts` discovers those names and
  measures every source file under `src/`.
- Run `moon run <project>:test-coverage` for the narrow coverage gate. Moon runs that task for every
  JavaScript project in `moon check --all` and `moon ci`.
- Treat the coverage thresholds as a floor for untested code. Prove each test's assertion by making
  the named behavior wrong, observing the test fail, and restoring the implementation before
  delivery.

## Follow JavaScript and TypeScript rules

- Keep `oxlint-tsgolint` installed when `tasks.lint.command` in `moon.yml` uses `--type-aware`.
  oxlint silently skips type aware rules when the package is absent.
- Pin `oxlint-tsgolint` exactly. Its npm version encodes the TypeScript release as
  `MAJOR.MINOR.(typescriptPatch * 1000 + tsgolintPatch)`, so `7.0.2001` is TypeScript
  `7.0.2` with tsgolint patch `1`. Bump that exact pin in the root `package.json` in
  lockstep with the `typescript` catalog pin in `pnpm-workspace.yaml`. The
  `tsgolint-lockstep` task fails when the encoded release does not match the catalog
  pin, or when the version cannot be decoded. The `typescript lockstep` group in
  `renovate.json` only batches the two updates into one PR.
- Use the Oxc editor extension for oxlint and oxfmt. TypeScript 7 has no
  `lib/tsserver.js`, so the editor uses `js/ts.tsdk.path` at `node_modules/typescript`
  with `js/ts.experimental.useTsgo` and the TypeScript 7 extension. Format on save
  must match `moon run root:format`. Do not enable Prettier or Biome.
- Keep `--no-error-on-unmatched-pattern` on both oxlint and oxfmt commands in `moon.yml`. Both tools
  exit 1 when they match zero files. The flag lets a repository with no TypeScript pass, which also
  means a green lint gate over an empty selection proves nothing.
- Atlas SQL migrations own the database schema. `drizzle/_generated/schema.ts` is generated by
  `moon run root:drizzle-generate`, and hand edits are lost. Never generate a migration from this
  file because Drizzle introspection is not round-trip clean. Run `root:drizzle-check` after an
  Atlas migration changes.
- Configure lint rules as `error` or leave them absent. The `rules` and `categories` settings in
  `.oxlintrc.json` contain no `warn` level because warnings let violations accumulate.
- Use double quotes and a print width of 100. The `singleQuote` and `printWidth` settings in
  `.oxfmtrc.json` define that format.

## Follow repository conventions

- Use Conventional Commits. The Git history and pull request titles depend on the type, optional
  scope, and concise description to communicate the change and support squash merges.
- Search before adding a helper, type, or constant. Reuse or generalize the existing definition so
  the repository has one implementation of each concept.
- Describe only state present on the current branch. Mark filed work with its issue number until
  the implementation lands.
- Keep a change within its owning project. Moon uses project boundaries for dependencies, caching,
  and affected checks, so unrelated root changes widen every run.
- Let Renovate open dependency PRs from `renovate.json`. The npm manager updates
  `package.json`, including `packageManager`, and pnpm catalog pins in
  `pnpm-workspace.yaml`. GitHub Actions versions and `actions/setup-node`'s
  `node-version` come from the github-actions manager. Regex managers cover the Node
  and pnpm pins in `.moon/toolchains.yml`. Moon and proto CLI versions are not
  declared in this repository, so Renovate cannot bump them.

## Do not

- Do not describe this repository as a TypeScript monorepo. The baseline supports multiple
  languages, and Moon owns their shared graph.
- Do not add application dependencies to the root `package.json`. The root manifest owns repository
  tools, while each application owns the code it imports.
- Do not reimplement a Moon task in `justfile`. Duplicate command paths drift and make local results
  differ from CI.
- Do not put layer specific tasks in `.moon/tasks/node.yml`. Its `inheritedBy.toolchains` filter
  applies them to every JavaScript project.
