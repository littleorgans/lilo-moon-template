# lilo-moon-template

A language agnostic monorepo baseline. Moon owns the task graph for every language.
pnpm manages JavaScript packages.

Start with [the instantiation guide](docs/how-to-instantiate.md). Follow [AGENTS.md](AGENTS.md)
while working in the repository. [The decision record](docs/decisions.md) explains the tool choices.

## Implemented capabilities

| Area        | Implementation                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Workspace   | Moon tasks and generators, pinned toolchains, pnpm catalogs, a Rust example                               |
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

Application code lives under `apps/<name>/src`: routes wire URLs, server modules compose services,
shell components span features, and `features/<name>/` owns each product feature. Product components
may use styles and shared tokens without moving into a shared package.

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
just project-impact
```

The creator records the exact template revision and inherited file signatures in the descendant.
This template keeps one tracked record per project; local checkout paths remain ignored. See
[project creation and impact reporting](docs/project-lineage.md) for options, registration and the
limits of dependency analysis.

## Generate members

```bash
just new-package billing
just new-app console 5200
pnpm install
moon sync
```

Each application selects `organizationPolicy` in `src/server/auth.ts`: `personal` provisions a
personal workspace, while `existing` leaves organization membership unchanged.

Each application imports the UI stylesheet and the views source registration in `src/styles.css`,
and registers its own source directory. Published packages do not scan neighboring repositories.

## Verification

`just check` repairs formatting and lint issues, then verifies the graph. `just ci` is read only.
CI runs the coverage task once per JavaScript project; `test` remains available for focused local runs.
Docker enables the real Postgres checks. CI requires those checks when a schema exists.

The template producer also runs `root:consumer-check`. It generates and renames an application,
removes the examples, builds it and verifies its HTTP and CSS behavior. It repeats the check with
packed libraries installed outside their source workspace. It neither publishes packages nor
contacts an identity provider.

`just rename` removes `.moon/template-reference.json`. Consumer repositories retain the member
generators but do not compare their product code against `apps/web`. When developing this template,
run `moon run root:template-update` after changing a raw reference file, then verify `root:template-check`.

Postgres containers and their default ports are derived from the checkout path. `just clean`
removes only that checkout's container and Moon cache. Change `LILO_PG_PORT` if a port is occupied.

## Distribution

This repository supports both copied workspace libraries and packed package consumption. Copying
and renaming libraries creates independent implementations. Published package consumers can instead
receive fixes through dependency upgrades. Registry publishing is separately enabled in the release
workflow and is not required to start a project.
