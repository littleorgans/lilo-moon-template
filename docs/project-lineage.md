# Create projects and inspect template impact

The template owns `scripts/projects.mjs`. It creates a new local Git repository and records its
relationship to a committed template revision. The command uses the repository's existing rename
script and Moon setup tasks.

## Create a project

From this template checkout:

```bash
just new-project atlas --dest ../projects --org your-org
```

The destination is `../projects/atlas`. The package scope defaults to the project name. Override it
with `--scope your-scope`. Names use lowercase letters and digits, with internal periods,
underscores or hyphens. The command refuses an existing destination and paths inside the template,
including paths that resolve there through a symlink.

Creation exports the committed tree at `HEAD`, replaces the template names, installs dependencies,
runs `moon sync` and formatting, then creates one initial commit in the new repository. Your local
Git author configuration supplies its identity. The initial commit skips hooks and signing so
bootstrap does not depend on project hooks that are being installed. Run `just check` and `just ci`
in the new project before delivery.

The reference application and example members remain available. Generate your product members and
remove examples following [the instantiation guide](how-to-instantiate.md). Configure the app port
and your WorkOS environment there. Ignored environment files and installed dependencies are excluded from the source snapshot.

Options:

- `--ref <commit>` chooses a different committed revision that supports project provenance.
- `--remote <url>` sets the new repository's origin locally. It does not create a hosted repository
  or push anything.
- `--no-install` creates the repository with setup pending. Run `pnpm install`, `moon sync`, and
  `just check` in it afterwards. The origin records the creation state and remains unchanged.
- `--dry-run` prints the validated plan without creating directories or registry records.

Uncommitted template edits are excluded. Commit a template change before generating a project from
it. The producer's consumer acceptance gate creates its own temporary committed snapshot when
verifying uncommitted development changes.

If creation fails before the initial project is finalized, it removes its reserved destination and
records no descendant. If registration fails after the project commit succeeds, the project is
retained and the error gives the command needed to register it again.

## Where the relationship lives

| Location                         | Owner               | Contents                                                                                           |
| -------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `.template/config.json`          | Template, tracked   | Stable template UUID and metadata schema version                                                   |
| `.template/projects/<uuid>.json` | Template, tracked   | Project UUID, name, birth revision, creation time, remote URL, origin fingerprint                  |
| `.template/local/<uuid>.json`    | Template, ignored   | This machine's absolute checkout path                                                              |
| `.template-origin.json`          | Descendant, tracked | Matching project and template IDs, birth revision, generation parameters and inherited file hashes |

A new project does not inherit the template's registry or other projects' paths. Registry entries
use separate files so two creators do not overwrite a shared array. Creation leaves the new
portable record as a Git change in the template for you to commit with the project registration.
Machine paths remain ignored. Remote URLs stored in records omit URL credentials and query data.

The birth record is immutable. Its file signatures include content, file type and executable mode.
Registration checks the origin fingerprint before refreshing a known project. It refuses edited
provenance. Applying a template fix to a product does not advance its birth revision or imply that
all intervening fixes were applied.

## Find or relocate a descendant

```bash
just projects
just project-register /path/to/existing/atlas
```

Registration reads the descendant's origin file and verifies that the path is its Git repository
root. It updates the local locator and current origin URL. Repeat it after moving a checkout,
cloning it onto another machine, or adding a remote. Repeating registration does not create a
second project entry. A checkout from a different template is rejected.

A copied registry on another machine can list remote repositories before their checkouts are
available. Impact reports retain these projects as unavailable. They are not silently omitted.
Existing projects created before this feature have no birth manifest and cannot be registered by
inventing one. A future adoption workflow needs an explicitly reviewed starting snapshot.

## Inspect a template change

```bash
just project-impact
just project-impact --from HEAD~1 --to HEAD
node scripts/projects.mjs impact --json
```

By default, each project is compared from its own birth revision through the template's current
working tree, including untracked additions and tracked deletions. `--from` supplies a common
starting revision. `--to` selects a committed endpoint and excludes working edits. Registry and
origin metadata are excluded from the change set.

Use the direct Node command for clean JSON output. Moon and just add task output around their
command's output.

For each available checkout, the report classifies changed template paths:

| State             | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `unchanged`       | The descendant file still matches its generated signature                     |
| `modified`        | The descendant changed the inherited file's contents, type or executable mode |
| `deleted`         | The descendant removed that inherited file                                    |
| `new-in-template` | The path was not inherited and does not exist in the descendant               |
| `project-only`    | The path was not inherited, but the descendant already has a file there       |

File comparison covers every language. The `manifestDependents` list identifies affected members
and follows dependency names in current JavaScript package manifests. Its `dependencyCoverage`
field explicitly excludes Moon-only and other language dependency edges. Inspect those graphs
separately. Root-level changes conservatively include every current member.

Missing checkouts are `unavailable`. Missing Git history, mismatched provenance or inspection errors
are `unknown`, with a reason. A relocated file appears deleted at its original path; the report does
not infer semantic moves. Identical files do not prove a patch is compatible, and modified files
may already contain the intended fix. These are inputs for an agent's review.

The commands do not fetch remote code, apply updates, edit descendant source during inspection, or
open cross-project pull requests.

## Verification

`root:scripts-test` checks provenance, destination refusal, failed creation, registration,
customizations, mode changes and dependency reporting in disposable Git repositories.
`root:consumer-check` calls the real creator with installation enabled, then builds and runs the
generated workspace and a separate packed-library consumer. Those fixtures register only against
a disposable template snapshot.
