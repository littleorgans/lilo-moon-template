# lilo-moon-template

A language agnostic monorepo baseline. Moon owns the task graph for every language.
pnpm is the JavaScript package manager only.

Use this repository to start a new project. The working contract once you are inside it is
[AGENTS.md](AGENTS.md). How to copy it and rename it is
[Start a project from this template](docs/how-to-instantiate.md). Why the tools are these tools is
[Why this baseline is shaped this way](docs/decisions.md).

## What is here

Pinned on main:

- moon `2.5.1`, from `versionConstraint` in `.moon/workspace.yml` and `moon` in `.prototools`. CI
  runs `moonrepo/setup-toolchain` with `auto-install: true` and reads that pin
- Node `24.19.0` and pnpm `11.22.0`, from `.moon/toolchains.yml`
- TypeScript `~7.0.2` in the default `catalog` of `pnpm-workspace.yaml`
- oxlint `1.79.0`, oxfmt `0.64.0`, and `oxlint-tsgolint` `7.0.2001` in the root `package.json`
- lefthook `2.1.10` and commitlint, from the root `package.json` and `lefthook.yml`
- Changesets, from `changelog` in `.changeset/config.json`
- Vite, React, and Vitest pins in that same catalog
- Rust `1.95` with clippy, from `rust` in `.moon/toolchains.yml`
- Atlas `1.3.0`, from `atlas` in `.prototools`, with `tasks.atlas-*` in the root `moon.yml`
- Drizzle ORM `0.45.2` and Kit `0.31.10`, from the catalog in `pnpm-workspace.yaml`, with
  `tasks.drizzle-generate` and `tasks.drizzle-check` in the root `moon.yml`

Workspace members:

- `packages/collections`, a publishable TypeScript library
- `apps/web`, a Vite React application that consumes it
- `services/ping`, a Rust library

`just new-package` and `just new-app` generate further members of the first two shapes. Other
languages and other application stacks are added by hand. Follow
[Add a workspace member](AGENTS.md#add-a-workspace-member) in AGENTS.md.

Quality gates live in `moon.yml` at the root and in `.moon/tasks/`. Root tasks include lint, format,
`project-refs`, `secrets`, `audit`, Atlas migrations, and the generated Drizzle schema check. How to
run them is
[Run the gates](AGENTS.md#run-the-gates) in AGENTS.md.

GitHub Actions CI is `.github/workflows/ci.yml`. The job runner is the repository variable
`CI_RUNNER`, which defaults to `ubuntu-latest` when unset.

Vitest coverage thresholds in `vitest.config.ts` are statements 80, branches 75, functions 80, and
lines 80, applied per project and per file. They are a floor for untested code. A test is still
unproven until a wrong implementation fails it. That rule is [Write tests](AGENTS.md#write-tests)
in AGENTS.md.

## Clone to green

Install just, moon `2.5.1`, and proto first. Commands are in
[Start a project from this template](docs/how-to-instantiate.md). Moon `2.5.1` must be on `PATH`.
The workspace `versionConstraint` rejects every other release.

```bash
git clone https://github.com/littleorgans/lilo-moon-template.git
cd lilo-moon-template
just setup
pnpm install
just ci
```

`just setup` is `moon setup`. It installs the Node and pnpm versions from `.moon/toolchains.yml`.
It does not install just, moon, or proto. The last command is the delivery proof in
[Run the gates](AGENTS.md#run-the-gates).

A green run on a clone of main means the committed tree already satisfies the gates. A gate you
have not seen fail is still unproven. That rule, and how to prove it, is in AGENTS.md under
[Prove every gate](AGENTS.md#prove-every-gate).

## Add a JavaScript member

```bash
just new-package billing
just new-app console
```

Add `"@your-scope/billing": "workspace:*"` to `apps/console/package.json` `dependencies`, using your
scope and names. `moon sync` does not write that entry from an import. Then:

```bash
pnpm install
moon sync
```

`new-package` runs `moon generate library`. `new-app` runs `moon generate application`. Both write a
member that already typechecks, tests, lints, formats, and builds. `moon sync` adds new
`references` in the root `tsconfig.json`. After you delete a member, prune the missing path. That
command does not drop a path whose project is gone. `moon.yml` `tasks.project-refs` then fails
`just ci` with TS6053. The instantiation guide covers the prune.

Inspect the result with `moon project billing` and `moon project console`. Then prove the gates can
fail, as AGENTS.md requires, before trusting `just ci`.

A Rust-only tree still `pnpm install`s the root oxlint, oxfmt, secretlint, and audit gates. Those
tools live in `devDependencies` in the root `package.json`.

`moon.yml` `tasks.atlas-diff` and `tasks.atlas-lint` need Docker only when `db/schema.sql` exists.
Without Docker, `just check` skips Atlas lint and the Drizzle schema check locally with clear
messages. CI still runs both when a schema exists.

## Not in this repository yet

Filed, unbuilt. Do not treat any of these as present:

- WorkOS AuthKit in the application exemplar: #16
- The auth adapter seam: #23

The Supabase host boundary is recorded in
[Supabase as a Postgres host](docs/supabase-boundary.md).

App stack, license, package scope, and registry are choices for the consuming repo. The decision
record lists what is already settled so those choices stay in the consuming repo and out of this
one.
