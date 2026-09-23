# Start a project from this template

Use `just new-project` from a template checkout to create a new repository with names and provenance
already configured. Adapt the application and remove examples you do not need. The working
contract is [AGENTS.md](../AGENTS.md).

```bash
just new-project your-repo --dest ../projects --org your-org
```

See [project creation and consumer tracking](project-lineage.md) for the registry, optional remote
URL, dry run and setup options. After automated creation, continue at **Claim your ports** below.
Use the creator to configure both remotes and register the project.

## Install the tools first

`just setup` needs `just` and moon `2.5.1` on `PATH`. The workspace `versionConstraint` in
`.moon/workspace.yml` is `=2.5.1`. Any other moon release is rejected. proto is the version manager
that reads `.prototools`. CI installs moon from that file. `just setup` does not install just, moon,
or proto.

Install proto:

```bash
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

Finish the installer prompt so `~/.proto/bin` is on `PATH`. Then pin moon to the workspace version:

```bash
proto install moon 2.5.1
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

`moon --version` must print `2.5.1`.

## Create the repository

Run the creation command above from a full template checkout. By default, the new project's origin
is `git@github.com:your-org/your-repo.git`; override it with `--remote <url>`. The template checkout's
origin becomes the new project's upstream remote. The script configures remotes locally; create the
hosted product repository separately before your first push.

```bash
cd ../projects/your-repo
git remote -v
just check
just ci
```

The package scope defaults to the project name. Pass `--scope your-scope` during creation to choose
another scope. Run `just rename-verify` to verify the identity replacements.

## Claim your ports

Set the development port in `apps/web/vite.config.ts` and the preview port in `apps/web/moon.yml`.
Register the matching OAuth callback.
Choose a distinct port for each additional application.

The Postgres container name and default port are derived from the checkout's absolute path.
Separate clones and worktrees therefore own separate containers. Override `LILO_PG_PORT` when a
port is occupied. Run `just clean` before changing that override on an existing container.
Cleanup removes only the current checkout's container.

Auth cookies are namespaced by client id and redirect URI. Theme cookies include the request origin,
including its port, so applications sharing localhost do not overwrite one another's cookies.

`root:consumer-check` verifies repository creation and installed tarballs in disposable consumers
before template delivery. It skips in downstream repositories identified by `.template-origin.json`.

The source condition is a matching pair. The key in `exports` and the string in
`resolve.conditions` must be the same. Node's standard conditions stay pointed at `dist`. Why is
in [Why this baseline is shaped this way](decisions.md).

There is no root `LICENSE` file. Add one. Set `license` in every publishable `package.json` to the same SPDX id.

Review `publishConfig.access` in each library before publishing it.

Do not change `packageManager`, `engines`, catalog pins, or the moon version. Those are the
baseline.

## Adapt the application and members

