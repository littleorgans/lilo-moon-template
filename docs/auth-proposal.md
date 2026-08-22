# Proposal: auth and persistence in the baseline

**Status: working document for #16, #17 and #23. No code on main.** Sections marked **Settled** or
**Decided** are agreed and were proven by running something; the evidence is quoted inline. Anything
under "Open questions" is not. When the whole page settles, the rationale moves to
[decisions.md](decisions.md) and the work becomes issues.

Background that this page does not repeat: [Supabase as a Postgres host](supabase-boundary.md),
[Why this baseline is shaped this way](decisions.md).

## The shape

Three planes, one seam.

```
Browser  (our UI, our domain)
   |  password / magic auth / MFA  -->  WorkOS API      no redirect
   v
App server  (persistent Node process)
   |  verify(token) -> Principal                        the one seam
   |
   |  BEGIN
   |    SET LOCAL ROLE authenticated
   |    set_config('request.jwt.claims', claims, true)
   |    JIT upsert by workos_org_id / workos_user_id
   |    queries under RLS via app.current_user_id()
   |  COMMIT
   v
Supabase Postgres   managed Postgres only
```

**Identity is bought.** WorkOS owns who a user is, org membership, roles, permissions and
entitlements. We never copy those into our tables.

**Verification is ours and portable.** JWKS plus a stock JWT library. No vendor SDK on this path.
That is what lets a second language do the same thing, which is #17.

**Data is ours.** Postgres rows keyed by WorkOS identifiers, RLS driven by our own verification.

## Filesystem

```
apps/
  web/                    TanStack Start. Login UI, server routes, RLS-scoped queries.

packages/
  theme/                  Typed token contract, product themes, runtime applier and validator.
  ui/                     Shared React components. shadcn + Tailwind. No className escapes to apps.
  vite-config/            One Vite and Vitest factory. Owns the three workspace-package lists.
  auth/                   verify(token) -> Principal. JWKS + jose. Portable. No vendor SDK.
  auth-workos/            Login flows and WorkOS API calls. The quarantined provider module.
  db/                     Drizzle client and withPrincipal(). The only place GUCs are set.
  collections/            Existing library exemplar. Unchanged.

services/
  ping/                   Rust. Verifies the same token. Proof for #17, not a product.

db/
  schema.sql              Atlas desired state.
  migrations/             Atlas versioned migrations.
  drizzle/_generated/     Generated Drizzle types. See open question 1.
```

### The app server, proven

**TanStack Start fits this workspace.** Spiked and verified 2026-08-22: a server route returns a
server-computed value over a real request, `/` returns server-rendered HTML, `just ci` stays green at
21 tasks, and the `className` boundary gate still fires on the new `src/routes/` layout.

Start needed the `semver@6.3.1` trust exclusion, and nothing else. It fails without it, through
`@tanstack/start-plugin-core` -> `@babel/core@7.28.5`.

Four things the spike found that are not obvious:

- **`ssr.resolve.conditions` is required, separately from the client list.** Start and Nitro create
  an SSR environment whose conditions replace the top-level ones, so the `@lilo-moon/source`
  condition has to be set twice. Proven by moving `packages/collections/dist` out of the workspace
  entirely and confirming dev still served both routes.
- **`index.html` must be deleted.** Keeping it makes Nitro serve that static template for every
  path, including API routes, which fail silently by returning HTML.
- **`verbatimModuleSyntax: false`** is required in the app tsconfig to stop server bundle leakage.
  This is a deliberate deviation from `tsconfig.options.json`.
- **`apps/web/.output` needs excluding** from `.gitignore`, the oxlint and oxfmt ignore lists, and
  the root moon source globs. `web:build` declares it as an output; `web:preview` runs
  `node .output/server/index.mjs`.

Cost: the lock graph goes from 774 to roughly 1229 with the UI stack and Start together. That is
real audit surface for a repo that gates on `audit.level: high`.

### Where the backend lives

**In the apps, not in a service.** A TanStack Start app is a persistent Node process with server
routes, so each app has its own server half. Everything reusable lives in `packages/`, so a second
app gets the same auth by importing the same three packages.

A dedicated entry under `services/` is only justified when something must outlive a request: a
WebSocket server, a queue worker, a scheduled job. Nothing in the current scope qualifies.

