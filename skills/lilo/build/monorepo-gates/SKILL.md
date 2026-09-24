---
name: monorepo-gates
description: Work inside a Moon and pnpm workspace built from the littleorgans reference, covering which task layer a member inherits, adding a workspace member, configuring Moon tasks, proving a gate can fail, test placement, the TypeScript 7 and oxlint-tsgolint lockstep, shared config packages, hooks and the reusable CI workflow. Use when adding an app, service or package to a workspace, editing Moon tasks or shared configuration, a gate passes or fails unexpectedly, or before delivering any change.
---

# Work with the gates

Moon owns the task graph and pnpm installs packages. `moon ci` is what CI runs, and anything
checkable is a gate rather than a rule to remember. This skill says which gate holds what, and the
judgment the gates leave to you. Every path here is in `littleorgans/lilo-moon-template`. Read them
at the tag that matches the installed `@littleorgans/*` version.

`AGENTS.md` is that repository's working contract. Its sections "Add a workspace member",
"Configure Moon tasks", "Prove every gate", "Write tests" and "Follow JavaScript and TypeScript
rules" describe the reference workspace. For a generated project, use
`docs/guides/shared-config.md` for installed configuration and its generated `AGENTS.md` for local
gates; repository source paths and publishing tasks do not carry over. `docs/decisions.md`,
"What a green gate actually proves", is why the discipline exists.

## Two commands

`just check` repairs formatting and lint, then runs `moon check --all`. `just ci` runs `moon ci`,
read only, exactly as CI does. Use `check` while working and `ci` before delivering. The `justfile`
holds aliases only: a command that exists in two places drifts, so a new command becomes a Moon
task.

## Pick the layer, and the task follows

A member's `moon.yml` `layer`, `language` and `tags` select what it inherits from `.moon/tasks/`:

- every JavaScript member gets `typecheck`, `test` and `test-coverage` from `.moon/tasks/node.yml`;
- a JavaScript library gets `build` from `.moon/tasks/node-library.yml`; the separate
  `ts-library` tag selects its declaration build as a root lint dependency;
- an application tagged `web-app` gets Vite and Nitro from `.moon/tasks/node-application.yml`;
- an application tagged `node-service` gets `build`, `dev` and `start` from
  `.moon/tasks/node-service.yml`.

Choose by what the member is, then confirm with `moon project <id>` and `moon task <id>:<task>`.
A task that one layer needs goes in that layer's file, never in `node.yml`, where every member
inherits it. A JavaScript member's dependency edge is its `workspace:*` line; it never declares
`dependsOn`. Its own dependencies go in its own manifest, pinned through the `catalog:`, never in
the root `package.json`, which holds repository tools.

## Prove the gate, not only the change

A gate that passes on nothing proved nothing, and this repository has shipped three that did: lint
with type-aware rules silently off, coverage over tests that asserted nothing, and a documented
step no task ran. When a change touches a gate, its selection or its configuration, plant a
violation, run the narrow gate, see it fail, and revert. Report the command and the failure line.
The same goes for a test: break the behavior it names and watch it fail. The coverage floor fails
untested files. It cannot tell whether a test asserts anything.

## Configuration comes from packages

Compiler options, lint rules and test defaults are `@littleorgans/tsconfig`,
`@littleorgans/oxlint-config` and `@littleorgans/vite-config/vitest`, extended by the root files
`docs/guides/shared-config.md` shows. A rule that is wrong for every project is fixed in the
package, not in one project's copy. Rules are `error` or absent, never `warn`, because warnings
accumulate. oxlint does not inherit `ignorePatterns` through `extends`, so each workspace keeps its
own.

## The pins that move together

- `typescript` in the catalog and `oxlint-tsgolint` in the root `package.json`: the tsgolint
  version encodes the TypeScript release it was built for. Bump them in one change.
  `tsgolint-lockstep` fails when they disagree. Keep `oxlint-tsgolint` installed while lint uses
  `--type-aware`; without it oxlint skips those rules and still passes.
- The `@littleorgans/*` catalog entries and the tag in `.github/workflows/ci.yml` that calls
  `moon-ci.yml`. The Renovate group in `renovate/base.json` moves them together.
- Moon in `.prototools` and in the `.moon/workspace.yml` version constraint.

## Gates that hold this

- `root:format-check`, `root:lint`, `root:secrets` and `root:audit` in `moon ci`. The pre-commit
  hook in `lefthook.yml` runs the first three on staged files, and commitlint checks the message
  is a Conventional Commit.
- `root:tsgolint-lockstep` and `root:project-refs`.
- `pnpm audit` ignores need a reason and an expiry that `scripts/check-security.mjs` validates.
- CI calls `.github/workflows/moon-ci.yml` at the release tag. Require the job named `CI` in branch
  protection, because a skipped required check counts as passing.

Nothing checks that a member picked the right layer, that a task declares all its inputs, or that
a gate change was proven. Those are yours.
