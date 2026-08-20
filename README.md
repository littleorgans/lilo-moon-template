# lilo-moon-template

A language agnostic monorepo baseline. Moon owns the task graph for every language.
pnpm is the JavaScript package manager only.

Use this repository to start a new project. The working contract once you are inside it is
[AGENTS.md](AGENTS.md). How to copy it and rename it is
[Start a project from this template](docs/how-to-instantiate.md). Why the tools are these tools is
[Why this baseline is shaped this way](docs/decisions.md).

## What is here

Pinned on main:

- moon `2.5.1`, from `versionConstraint` in `.moon/workspace.yml`, `moon` in `.prototools`, and
  `moon-version` in `.github/workflows/ci.yml`
- Node `24.19.0` and pnpm `11.22.0`, from `.moon/toolchains.yml`
- TypeScript `~7.0.2` in the default `catalog` of `pnpm-workspace.yaml`
- oxlint `1.79.0`, oxfmt `0.64.0`, and `oxlint-tsgolint` `7.0.2001` in the root `package.json`
- Vite, React, and Vitest pins in that same catalog

Workspace members:

- `packages/collections`, a publishable TypeScript library
- `apps/web`, a Vite React application that consumes it

`just new-package` and `just new-app` generate further members of those two shapes. Other languages
and other application stacks are added by hand. Follow [Add a workspace member](AGENTS.md#add-a-workspace-member)
in AGENTS.md.

Quality gates live in `moon.yml` at the root and in `.moon/tasks/`. How to run them is
[Run the gates](AGENTS.md#run-the-gates) in AGENTS.md.

Vitest coverage thresholds in `vitest.config.ts` are statements 80, branches 75, functions 80, and
lines 80, applied per project and per file. They are a floor for untested code. A test is still
unproven until a wrong implementation fails it. That rule is [Write tests](AGENTS.md#write-tests)
in AGENTS.md.

## Clone to green

Moon `2.5.1` must be on `PATH`. The workspace `versionConstraint` rejects every other release.

```bash
git clone https://github.com/littleorgans/lilo-moon-template.git
cd lilo-moon-template
just setup
pnpm install
just ci
```

`just setup` is `moon setup`. It installs the Node and pnpm versions from `.moon/toolchains.yml`.
The last command is the delivery proof in [Run the gates](AGENTS.md#run-the-gates).

A green run on a clone of main means the committed tree already satisfies the gates. A gate you
have not seen fail is still unproven. That rule, and how to prove it, is in AGENTS.md under
[Prove every gate](AGENTS.md#prove-every-gate).

## Add a JavaScript member

```bash
just new-package billing
just new-app console
pnpm install
moon sync
```

`new-package` runs `moon generate library`. `new-app` runs `moon generate application`. Both write a
member that already typechecks, tests, lints, formats, and builds. `moon sync` adds new
`references` in the root `tsconfig.json`. After you delete a member, prune the missing path. That
command does not drop a path whose project is gone. Root `tsc --build` then fails with TS6053
while `just ci` can still pass. That is #32. The instantiation guide covers the prune.

Inspect the result with `moon project billing` and `moon project console`. Then prove the gates can
fail, as AGENTS.md requires, before trusting `just ci`.

## Not in this repository yet

Filed, unbuilt. Do not treat any of these as present:

- Changesets and a generated changelog: #6
- lefthook and commitlint: #7
- Supply chain and secret hygiene gates: #11
- WorkOS AuthKit in the application exemplar: #16
- Atlas, Drizzle as a generated artifact, the auth adapter seam, and the Supabase host boundary:
  #21, #22, #23, #24
- Renovate coverage for `.prototools`: #29
- Root `tsconfig.json` `references` left behind after a member is deleted: #32

App stack, license, package scope, and registry are choices for the consuming repo. The decision
record lists what is already settled so those choices stay in the consuming repo and out of this
one.