### What each new package is

**`packages/ui`** Shared React components and layout primitives. Uses `catalog:react-peer`, the
permissive React peer range that `pnpm-workspace.yaml` already defines for exactly this case.
Whether the sign-in form lives here or in `packages/auth-workos` is open question 3.

**`packages/auth`** The seam #23 protects. Exports `verify(token): Principal` and the `Principal`
type: `userId`, `orgId`, `roles`, `permissions`, `entitlements`. JWKS plus `jose`. Knows nothing
about WorkOS beyond a configured issuer and JWKS URL. This is the package `services/ping` mirrors
in Rust.

**`packages/auth-workos`** Everything that does not abstract: sign-in, magic auth, MFA challenges,
token refresh, WorkOS API calls. Uses the WorkOS SDK freely, because this is the module you rewrite
when you swap vendors. Nothing outside this package imports `@workos-inc/*`.

**`packages/db`** The Drizzle client plus `withPrincipal(principal, fn)`, which opens the
transaction, sets the role and GUCs, performs the JIT upsert, and runs the caller's queries inside
it. The GUC sequence exists once, here. A copy of it anywhere else is a bug.

### RLS identity

`auth.uid()` is unusable. It casts the subject to `uuid`, and WorkOS subjects are text
(`user_01HBEQ...`). Verified in the Supabase migration that defines it.

Policies use our own helper instead:

```sql
create function app.current_user_id() returns text
  language sql stable
  as $$ select current_setting('request.jwt.claims', true)::jsonb ->> 'sub' $$;
```

Text typed, honest about the identifier, and it survives leaving Supabase. `auth.jwt()` still works
if we want it, but reaching for Supabase Auth helpers recouples us to the system we excluded.

### Connection rules

- One explicit transaction on one client. `BEGIN` through `COMMIT`, no autocommit statements.
  Transaction-local values are cleared at commit, which is also what stops identity leaking to the
  next borrower of a pooled connection.
- Prepared statements off on the pooler port (Drizzle `prepare: false`).
- The server login role needs the Postgres `SET` option for `authenticated`. Constrained role,
  never customer-chosen.

## Styling, components, and the UI boundary

**Settled: Tailwind 4 + shadcn/ui + `@mantine/hooks`.** Verified to install under the unchanged
supply-chain policy: `pnpm install` and `--frozen-lockfile` both exit 0, +146 packages over main's
774, and zero `@babel/core`, `semver@6`, or `chokidar` in the lock graph.

**Ark UI dropped.** shadcn components import Radix primitives, so taking both would mean two headless
libraries doing the same job with two behavioural models for a dialog. `@mantine/hooks` stays: hooks
only, no styling, no components, genuinely orthogonal.

### Why not the CSS-in-JS options

The supply-chain policy chose the styling library. `pnpm-workspace.yaml` sets
`trustPolicy: no-downgrade`, and three of four candidates failed it on two different chains.

| Candidate       | Result                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| StyleX          | `@stylexjs/unplugin` -> `@babel/core@7.29.7` -> `semver@6.3.1`. **Blocked.**       |
| vanilla-extract | `@vanilla-extract/integration` -> `@babel/core: ^7.23.9`. **Blocked**, same.       |
| Panda CSS       | `@pandacss/node` -> `chokidar@4.0.3`, provenance dropped after 4.0.1. **Blocked.** |
| Tailwind 4      | **Passes.**                                                                        |

All verified from the registry, 2026-08-22.

**The policy was later amended, and it changes this section's reasoning.** TanStack Start failed the
same `semver@6.3.1` chain (`@tanstack/start-plugin-core` -> `@babel/core@7.28.5`), making four
libraries blocked in one session and three on that single chain. `@babel/core@7.x` is a transitive
dependency of a large share of the React ecosystem, so `no-downgrade` as configured was rejecting
most of it. `semver@6.3.1` is a 2023 maintenance release of the 6.x line published before npm
provenance was widespread; the 7.x line has attestation, so pnpm reads it as a downgrade.

One pinned exclusion was added, `semver@6.3.1` exactly, with `trustPolicy: no-downgrade` left on.

