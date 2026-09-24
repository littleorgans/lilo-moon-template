---
name: start-project
description: Start a new project on the published @littleorgans packages, with a TanStack Start web app, a TypeScript service, or both. Use when creating a project from the littleorgans reference, adding the first web app or service to one, or getting a new project to its first green moon ci.
---

# Start a project

Take a new project from an empty directory to its first green `moon ci`, on the published
`@littleorgans/*` packages. `@littleorgans/create-app` writes the project; you settle the choices
it takes as flags, run it, and see the steps it prints through. Every path below is in
`littleorgans/lilo-moon-template`. Read its guides at the release tag that matches the version you
will install, not on `main`:

- `docs/guides/adopt-web-app.md`: the choices, the command, ports and callback, environment,
  database, the first green `moon ci`, and operating notes.
- `docs/guides/adopt-service.md`: a service, standalone or beside a web app.

This skill does not repeat their steps. It covers the decisions the command leaves to you, and
what to check along the way.

## Settle these with the person first

Ask when the answer is not already given. Each one is a flag, and the command refuses to guess the
ones without a default.

- **Web app, service, or both** (`--web`, `--service`). A web app signs people in and renders
  pages. A service answers bearer-token requests from a web app and never sees a cookie. When both
  are wanted, create them together in one workspace. A standalone service suits a team whose web
  app is elsewhere, and it uses the same WorkOS client.
- **Organization policy** (`--organization-policy personal|existing`, required with `--web`).
  `personal` creates an organization for every new user at first sign-in. That suits a product
  where each person works alone until they invite others. `existing` leaves membership to an
  invitation or admin flow the project already has. A signed-in user with no organization then
  sees no tenant rows, and a service refuses them with 403.
- **Ports** (`--web-port`, `--service-port`). Take them from the person, or choose ones nothing
  else on their machine uses. The defaults are the reference's, `5199` and `8787`, and the command
  says when it took one. One callback URL covers development and preview. Each callback URL must be
  registered with WorkOS, and only the person can do that. Say so, and do not claim that sign-in
  works until they have registered it.
- **Whether a database is needed** (`--db`). A web app without a database still signs people in.
  A service always has one, because `loadServiceConfig` requires `DATABASE_URL`, so `--service`
  implies it. With a database, every deployed process connects as its own login role holding the
  shipped grant. It never connects as the migration owner or a superuser.
- **Names** (`--name`, `--web-name`, `--service-name`). `--name` is the root package and the scope
  of the project's own packages; it defaults to the directory's name. The directory under `apps/`
  or `services/` is the Moon project id, so it appears in every task (`web:build`, `api:test`).

## Run it

Run it without a terminal, every choice as a flag, for example:

```sh
pnpm create @littleorgans/app acme --web --organization-policy personal --web-port 5199 --db
```

It fails with exit 2 and names every missing or invalid flag, and exit 1 when the directory is not
empty; it never overwrites a file. On success it prints the defaults it took and the remaining
steps. Relay both to the person, then do the steps you can: the commit, `pnpm install`, the
lockfile commit and `moon ci --force`. If `pnpm install` stops with
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`, a dependency has no matching version old enough to install.
Do not add a `minimumReleaseAgeExclude` entry yourself: tell the person, who decides whether to
wait or exempt those exact versions.

To add a service to a workspace that already has a web app, create a scratch project with the same
`--name` and `--service`, then move its `services/<name>/` across, as the service guide describes.

## Read the glue, not only the guide

The generated `src/server/` directory is the composition root, and it is where the project's own
choices live. Read it before changing it:

- `apps/<name>/src/server/auth.ts`: `createAuthRuntime` with `organizationPolicy`, `throttle`
  and `serviceOrigins`.
- `apps/<name>/src/server/throttle.ts`: the in-memory email throttle. It is right for one
  instance only. Tell the person before they deploy a second one.
- `apps/<name>/src/server/database.ts`, `theme.ts`: the lazy pool, and an Origin-checked POST
  route to copy for their own.
- `apps/<name>/src/server/product.ts`: the product's name and sign-in copy, which the person
  replaces.
- `services/<name>/src/server/`: `config.ts` (`loadServiceConfig`), `auth.ts` (bearer auth that
  refuses a token without an organization), `database.ts`, and the error mapping, logging and
  shutdown next to them.

Change application choices in those files. Anything that looks like package behavior, such as
token checks, the Origin comparison or the SQL the grant runs, belongs to the packages. Report it
to the person, and do not patch a copy. A generated file that looks wrong for every project is a
fault in the reference or in create-app: report that too.

## Check as you go

- `pnpm peers check` prints `No peer dependency issues found` after the install.
- `moon ci --force` passes with nothing changed first. Without Docker, `atlas-lint`,
  `drizzle-check`, `rls-verify` and the service's database test skip locally, and CI runs them.
  Say which ones skipped.
- With a real database, `pnpm exec rls-verify` passes when connected as the login role.

Report what you could not verify. The usual gaps are the WorkOS callback registration, a real
sign-in, and a deployed database.
