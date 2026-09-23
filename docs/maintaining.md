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

The Postgres container name and default port are derived from the checkout's absolute path.
Separate clones and worktrees therefore own separate containers. Override `LILO_PG_PORT` when a
port is occupied. Run `just clean` before changing that override on an existing container.
Cleanup removes only the current checkout's container.

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

`.github/workflows/release.yml` stays on `ubuntu-latest`. Releases are rare, and that
workflow has `id-token: write` for npm trusted publishing.

## Enable package publishing

npm can attach a trusted publisher only after a package exists on the registry, so the first release
must use another publishing route. [npm CLI issue #8544](https://github.com/npm/cli/issues/8544)
tracks support for an initial OIDC publish, so only later releases can use this workflow's OIDC path.
After every package has a trusted publisher for `release.yml`, set the repository Actions variable
`NPM_PUBLISH_ENABLED` to `true`.

Without an enabling value, Changesets can manage the Version Packages PR but receives no publish
command. When enabled, `moon run :build` through `changeset:publish` and branch protection for `main`
gate publishing.

Adding lint, typecheck, and tests to the publish path is a non-trivial workflow change that must
account for job sequencing within one workflow file, the `contents: write` and
`pull-requests: write` permissions, and a workflow-level `cancel-in-progress` setting that can cancel
a run before job-level concurrency protects a publish and can leave a partial release. This repository
has exercised neither the OIDC publish path nor the extra workflow gate, so it does not prescribe an
integration recipe.

The Version Packages PR is authored by `secrets.LILO_GITHUB_PAT`, a repository-level token, when that
secret exists, and by `GITHUB_TOKEN` when it does not. Leave it unset and releases still work, but
the PR arrives from `github-actions[bot]` in an approval-required state: its `CI` run comes back
`action_required`, the required check never reports, and the PR cannot merge until a maintainer
opens it and selects **Approve workflows to run**. That is
[GitHub's documented `GITHUB_TOKEN` behavior](https://docs.github.com/en/actions/concepts/security/github_token),
and this repository hit it on the first changeset it ever produced.

Point that secret at a token belonging to a user with write access, or to a GitHub App installation
token, and the approval step disappears. Prefer the App token. A PAT expires, and when it does
releases stop being proposed without an obvious signal.

## After this page

Work inside the repo is AGENTS.md. Settled tool choices are
[Why this baseline is shaped this way](decisions.md).
