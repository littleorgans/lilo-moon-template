---
name: web-app
description: Structure a TanStack Start web app on the @littleorgans packages, deciding where routes, features, server modules and tests go and how a loader turns Access into a page or a redirect. Use when adding a page, route, feature, loader, server function or test to a web app built from the littleorgans reference, or when deciding whether code belongs in a route, a feature or src/server.
---

# Build a web app

Where a change goes in a TanStack Start app built from the littleorgans reference, and what holds
it there. `docs/code-layout.md` is the layout, with the tree: read it first. `apps/web/src/` is the
working example and `apps/web/tests/` shows how each layer is tested. Every path here is in
`littleorgans/lilo-moon-template`. Read them at the tag that matches the installed
`@littleorgans/*` version, not on `main`.

A new project starts with [start-project](../start-project/SKILL.md). Sign-in and the access states
are [auth](../auth/SKILL.md), queries are [persistence](../persistence/SKILL.md), and shared
components are [ui-and-themes](../ui-and-themes/SKILL.md).

## Decide where it goes

- **A route file is wiring.** The URL, search validation, a loader that calls a server function,
  handlers, and a component that hands loader data to a page. `apps/web/src/routes/app.tsx` is
  the whole shape. Logic that grows in a route belongs to a feature.
- **A feature owns its model, page and server behavior** under `features/<name>/`, as
  `apps/web/src/features/workspace/` does. Its page takes data as props and never imports a route.
  Create the directory when the feature exists, not for one that might.
- **`src/server/` is the composition root**, one module per service or behavior: `auth.ts`,
  `database.ts`, `identity.ts`. A feature's own query stays in the feature
  (`apps/web/src/features/workspace/server/rows.ts`). `server/` names ownership. It is not a
  compiler boundary: `apps/web/src/server/product.ts` is plain data the browser bundles too, so it
  never holds a secret or imports a service.
- **A route group adds no auth.** `(auth)/` only groups files without a URL segment. Every loader
  that needs a signed-in person reads the access state itself.
- **Promote to a package only for a reusable contract**, where callers supply paths, labels and
  policy. Until then the component stays in its feature.

## Loaders branch on Access

`auth.access()` returns one of five states and never throws for an auth outcome.
`apps/web/src/features/workspace/server/load-workspace.ts` is the mapping to copy:
`signed-in` builds the page, `anonymous` redirects to `/`, `ended` to `/` with `ended: true`,
`unavailable` to `/session-error` with `retry: true`, and `broken` to `/session-error` with no
retry and no sign-in button. [auth](../auth/SKILL.md) says why each lands where it does.

- Keep the `default` branch that assigns the state to `never`. Typecheck then fails in every
  `switch` when a package adds a state, not only in one whose return type happens to catch it.
- Take dependencies as a parameter with a live default (`liveDeps()` there), so a test passes an
  access state and a scoped runner with no Start context and no database.
- A write, such as provisioning identity rows, is called by name where a person lands. Never hide
  one in a read.
- A database outage is page data (`databaseError`), not an exception: the person is still signed
  in.

## Keep the server out of the browser

Services are called only behind a Start server function (`createServerFn`) or a server route
handler, which Start compiles out of the browser bundle. `workspaceSourceConfig` in
`packages/vite-config/src/index.ts` adds a build plugin that fails `web:build` when a browser chunk
ships a module Vite stubs out of browser builds, such as a Node built-in. When it names a module,
move the import behind a server function; do not silence the plugin. Server code that needs no such
module passes it, so the plugin is a backstop: the boundary is where you call services.

Every POST route you add yourself refuses other origins first, as
`apps/web/src/server/theme.ts` does with `refuseCrossOrigin`. The package's own sign-in routes
already do.

## Test through props and seams

- Pages render from props (`apps/web/tests/features/workspace/workspace-page.test.tsx`).
- Loaders run with their dependencies passed in
  (`apps/web/tests/features/workspace/load-workspace.test.ts`).
- Router and auth wiring go under `tests/integration/`. `apps/web/tests/integration/routes.test.tsx`
  pins the public URL list, so moving a route file into a group cannot change a URL unnoticed.

Coverage is a per-file floor, and it fails files nobody tested. It does not prove a test asserts
the behavior it names: break the behavior and watch the test fail, as
[monorepo-gates](../monorepo-gates/SKILL.md) describes.

## Gates that hold this

- A feature importing a route or the route tree fails `root:lint` (`no-restricted-imports` in
  `packages/oxlint-config/oxlintrc.json`).
- A Node built-in, or another module Vite stubs for the browser, in a browser chunk fails
  `web:build`.
- An untested file fails `web:test-coverage` (`testDefaults` in
  `packages/vite-config/src/vitest.ts`).
- An unhandled access state fails `web:typecheck`, if the `never` default is there.

Nothing checks that a route stays thin or that a query lives with its feature. That is this
skill's job, and review's.
