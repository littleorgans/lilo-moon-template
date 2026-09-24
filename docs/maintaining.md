# Maintain this repository

This page is for working on this repository: its toolchain, members, database baseline, CI runner
and publishing. A project that uses the packages starts from
[Adopt the packages in a web app](guides/adopt-web-app.md) or
[Adopt the packages in a service](guides/adopt-service.md) instead. The working contract is
[AGENTS.md](../AGENTS.md).

## Install the tools first

`just setup` needs `just` and moon `2.5.5` on `PATH`. The workspace `versionConstraint` in
`.moon/workspace.yml` is `=2.5.5`. Any other moon release is rejected. proto is the version manager
that reads `.prototools`. CI installs moon from that file. `just setup` does not install just, moon,
or proto.

Install proto:

```bash
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

Finish the installer prompt so `~/.proto/bin` is on `PATH`. Then pin moon to the workspace version:

```bash
proto install moon 2.5.5
```

Install just from the [just installation guide](https://github.com/casey/just#installation). On
macOS:

```bash
brew install just
```

Confirm before you clone:

```bash
proto --version
moon --version
just --version
```

`moon --version` must print `2.5.5`.

## Local ports and containers

The reference app runs on port 5199 (`apps/web/vite.config.ts` and the preview `PORT` in
`apps/web/moon.yml`) and the reference service on 8787 (`services/api/moon.yml`).

The database gates and integration tests run in a Postgres container that `@littleorgans/db-tools`
manages. Its name and default port are derived from the checkout's absolute path, so separate
clones and worktrees own separate containers. Override `LILO_PG_PORT` when a port is occupied. Run
`just clean` before changing that override on an existing container. Cleanup (`db-tools clean`, then
`moon clean`) removes only a container labelled as this checkout path's managed scratch space.
Compatible unlabelled containers left by the old root scripts still run the gates, but automated
cleanup and image replacement refuse to delete them. Inspect and remove those manually when they
are disposable; a reused path or matching name alone does not establish that.

## Library conventions

The source condition is a matching pair. The key in `exports` and the string in
`resolve.conditions` must be the same. Node's standard conditions stay pointed at `dist`. Why is
in [Why this baseline is shaped this way](decisions.md).

Every publishable `package.json` sets `license` to `MIT` and ships a copy of the root `LICENSE`.

Review `publishConfig.access` in each library before publishing it.

## Remove a workspace member

Additional members follow [Add a workspace member](../AGENTS.md#add-a-workspace-member). After
removing members:

```bash
moon run root:prune-references
pnpm install
moon sync
just check
just ci
```

Moon adds project references but does not remove every deleted target. The pruning command removes
those references before Moon synchronizes the remaining projects.

## The database is baseline, not an exemplar

`db/schema.sql` holds `accounts` and `profiles`. They are the user entity and they are meant to be
kept: see [The user entity](user-entity.md). New tables go alongside them, then:

```bash
moon run root:atlas-diff
moon run root:drizzle-generate
```

Both run `db-tools` from `@littleorgans/db-tools` with `--migrations packages/db/migrations`, because
this repository ships its migrations inside `@littleorgans/db` rather than in `db/migrations/`.
`packages/db/migrations/` gains a versioned file and `db/drizzle/_generated/schema.ts` is
rewritten. Never edit the generated Drizzle schema by hand. Security policies require hand-authored
SQL migrations. Never move `db/schema.sql` into `packages/db/migrations/`. Atlas checksums that
directory in `atlas.sum` and reads every `.sql` file in it as a versioned migration.

**A new table needs a policy migration as well as a schema entry.** Atlas does not model row level
security and drops it from a diff without saying so, so policies are hand-written under
`packages/db/migrations/` and the checksum is regenerated with
`atlas migrate hash --dir file://packages/db/migrations`. `moon.yml` `tasks.rls-verify` fails when
any table in `public` lacks row level security enabled and forced, which is what stops a new table
shipping readable by every tenant.

Delete the whole `db/` directory only if this repo has no database at all. The six
`test ! -f db/schema.sql` checks in `moon.yml` make an absent schema skip every Atlas, Drizzle and
RLS task before Atlas or Docker starts. Deleting `db/schema.sql` on its own skips those tasks as
well, which leaves `packages/db/migrations/` and `db/drizzle/_generated/` in the tree with nothing
checking them.

## Prove the result is healthy

The tree must pass `just ci`. From a library directory, `npm pack --dry-run`
lists `dist` and `src`. No packed `.map` entry may point at a path outside the package.

Then prove the gates can fail. Follow [Prove every gate](../AGENTS.md#prove-every-gate). Do not
skip that procedure because `lefthook.yml`, a changeset, or a coverage threshold might be stricter.

`lefthook.yml` runs `root:format-check`, `root:lint`, and `root:secrets` before a commit. Its
`commit-msg` hook runs commitlint. `just ci` also runs `root:secrets` and `root:audit`. Add a
changeset with `pnpm exec changeset` when a change belongs in the changelog for any versioned
package, including a library or private application.

## Switch the CI runner

`.github/workflows/ci.yml` selects the job runner from the repository Actions variable
`CI_RUNNER`. Leave it unset and the job runs on `ubuntu-latest`. Set it to a runner label
when you want a different host. It is a variable, not a secret.

In `.github/workflows/release.yml`, the release gate job runs on the same runner as CI, because it
runs the same tasks. The version, publish and smoke jobs stay on `ubuntu-latest`: npm provenance and
trusted publishing need a GitHub-hosted runner.

## Enable package publishing

[Releasing the packages](releasing.md) covers publishing: the flow, the npm bootstrap and trusted
publishing, and who authors the Version Packages PR.

## After this page

Work inside the repo is AGENTS.md. Settled tool choices are
[Why this baseline is shaped this way](decisions.md).