**That reopens StyleX and vanilla-extract.** Neither was reinstated, because the Tailwind decision no
longer rests on them being blocked: shadcn/ui was chosen on its own merits and is Tailwind-only.
Adopting vanilla-extract now would mean hand-writing every primitive shadcn provides.

Panda remains blocked. Its failure was `chokidar@4.0.3`, an unrelated chain, and that exclusion was
not taken.

**What was given up:** a compile-time theme contract. vanilla-extract enforces it by default ("All
theme values must be provided or it's a type error"), Panda offers it via `defineThemeContract`.
Tailwind has no equivalent. Note that StyleX never had it either: `Theme<typeof vars>` rejects extra
keys and wrong value kinds, not missing ones, because partial themes are a documented feature.

Multi-theme support in Tailwind is CSS variables reassigned under a `data-theme` attribute on a
subtree. Product-type themes are owned by `packages/theme`, which recovers the lost contract by
generating the CSS from a typed token source. See that section.

### The UI boundary, enforced

**`className` and `style` do not appear anywhere in `apps/`.** Layout is components too: `Stack`,
`Row`, `Grid` and `Container` live in `packages/ui` alongside everything else. App code composes
components and nothing else.

The original framing was "everything that is not layout is a component". That cannot be enforced,
because "layout" is semantic and no lint rule can infer it. Banning the attributes outright needs no
semantics, and maps onto rules already present in the installed oxlint 1.79.0.

```jsonc
// .oxlintrc.json
"plugins": [..., "react"],
"overrides": [
  {
    "files": ["apps/**/*.tsx"],
    "rules": {
      "react/forbid-dom-props":       ["error", { "forbid": ["className", "style"] }],
      "react/forbid-component-props": ["error", { "forbid": ["className", "style"] }]
    }
  }
]
```

Both rules are needed. `forbid-dom-props` covers native elements; `forbid-component-props` stops
styling leaking through `<Stack className="mt-4">`. `style` is banned alongside `className` because
it is otherwise a wide-open hatch: the deleted WorkOS installer output used `style={{ marginBottom:
"2rem" }}` in the first file it generated.

**Proven, per "Prove every gate" in AGENTS.md.** Deliberate violations fail with file and line:

```
apps/web/src/app.tsx:13:11: error react(forbid-dom-props): Prop "className" is forbidden on DOM Nodes
apps/web/src/app.tsx:13:28: error react(forbid-dom-props): Prop "style" is forbidden on DOM Nodes
main.tsx:14:10: error react(forbid-component-props): Prop "className" is forbidden on Components
```

Removed, lint exits 0. A fixture using all three inside `packages/ui` lints clean, proving the
override does not leak outside `apps/`. `just ci` passes at 21 tasks.

**Side effect to accept deliberately:** enabling the `react` plugin activates the whole React rule
set under the existing `correctness`, `suspicious` and `perf` categories, not just these two.
`react/react-in-jsx-scope` fires a false positive against the automatic JSX transform and must be set
to `off`. Everything else passes today, but every consumer inherits the full React rule set.

### Escape hatch

A disable comment suppresses a real violation and lint exits 0:

```tsx
// oxlint-disable-next-line react/forbid-dom-props -- reason=temporary-layout expires=2026-09-01
```

oxlint does not validate the reason or expiry text, but `--report-unused-disable-directives` detects
stale directives and fails under `--deny-warnings`. A source gate can find and count these comments
and parse the fields, which is what `audit.ignore` already does for advisories.

**Decided: disable comments carrying a reason, policed by a gate**, so exceptions are trackable
rather than invisible. An expiry field is recommended alongside the reason. A reason gives
traceability; without an expiry the list only grows and nobody re-reads it. `audit.ignore` requires
both, and the secrets task rejects missing, invalid, duplicate, and expired entries.

Pair it with `--report-unused-disable-directives`, proven to fail under `--deny-warnings`. That
catches the opposite rot: a disable comment left behind after the violation it covered is gone.

### packages/theme

Tokens live in their own package, not in `packages/ui`. Two consumers force it.

**Canvas is a product that lets users edit a theme.** A user-edited theme is runtime data, so the
contract needs a runtime representation and validation, not only a TypeScript type. A theme editor
produces untrusted input and gets parsed at the boundary like anything else external.

**A user theme is a row.** It is scoped to a user or an org, which means the theme package touches
the persistence plane. Cheap to account for now, expensive once the schema exists.

The package owns four things:

- The token contract, as types.
- Built-in product themes: Editor, Canvas, and whatever follows.
- A runtime applier that sets CSS variables from a token object.
- A validator for user-supplied themes.

**Typed tokens generate the CSS.** Tailwind has no compile-time theme contract, which is what the
CSS-in-JS candidates offered and this stack gave up. Making a typed TS token object the single source
of truth and generating the `@theme` block from it recovers most of it: a product theme missing a
token fails typecheck, and CSS variables cannot drift from JS values because one produces the other.

This is codegen, which Panda was partly rejected for. The difference is that this generator is ours
and small, and it is the only route to a typed theme contract now that Tailwind is the engine.

**The pattern already exists here.** `scripts/drizzle-schema.mjs` has `generate` and `check` modes,
with `drizzle-check` failing CI when the committed artifact drifts from its source. Theme generation
is the same shape and should reuse it rather than invent a second convention.

### shadcn in this monorepo

Its CLI supports monorepos and Vite (`shadcn init -t vite --monorepo`, `shadcn add -c apps/web`).
Both `apps/web` and `packages/ui` carry a `components.json`; the app's Tailwind CSS entry points at
the package's `globals.css`, which carries `@source` coverage for both. Committed to `packages/ui`:
generated component source, `lib/utils.ts`, `globals.css`, `components.json`, and exports for
`./components/*`, `./lib/*`, `./hooks/*`, `./globals.css`. shadcn is a source distribution tool,
not a runtime dependency.

**Friction to watch:** registry _blocks_, as opposed to primitives, deliberately write app-specific
files such as `login-form.tsx` into the app rather than the package. That conflicts with the boundary
and needs either avoidance or mechanical detection.

## Config lives in a package

**Weakened when StyleX was ruled out, then restored by the TanStack Start spike.**

`apps/web/vite.config.ts` hand-maintains a list of workspace packages in `optimizeDeps.exclude`,
alongside the `@lilo-moon/source` resolve condition. That is two lists, per app, that must agree.
The original case for a package assumed StyleX would add `externalPackages` and Vitest would add
`server.deps.inline`, making four. Panda integrates through PostCSS and adds neither.

Panda would have added neither, taking it down to two. Start puts it back to three: the SSR
environment's `resolve.conditions` replace the client list rather than extending it, so every
workspace package must be named in `resolve.conditions`, `ssr.resolve.conditions`, and
`optimizeDeps.exclude`. Three hand-maintained lists per app, each failing quietly.

That is enough to justify the factory.

The repo's existing convention is root config files: `tsconfig.options.json` via `extends`, root
`vitest.config.ts`, root `.oxlintrc.json` and `.oxfmtrc.json`. Those stay. Only the executable config
has the duplication problem, so only it becomes a package.

Two things the spike must settle:

1. Vite loads `vite.config.ts` through its own esbuild pass, which may not honour the
   `@lilo-moon/source` condition. If it does not, `packages/vite-config` must be built before apps
   can consume it, which is a moon task-ordering edge and not just a `dependsOn` line.
2. Whether `apps/web` gains a plain graph edge or a build-order dependency follows from 1.

## Spike status

Throwaway worktree at `../.lilo-worktrees/stylex-spike`. Nothing on `main`.

**Done and proven:**

- Dependency resolution for Tailwind 4 + shadcn's Radix deps + `@mantine/hooks`. `pnpm install` and
  `--frozen-lockfile` both exit 0. 920 lock nodes against main's 774, so +146.
- The `className` / `style` ban in `apps/**`, failing on deliberate violations with file and line,
  passing when clean, and provably not reaching `packages/**`. `just ci` green at 21 tasks.

- TanStack Start in this moon workspace. Live server route, SSR, `just ci` green at 21 tasks, and
  the boundary gate still firing on `src/routes/`. Needed the one `semver@6.3.1` exclusion.

**Still to prove:**

1. `packages/ui` carrying real shadcn components, consumed by `apps/web`, with the app importing the
   package's `globals.css` and Tailwind's `@source` covering both.
2. `moon run web:test` with coverage thresholds against components living in a workspace package.
3. Layout primitives (`Stack`, `Row`, `Grid`, `Container`) sufficient that `apps/` needs no
   `className`. If they are not, the boundary is unusable and the policy needs revisiting.
4. `packages/vite-config` consumed by `apps/web`, resolving without a prior build, or the moon task
   edge documented if it cannot.
5. A second theme, to check that `data-theme` variable reassignment holds up across two product
   types before more than one exists.

## Dependencies to add

All new versions go in the `pnpm-workspace.yaml` catalog. Projects reference `catalog:` and never
pin. `minimumReleaseAge` is 1440, so a just-published version fails the install until it ages.

| Package                                              | Catalog         | Used by                     |
| ---------------------------------------------------- | --------------- | --------------------------- |
| `jose`                                               | yes             | `packages/auth`             |
| `@workos-inc/node`                                   | yes             | `packages/auth-workos` only |
| `@tanstack/react-start`                              | yes             | `apps/web`                  |
| `@tanstack/react-router`                             | yes             | `apps/web`                  |
| `drizzle-orm`                                        | already present | `packages/db`               |
| `pg`                                                 | already present | `packages/db`               |
| `tailwindcss` 4.3.3                                  | yes             | `packages/ui`, apps         |
| `@tailwindcss/vite` 4.3.3                            | yes             | `packages/vite-config`      |
| `@radix-ui/react-*`                                  | yes             | `packages/ui`, via shadcn   |
| `class-variance-authority`, `clsx`, `tailwind-merge` | yes             | `packages/ui`, via shadcn   |
| `lucide-react`                                       | yes             | `packages/ui`               |
| `@mantine/hooks`                                     | yes             | `packages/ui`, apps         |

Rust side for #17: a JWKS client and a JWT library, chosen when that issue is picked up.

## What this changes in existing records

- **#16** says "do not build an entitlements service, a database, or a sync webhook". Owning the
  customer record supersedes the database prohibition. The other two stand: no entitlements
  service, and JIT creation keeps us out of webhook sync.
- **#23** says to set GUCs "so `auth.uid()` and `auth.jwt()` fire". Right principle, wrong
  mechanism. `auth.uid()` cannot fire on a WorkOS subject.
- **#23** reads as if login flows are excluded from the template. They are excluded from the
  _abstraction_, and shipped concretely by #16. Worth rewording.

## Vendor constraints, dated

These are workarounds, not principles. If they lapse, the design simplifies.

- **supabase/auth#2476**, open since 2026-04-08, verified still open 2026-08-22. WorkOS JWTs fail
  Supabase's third-party verification. Blocks PostgREST and, by the shared key-provisioning path,
  Realtime. Supabase's own WorkOS guide still claims both work.
- **WorkOS custom domain is $99/mo.** Not needed while we own the UI. The residual case is the
  email sender domain on magic-auth and verification mail.
- **Social login and enterprise SSO redirect** through `api.workos.com` by construction. Own-UI
  covers password, magic auth and MFA only.

## Open questions

1. **Does `db/drizzle/_generated/` move into `packages/db/src/_generated/`?** Argument for: it is
   TypeScript, and its only consumer would be that package. Argument against: it moved to `db/` in
   #53 and this is churn. Splitting `db/` as language-neutral SQL and `packages/db` as the
   TypeScript access layer is coherent either way.
2. **One auth package or two?** `packages/auth` plus `packages/auth-workos` makes the boundary
   enforceable and visible in the dependency graph. One package with two entry points is lighter.
   The boundary is the point of #23, which argues for two.
3. **Who owns the sign-in form, `packages/ui` or `packages/auth-workos`?** UI keeps components
   together; auth-workos keeps everything vendor-shaped in one place.
4. **Does a second app exist in the template?** "Shared auth" is a claim until two apps share it.
   An `apps/admin` would prove it and would also double the maintenance surface.
5. **Reuse Supabase's `authenticated` role or define our own?** `authenticated` arrives with
   sensible grants but is a Supabase artifact in a design that otherwise avoids them.
6. **Does `packages/vite-config` derive the workspace list, or accept it as an argument?** Derivation
   removes the drift but reads the workspace at config time. An explicit argument is dumber and
   easier to debug.
