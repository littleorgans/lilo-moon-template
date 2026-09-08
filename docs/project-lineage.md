# Create projects and learn from consumers

The template owns `scripts/projects.mjs`. It creates a project with shared Git history and records
where that project lives. Use the consumer list when improving this baseline to inspect real
implementations for reusable components, fixes and lessons.

## Create a project

From the upstream template checkout:

```bash
just new-project atlas --dest ../projects --org your-org
```

The destination is `../projects/atlas`. The package scope defaults to `atlas`; override it with
`--scope your-scope`. The source must have full Git history and an origin remote. The script refuses
existing destinations and paths inside the template, including symlink aliases.

Creation fetches the selected commit and its ancestors into an independent Git repository. It
checks out main, replaces template names, installs dependencies and runs Moon synchronization and
formatting. One new commit records the project configuration on top of the template history.
The commit uses your Git identity and skips hooks and signing during bootstrap.

| Remote     | Destination                                                            |
| ---------- | ---------------------------------------------------------------------- |
| `origin`   | `git@github.com:your-org/atlas.git`, or the URL passed with `--remote` |
| `upstream` | The template checkout's origin URL                                     |

Main tracks origin/main and pushes default to origin. Creation configures both remotes locally;
it does not create a hosted repository, push, or require the new remote to exist yet.

Options:

- `--ref <commit>` selects a committed baseline revision. The default is HEAD.
- `--remote <url>` overrides the product origin, for example for another Git host.
- `--no-install` leaves dependency setup pending. Run `pnpm install`, `moon sync`, and `just check`.
- `--dry-run` validates and prints the plan without writing files.

Uncommitted edits and ignored local files are excluded. The selected commit's complete history is
retained, including historical files and committed consumer records. Choose a template revision
available on upstream before distributing a project, so its starting commit is shared there too.

The working application is the starting point for product development. Projects may change or delete
it. See [the instantiation guide](how-to-instantiate.md) for environment setup and member removal.

If creation fails before the customization commit succeeds, the reserved destination is removed and
no consumer is registered. If registration fails afterwards, the project is retained and the error
explains how to retry registration.

## Find consumers

Run these commands in the upstream template checkout:

```bash
just projects
node scripts/projects.mjs list --json
just project-register /path/to/atlas
```

The list shows each project's name, starting template revision, repository URL and local checkout
path. JSON output is available for agents. Use the direct Node command for clean JSON without Moon
or just task output. Inspect those checkouts to decide what belongs back in the baseline.

Registration refreshes the local path and origin URL without duplicating the entry. Run it after a
checkout moves, is cloned onto another machine, or receives a new origin URL. A missing local checkout
does not remove its portable record. This is a directory of consumers, not a synchronization service.

| Location                         | Contents                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `.template/config.json`          | Stable template identity                                                                  |
| `.template/projects/<uuid>.json` | Tracked consumer name, ID, creation time, starting revision and repository URL            |
| `.template/local/<uuid>.json`    | Ignored local checkout path                                                               |
| `.template-origin.json`          | Downstream creation record with template identity, starting revision and setup parameters |

Commit new consumer records in the upstream template. Separate files avoid concurrent creators
replacing each other's entries. Local paths remain ignored. Stored remote URLs omit URL passwords,
HTTP usernames and query data.

The tracked `.template` directory remains inherited source so future rebases can bring registry
updates through without replaying deletion of that directory. Its authoritative copy lives upstream.
The downstream origin record identifies a product checkout; creation must run from the template.
Registration preserves the recorded name, creation date and starting revision. It does not advance
that revision after a rebase. Git history records subsequent updates.

## Receive template updates

In the downstream repository, with a clean working tree:

```bash
git fetch upstream
git rebase upstream/main
pnpm install
moon sync
just check
just ci
```

Git replays product commits onto the updated baseline. Resolve conflicts where both sides changed
the same code, including edits to examples the product deleted. For already published commits,
coordinate the history rewrite with collaborators before pushing. Creation and registration never
rebase or modify an existing downstream project automatically.

## Verification

`root:scripts-test` creates disposable template and product repositories. It proves shared ancestry,
both remotes, product customization, fetching and rebasing a template fix, and pushing to the product
origin. It also checks destination refusal, failure cleanup, registration and concurrent creation.
`root:consumer-check` creates the real baseline with installation enabled, then builds and serves
its application with workspace libraries and separately with packed libraries. These fixtures use
disposable consumer registries. The gate skips in downstream repositories.
