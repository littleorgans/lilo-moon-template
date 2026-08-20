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

Quality gates live in `moon.yml` at the root and in `.moon/tasks/`. Local repair then verify is
`just check`. The read only proof, and the command CI runs, is `just ci`.

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
`just ci` is `moon ci`, the same command as `jobs.ci` in `.github/workflows/ci.yml`.

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
`references` in the root `tsconfig.json`. After you delete a member, prune the missing path. The
instantiation guide covers that step.

Inspect the result with `moon project billing` and `moon project console`. Then prove the gates can
fail, as AGENTS.md requires, before trusting `just ci`.

## Not in this repository yet

Filed, unbuilt. Do not treat any of these as present:

- Vitest coverage thresholds: #5
- Changesets and a generated changelog: #6
- lefthook and commitlint: #7
- Supply chain and secret hygiene gates: #11
- WorkOS AuthKit in the application exemplar: #16
- Atlas, Drizzle as a generated artifact, the auth adapter seam, and the Supabase host boundary:
  #21, #22, #23, #24
- Renovate coverage for `.prototools`: #29

App stack, license, package scope, and registry are choices for the consuming repo. The decision
record lists what is already settled so those choices stay in the consuming repo and out of this
one.