Develop your product in `apps/web`. Its routes, feature directories and service composition are
ordinary application source. Replace the task board and other diagnostic examples as needed.
Additional members follow [Add a workspace member](../AGENTS.md#add-a-workspace-member).

The task board imports `packages/collections`. Remove that usage and the dependency from
`apps/web/package.json` and `apps/web/moon.yml` before deleting collections. You may also delete
`apps/web` entirely if the project does not need it. Keep `services/ping` only if you want the Rust
example. No generator depends on retaining any example.

After removing members:

```bash
moon run root:prune-references
pnpm install
moon sync
just check
just ci
```

Moon adds project references but does not remove every deleted target. The pruning command removes
those references before Moon synchronizes the remaining projects.

## Receive template updates

Start with a clean working tree, then:

```bash
git fetch upstream
git rebase upstream/main
pnpm install
moon sync
just check
just ci
```

Resolve conflicts according to the product's requirements. In particular, an upstream edit to an
application that the product deleted requires a decision about keeping that deletion. Shared history
makes the comparison possible; it does not guarantee conflict-free updates. Rebasing commits already
pushed to origin rewrites their history, so coordinate with collaborators before updating that branch.

### The database is baseline, not an exemplar

`db/schema.sql` holds `accounts` and `profiles`. They are the user entity and they are meant to be
kept: see [The user entity](user-entity.md). Add your own tables alongside them, then:

```bash
moon run root:atlas-diff
moon run root:drizzle-generate
```

`packages/db/migrations/` gains a versioned file and `db/drizzle/_generated/schema.ts` is rewritten. Never
edit the generated Drizzle schema by hand. Security policies require hand-authored SQL migrations.
Never move `db/schema.sql` into `packages/db/migrations/`. Atlas checksums that
directory in `atlas.sum` and reads every `.sql` file in it as a versioned migration.

**A new table needs a policy migration as well as a schema entry.** Atlas does not model row level
security and drops it from a diff without saying so, so policies are hand-written under
`packages/db/migrations/` and the checksum is regenerated with
`atlas migrate hash --dir file://packages/db/migrations`. `moon.yml` `tasks.rls-verify` fails when any table
in `public` lacks row level security enabled and forced, which is what stops a new table shipping
readable by every tenant.

Delete the whole `db/` directory only if this repo has no database at all. The six
`test ! -f db/schema.sql` checks in `moon.yml` make an absent schema skip every Atlas, Drizzle and
RLS task before Atlas or Docker starts. Deleting `db/schema.sql` on its own skips those tasks as
well, which leaves `packages/db/migrations/` and `db/drizzle/_generated/` in the tree with nothing checking
them.

## What you must not delete

These are the baseline. Removing any of them is a fork, not an instantiation.

- `.moon/workspace.yml`, `.moon/toolchains.yml`, `.moon/tasks/`
- `moon.yml` at the repository root, including `tasks.lint`, `tasks.format-check`,
  `tasks.project-refs`, `tasks.secrets`, `tasks.audit`, and `inheritedTasks.include`
- `justfile`
- `scripts/assert-tsgolint-lockstep.mjs`, `scripts/check-security.mjs`, and the root lockstep task
- `scripts/rls-verify.mjs`, `scripts/drizzle-schema.mjs`, and `scripts/lib/postgres-container.mjs`,
  unless you delete `db/` entirely
- `pnpm-workspace.yaml` catalogs
- `tsconfig.options.json`
- `.oxlintrc.json` and `.oxfmtrc.json`
- `lefthook.yml`, lefthook `scripts.prepare` in the root `package.json`, and `commitlint.config.js`
- `.changeset/`
- `.github/workflows/ci.yml`
- `renovate.json`
- `.vscode/extensions.json` and `.vscode/settings.json`
- `.prototools`
- `.npmrc`
- `.editorconfig`
- `AGENTS.md`

`services/` is a glob in both `.moon/workspace.yml` `projects.globs` and `pnpm-workspace.yaml`
`packages`. Leave the glob. `services/ping` is the Rust exemplar. The Rust toolchain is on in
`.moon/toolchains.yml`. Python stays commented until a Python member lands.

A clone that keeps only ping still runs `pnpm install` for the root oxlint, oxfmt, secretlint, and
audit gates. Those tools live in `devDependencies` in the root `package.json`. A Rust-only
`moon ci` still installs that JavaScript toolchain.

## Prove the result is healthy

The renamed tree must pass `just ci`. From a library directory, `npm pack --dry-run`
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
a run before job-level concurrency protects a publish and can leave a partial release. This template
has exercised neither the OIDC publish path nor the extra workflow gate, so it does not prescribe an
integration recipe.

The Version Packages PR is authored by `secrets.HELIOY_PAT` when that secret exists, and by
`GITHUB_TOKEN` when it does not. **Rename that secret to something of your own.** It carries the
template author's naming, `just rename` does not rewrite it because it is not a template identity
token, and `just rename-verify` will not flag it. Leave it unset and releases still work, but the PR arrives from
`github-actions[bot]` in an approval-required state: its `CI` run comes back `action_required`, the
required check never reports, and the PR cannot merge until a maintainer opens it and selects
**Approve workflows to run**. That is
[GitHub's documented `GITHUB_TOKEN` behavior](https://docs.github.com/en/actions/concepts/security/github_token),
and this template hit it on the first changeset it ever produced.

Point that secret at a token belonging to a user with write access, or to a GitHub App installation
token, and the approval step disappears. Prefer the App token. A PAT expires, and when it does
releases stop being proposed without an obvious signal.

## After this page

Work inside the repo is AGENTS.md. Settled tool choices are
[Why this baseline is shaped this way](decisions.md).
