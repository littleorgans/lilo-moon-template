# lilo-moon-template

A reference implementation of a TypeScript web application, and the source of the `@littleorgans/*`
npm packages it is built from. Once published, projects add the packages as dependencies and
follow the reference app for the thin glue they own. They do not copy, rename or rebase this
repository.

Moon owns the task graph. pnpm manages JavaScript packages. Follow [AGENTS.md](AGENTS.md) while
working in the repository. [The decision record](docs/decisions.md) explains the tool choices.

[The direction](docs/direction.md) sets out the plan: the reference implementation, the published
packages, and skills that teach how frontends and services are built here. [The system
overview](docs/system-overview.md) maps packages, seams, runtime and CI. [The domain
model](docs/domain-model.md) defines the terms. [The assessment](docs/assessment.md) is a review as
of 2026-09-23, from before the template machinery was removed.

## Status

Nothing is published yet. Every package is at `0.0.0`, and the release workflow publishes only after
the repository variable `NPM_PUBLISH_ENABLED` is set to `true`. The first release, `0.1.0`, follows
the phase 1 work in [the direction](docs/direction.md#f-phased-plan).

## Packages

Every package below is publishable, and none is published yet. They release together at one
version (the Changesets `fixed` group), because their internal dependencies are exact pins.

- `auth` verifies tokens and maps claims to a `Principal`.
- `auth-workos` wraps the WorkOS SDK. `auth-session` handles WorkOS browser sessions and calls
  services as the signed-in person without handing out their token.
- `auth-tanstack` binds sessions to TanStack Start requests.
- `auth-http` authenticates bearer tokens for services on Fetch `Request` and `Response`, with a
  Hono adapter and a service config loader.
- `db` runs Postgres transactions under a principal. Applications own tables and provisioning.
- `theme` owns token contracts, validation and CSS generation. Consumers can supply theme preferences.
- `ui` owns shared components. `views` composes them into reference screens.
- `vite-config` discovers packages from an explicitly supplied consumer workspace root.

## Implemented capabilities

| Area        | Implementation                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Workspace   | Moon tasks, pinned toolchains, pnpm catalogs                                                              |
| Identity    | WorkOS Google OAuth and email codes, encrypted cookies, token verification, TanStack Start adapter        |
| Services    | Bearer authentication on Fetch `Request` and `Response`, with a Hono adapter                              |
| Persistence | Postgres, Drizzle queries, Atlas SQL migrations, transaction scoped identity and real RLS verification    |
| UI          | React, Tailwind 4, shadcn/Radix components, layout and typography components                              |
| Themes      | Typed tokens, generated CSS, runtime validation, light and dark modes, preference cookies and a theme lab |
| Delivery    | CI, formatting, type aware lint, coverage, dependency audit, secret scanning and Changesets               |

Payments, CRM, Zustand persistence, Convex, system theme mode and saved user theme editing are
not implemented.

## The reference app

`apps/web` is private and never published. It consumes the packages from workspace source and
shows the glue a project owns: grouped routes wire URLs, named server modules compose services, and
`features/<name>/` owns each feature's model, UI and server behavior. See [Code
layout](docs/code-layout.md) for the structure to follow when adding features and members.

The signed-in page shows the session's user and organization, and the rows a scoped transaction can
see. `/theme` is a reference page for the components and themes.

Each application selects `organizationPolicy` in `src/server/auth.ts`: `personal` provisions a
personal workspace, while `existing` leaves organization membership unchanged. Each application
imports the UI stylesheet and the views source registration in `src/styles.css`, and registers its
own source directory. Published packages do not scan neighboring repositories.

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

The reference app runs on port 5199. [Set up and operate this repository](docs/how-to-instantiate.md)
covers toolchains, ports, the database and publishing until the adoption guides replace it.

## Verification

`just check` repairs formatting and lint issues, then verifies the graph. `just ci` is read only.
CI runs the coverage task once per JavaScript project; `test` remains available for focused local runs.
Docker enables the real Postgres checks. CI requires those checks when a schema exists.

`root:published-shape` copies this workspace into a disposable repository, builds the reference app,
proves its typecheck, test, lint and format gates reject deliberate violations, and verifies HTTP
and CSS behavior. It packs every library and runs `publint` and `attw` on each tarball, then
repeats the app check with the tarballs installed outside their source workspace, including on
`db`'s lowest peer versions. A separate npm consumer pins direct third-party dependencies to the
versions the workspace lockfile resolves. It imports every exported entry point and typechecks it
with TypeScript 5 and `skipLibCheck: false`. The same consumer runs a service against the packed
`auth-http` and `db`, applying the shipped migrations and login grant to a real Postgres. A
drizzle-orm release below `db`'s peer range must fail the install. CI runs it only when code,
manifests, the lockfile or Moon configuration change.

Postgres containers and their default ports are derived from the checkout path. `just clean`
removes only that checkout's container and Moon cache. Change `LILO_PG_PORT` if a port is occupied.
