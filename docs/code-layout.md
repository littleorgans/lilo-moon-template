# Code layout

Use the working examples to decide where a change belongs. Group files by the behavior they own;
add directories when there are related files to put in them.

## Application structure

```text
apps/web/src/
├── routes/
│   ├── __root.tsx
│   ├── index.tsx
│   ├── app.tsx
│   ├── theme.tsx
│   ├── (auth)/
│   │   ├── callback.ts
│   │   ├── session-error.tsx
│   │   └── verify-email.tsx
│   └── api/
│       ├── theme.ts
│       └── auth/
│           ├── start.ts
│           ├── signout.ts
│           └── email/
│               ├── start.ts
│               └── verify.ts
├── features/
│   ├── auth/search.ts
│   └── workspace/
│       ├── model.ts
│       ├── workspace-page.tsx
│       └── server/
│           ├── load-workspace.ts
│           └── rows.ts
├── server/
│   ├── auth.ts
│   ├── database.ts
│   └── theme.ts
├── router.tsx
└── styles.css
```

`routes/` owns URL matching, search validation, loaders, handlers and layout composition. The
`(auth)` directory groups files without changing `/callback`, `/session-error` or `/verify-email`.
An ordinary directory contributes a path segment, so `api/auth/email/start.ts` serves
`/api/auth/email/start`. Route groups do not authenticate callers or install a layout.

Keep standalone pages as files. When a product adds several project or billing routes, group them
under their corresponding directory. Dotted filenames remain available when an extra directory
would make navigation harder. Regenerate `routeTree.gen.ts` through the app build after moving routes.

`features/workspace/` demonstrates a complete feature. Its model describes the page data, its server
modules provision and query the application's tables, and its page receives the result as props.
The route invokes the feature loader through an explicit Start server function and passes loader
data to the page. The page can be tested without importing the route or constructing a router.

`server/` contains application-wide adapters and service construction. Name each module for its
service or behavior. Put a feature's query alongside that feature. The database package owns pooling
and scoped transactions; the workspace feature owns the accounts/profiles queries it executes.

## Shared packages

Keep a component in its feature until a reusable contract is clear. Shared components can receive
application paths, labels and data as parameters. They should not import application source or own
application tables just to make the example run.

- `ui/src/components/` contains small reusable primitives. Its current size needs no extra folders.
- `views/src/<view>/` groups composed reusable screens and exposes them through subpath exports.
- Auth packages separate verification, provider API calls, session handling and framework adaptation.
- `theme/` owns token validation, concrete themes and its generated stylesheet.

Package exports name implemented files. Add a hook or an adapter when behavior needs it; avoid
placeholder exports and empty extension directories.

## Tests and task ownership

Focused tests live under `tests/` and mirror feature groups. In the web app, workspace tests live
under `tests/features/workspace/`; router and auth composition tests live under `tests/integration/`.
Tests that start a build, process, database or network listener belong in `tests/integration/`.
Rust retains its native integration test directory convention.

Moon discovers workspace members across languages. Generic JavaScript checks apply to JavaScript
members. Vite/Nitro commands apply only to applications tagged `web-app`; other runtimes declare
appropriate commands. Library examples carry `ts-library` so root lint builds their declarations.
The application owns its ports. Shared coverage settings do not exempt a named application's route.
Command tasks run without a shell so paths containing route groups, spaces and `$` parameters reach
the tool unchanged. Explicit `script` tasks own any required shell syntax.

For a new member, follow [Add a workspace member](../AGENTS.md#add-a-workspace-member). Verify the
resolved Moon project and tasks, then prove the relevant checks reject a deliberate failure.

## Applying the pattern in a project

A project owns the application glue it takes from the reference app. Replace the workspace
diagnostics as needed, and retain useful ownership boundaries as the product grows. Behavior with a
reusable contract belongs in a published package, where an upgrade delivers it, rather than in each
project's copy.
