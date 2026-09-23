---
name: start-project
description: Start a new project on the published @littleorgans packages, with a TanStack Start web app, a TypeScript service, or both. Use when creating a project from the littleorgans reference, adding the first web app or service to one, or getting a new project to its first green moon ci.
---

# Start a project

Take a new project from an empty directory to its first green `moon ci`, on the published
`@littleorgans/*` packages. The steps are in two guides in `littleorgans/lilo-moon-template`,
and every path below is in that repository. Read the guides at the release tag that matches the
version you will install, not on `main`:

- `docs/guides/adopt-web-app.md`: tools, the workspace root, the web app, ports, environment,
  database, the first green `moon ci`, and operating notes.
- `docs/guides/adopt-service.md`: a service, standalone or beside a web app.

Follow the guides in order and run their commands as written. This skill does not repeat their
steps. It covers the decisions the guides leave to you, and what to check along the way.

## Settle these with the person first

Ask when the answer is not already given. Each one changes files the guides write.

- **Web app, service, or both.** A web app signs people in and renders pages. A service answers
  bearer-token requests from a web app and never sees a cookie. When both are wanted, put them in
  one workspace: set up the web app first, then add the service beside it. A standalone service
  suits a team whose web app is elsewhere, and it uses the same WorkOS client.
- **Organization policy.** `personal` creates an organization for every new user at first
  sign-in. That suits a product where each person works alone until they invite others.
  `existing` leaves membership to an invitation or admin flow the project already has. A signed-in
  user with no organization then sees no tenant rows, and a service refuses them with 403. The
  setting is `organizationPolicy` in `apps/<name>/src/server/auth.ts`.
- **Ports.** Take the ports from the person, or choose ones nothing else on their machine uses.
  One callback URL covers development and preview, so keep those two ports equal. Every web app in
  the workspace needs its own port, and every service its own `PORT`. Each callback URL must be
  registered with WorkOS, and only the person can do that. Say so, and do not claim that sign-in
  works until they have registered it.
- **Whether a database is needed.** A web app without a database still signs people in. A service
  always needs one, because `loadServiceConfig` requires `DATABASE_URL`. With a database, every
  deployed process connects as its own login role holding the shipped grant. It never connects as
  the migration owner or a superuser.
- **Names.** The directory under `apps/` or `services/` is the Moon project id, so it appears in
  every task (`web:build`, `api:test`). Pick it once, and rename every command the guides show.

## Read the glue, not only the guide

The copied `src/server/` directory is the composition root, and it is where the project's own
choices live. Read the reference before changing it:

- `apps/web/src/server/auth.ts`: `createAuthRuntime` with `organizationPolicy`, `throttle` and
  `serviceOrigins`.
- `apps/web/src/server/throttle.ts`: the in-memory email throttle. It is right for one instance
  only. Tell the person before they deploy a second one.
- `apps/web/src/server/database.ts`, `theme.ts`: the lazy pool, and an Origin-checked POST
  route to copy for their own.
- `services/api/src/server/`: `config.ts` (`loadServiceConfig`), `auth.ts` (bearer auth that
  refuses a token without an organization), `database.ts`, and the error mapping, logging and
  shutdown next to them.

Change application choices in those files. Anything that looks like package behavior, such as
token checks, the Origin comparison or the SQL the grant runs, belongs to the packages. Report it
to the person, and do not patch a copy.

## Check as you go

- `pnpm peers check` prints `No peer dependency issues found` after the installs.
- `moon run <app>:typecheck <app>:build <app>:test` passes before the first `moon ci`.
- `moon ci` passes with nothing skipped that CI would run. Without Docker, `atlas-lint`,
  `drizzle-check`, `rls-verify` and the service's database test skip locally, and CI runs them.
  Say which ones skipped.
- With a real database, `pnpm exec rls-verify` passes when connected as the login role.

Report what you could not verify. The usual gaps are the WorkOS callback registration, a real
sign-in, and a deployed database.
