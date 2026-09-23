# lilo-moon-template

A language agnostic monorepo baseline. Moon owns the task graph for every language.
pnpm manages JavaScript packages.

Start with [the instantiation guide](docs/how-to-instantiate.md). Follow [AGENTS.md](AGENTS.md)
while working in the repository. [The decision record](docs/decisions.md) explains the tool choices.

[The system overview](docs/system-overview.md) maps packages, seams, project creation, runtime and
CI. [The domain model](docs/domain-model.md) defines the terms. [The assessment](docs/assessment.md)
reviews strengths, risks and a roadmap as of 2026-09-23.

## Implemented capabilities

| Area        | Implementation                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Workspace   | Moon tasks and project creation, pinned toolchains, pnpm catalogs, a Rust example                         |
| Identity    | WorkOS Google OAuth and email codes, encrypted cookies, token verification, TanStack Start adapter        |
| Persistence | Postgres, Drizzle queries, Atlas SQL migrations, transaction scoped identity and real RLS verification    |
| UI          | React, Tailwind 4, shadcn/Radix components, layout and typography components                              |
| Themes      | Typed tokens, generated CSS, runtime validation, light and dark modes, preference cookies and a theme lab |
| Delivery    | CI, formatting, type aware lint, coverage, dependency audit, secret scanning and Changesets               |

Payments, CRM, Zustand persistence, Convex, system theme mode and saved user theme editing are
not implemented. Billing design notes describe proposed workflows, not working payment integration.

## Package ownership

- `auth` verifies tokens and maps claims to a `Principal`.
- `auth-workos` wraps the WorkOS SDK. `auth-session` handles WorkOS browser sessions.
- `auth-tanstack` binds sessions to TanStack Start requests.
- `db` runs Postgres transactions under a principal. Applications own tables and provisioning.
- `theme` owns token contracts, validation and CSS generation. Consumers can supply theme preferences.
- `ui` owns shared components. `views` composes them into reference screens.
- `vite-config` discovers packages from an explicitly supplied consumer workspace root.
- `collections` and `services/ping` demonstrate TypeScript and Rust members.

Application code lives under `apps/<name>/src`: grouped routes wire URLs, named server modules
compose services, and `features/<name>/` owns each feature's model, UI and server behavior. The
workspace example demonstrates that ownership without putting product diagnostics in shared packages.
See [Code layout](docs/code-layout.md) for the structure to follow when adding features and members.

## Start locally

Install just, proto and the Moon version in `.prototools`, then run:

```bash
just setup
pnpm install
just check
just ci
```

For signing in, copy `.env.example` to `.env.local` and configure the WorkOS values. The redirect URI
must match the running app. `DATABASE_URL` is optional. An app without it can still sign in.

```bash
moon run web:dev
```

The reference app runs on port 5199. `/theme` displays the component and theme examples.
The signed-in page contains diagnostic examples that a product should replace.

## Create a new repository

```bash
just new-project atlas --dest ../projects --org your-org
just projects
```

The creator preserves Git history, sets the new project's `origin` and this template as `upstream`,
then commits naming and setup changes on top of the selected template revision. This template keeps
one tracked consumer record per project; local checkout paths remain ignored. Use the list to inspect
real projects for improvements worth bringing back into the baseline. See
[project creation and consumer tracking](docs/project-lineage.md).

## Develop your project

Adapt `apps/web` directly. Downstream projects may replace or delete the examples. For additional
members, follow [Add a workspace member](AGENTS.md#add-a-workspace-member).

Each application selects `organizationPolicy` in `src/server/auth.ts`: `personal` provisions a
personal workspace, while `existing` leaves organization membership unchanged.

Each application imports the UI stylesheet and the views source registration in `src/styles.css`,
and registers its own source directory. Published packages do not scan neighboring repositories.

## Verification

`just check` repairs formatting and lint issues, then verifies the graph. `just ci` is read only.
CI runs the coverage task once per JavaScript project; `test` remains available for focused local runs.
Docker enables the real Postgres checks. CI requires those checks when a schema exists.

The template producer also runs `root:consumer-check`. It creates a repository using the real script,
builds its application and verifies HTTP and CSS behavior. It repeats the check with packed libraries
installed outside their source workspace. Git integration tests exercise fetching and rebasing a
later template update while preserving product changes. Fixtures use disposable repositories.

Postgres containers and their default ports are derived from the checkout path. `just clean`
removes only that checkout's container and Moon cache. Change `LILO_PG_PORT` if a port is occupied.

## Distribution

This repository supports both copied workspace libraries and packed package consumption. Copying
and renaming libraries creates independent implementations. Published package consumers can instead
receive fixes through dependency upgrades. Registry publishing is separately enabled in the release
workflow and is not required to start a project.
