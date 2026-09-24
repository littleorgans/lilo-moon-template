# Releasing the packages

For maintainers. This page covers how `.github/workflows/release.yml` publishes the
`@littleorgans/*` packages, the one-time bootstrap before npm trusted publishing takes over, and
recovery when a release stops partway. [Why this baseline is shaped this way](decisions.md#publishing-waits-for-the-whole-gate-on-the-released-commit)
records the reasoning.

## What a release is

Every published package shares one version (the Changesets `fixed` group, decision D3). A release
publishes all of them at that version from one commit on `main`, then creates:

- a git tag `@littleorgans/<package>@<version>` for each package, annotated, as `changeset publish`
  creates them;
- the repository tag `v<version>`, annotated, on the same commit. The adoption guides clone and fetch
  reference files at this tag;
- one GitHub release, on `v<version>`, whose notes hold each package's CHANGELOG entry under the
  package name. There is no release per package: the packages share a version and a commit, and
  a release per package would mostly repeat "Updated dependencies".

`@littleorgans/web` and `services/api` are private. `privatePackages.version` is `false` in
`.changeset/config.json`, so they keep version `0.0.0`, get no CHANGELOG and are never tagged. A
changeset must name only published packages; `scripts/tests/versioning.test.mjs` enforces it.

## The flow

`release.yml` runs on every push to `main`, one run at a time, with `cancel-in-progress: false`.
A new push does not cancel the running release. GitHub keeps only one pending run in the
concurrency group; another push replaces that pending run. Each run checks out its triggering SHA,
even if a newer Version PR has merged.

1. **Version.** `changesets/action` reads `.changeset/`. While changesets are pending, it opens or
   updates the "chore: version packages" pull request and the run ends. It never publishes.
2. Merging that pull request consumes the changesets. On the merge commit, the version job reports
   no changesets. The jobs below run only when that is so, the tag `v<version>` is not on origin
   yet, **and** the repository variable `NPM_PUBLISH_ENABLED` is `true`. A failed tag lookup stops
   the run rather than counting as unreleased. GitHub release creation and smoke run after the
   tags, so once `v<version>` exists later pushes release nothing; recover a failed release or smoke
   step from the original run.
3. **Release gate.** On that exact commit: `moon ci --force`, which runs every task `moon ci` runs,
   with no affected filter and no cache (build, typecheck, lint, format, test coverage, secrets,
   audit, the database tasks, `published-shape`, `packed-secrets`, `release-rehearsal`). Then
   `node scripts/release.mjs pack` packs each published package once into a directory and records
   each tarball's sha512 in `release.json`. The secrets scan and `published-shape` then run against
   those files, and the directory is uploaded as `release-tarballs-<attempt>`. The job outputs that
   upload's artifact ID.
4. **Publish.** Needs the gate. Downloads the artifact by that ID, checks every tarball against
   `release.json`, and refuses conflicting tags before any upload. Then runs
   `npm publish <file>.tgz --access public --ignore-scripts` for each, dependencies first. A version
   already on the registry with the same integrity is skipped; one with different bytes stops the
   job. Then `node scripts/release.mjs tag` pushes the tags and creates the release. This is the
   only job that can mint an OIDC token or read the npm token. It installs no workspace
   dependencies, and its pinned npm install uses `--ignore-scripts`.
5. **Smoke.** Needs publish. Waits until the public registry serves each version with the recorded
   integrity, installs the exact versions into an empty directory, typechecks every entry point with
   TypeScript 5 and imports each one.

The tarball npm receives is byte for byte the one the gate scanned and checked. Publishing a
tarball runs no lifecycle scripts, and every step after `pack` refuses a file whose sha512 differs
from `release.json`.

The handoff trusts the gate job and nothing outside the run. Only a job in the same run can upload
to its artifacts, and download-artifact reads the current run only, so a concurrent run cannot
supply the tarballs. An uploaded artifact is immutable: replacing one creates a new ID, and
download-artifact fails when the content differs from the digest recorded at upload. Binding the
download to the gate's artifact ID therefore pins the exact upload the gate made. The gate job
itself is not defended against: code it runs, including every development dependency, can change
the source before `pack`, which no later digest detects.

Until `NPM_PUBLISH_ENABLED` is set, merging anything, including the Version PR, only versions.

## Who authors the Version Packages PR

The version job authors the pull request with `secrets.LILO_GITHUB_PAT` when that secret exists,
and with `GITHUB_TOKEN` when it does not. Without the secret, releases still work, but the PR comes
from `github-actions[bot]` in an approval-required state: its `CI` run returns `action_required`,
the required check never reports, and the PR cannot merge until a maintainer opens it and selects
**Approve workflows to run**. That is
[GitHub's documented `GITHUB_TOKEN` behavior](https://docs.github.com/en/actions/concepts/security/github_token),
and this repository hit it on its first changeset.

Point the secret at a token of a user with write access, or at a GitHub App installation token, and
the approval step disappears. Prefer the App token: a PAT expires, and when it does, releases stop
being proposed without an obvious signal. The publish job never uses this token. It tags and
creates the release with the job's own `GITHUB_TOKEN`.

## Authentication

npm authenticates the publish in one of two ways. The workflow needs no edit to move between them.

- **Bootstrap.** The organization secret `LILO_NPM_TOKEN` reaches npm as `NODE_AUTH_TOKEN`, and
  `NPM_CONFIG_PROVENANCE=true` attaches provenance.
- **Steady state.** npm trusted publishing (OIDC). The job has `id-token: write` and runs npm
  11.20.0, pinned in `release.yml` (trusted publishing needs 11.5 or later).

npm tries OIDC first for every package and falls back to the configured token when the exchange
fails, for example because the package has no trusted publisher yet
([npm 11.20.0 `lib/utils/oidc.js`](https://github.com/npm/cli/blob/v11.20.0/lib/utils/oidc.js)).
While the token exists, packages with a trusted publisher use OIDC and the rest use the token.
Once the secret is deleted, `NODE_AUTH_TOKEN` is empty and OIDC is the only route.

Provenance still uses GitHub OIDC when registry authentication uses the bootstrap token; the
public repository, GitHub-hosted runner and `id-token: write` are needed in both stages.
`setup-node` writes an npmrc containing the literal `${NODE_AUTH_TOKEN}` placeholder, not the token.
Only the publish step receives that secret. Checkout does not persist Git credentials; the tagging
step receives its GitHub credential through process environment configuration.

OIDC is a job-level capability: pinned actions, npm and the reviewed release script in that job
can request it. Step-scoping the npm secret does not sandbox those components. No package
lifecycle scripts or workspace dependency installs run in that job.

## Bootstrap: the first release

npm can attach a trusted publisher only to a package that already exists, so the first publish of
each package uses the token ([npm/cli#8544](https://github.com/npm/cli/issues/8544)).

1. Check `LILO_NPM_TOKEN`: a granular access token with read and write access to the
   `@littleorgans` scope that can create new packages there, with a short expiry. If publishing
   requires two-factor authentication on the account or organization, the token must be allowed to
   bypass it. Organization permissions alone do not grant package publishing access.
2. Set the repository variable: **Settings → Secrets and variables → Actions → Variables →**
   `NPM_PUBLISH_ENABLED` = `true`.
3. Merge the Version PR. The Release run on the merge commit runs the gate, publishes `0.1.0` of
   every package, tags, creates the `v0.1.0` release and runs the smoke. If the Version PR merged
   before step 2, open that commit's Release run and select **Re-run all jobs**.
4. Check that each package page on npmjs.com shows the provenance badge.

### Attach a trusted publisher to each package

Do this once every package exists on the registry. Either route works.

**CLI.** [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/) needs npm 11.15.0 or
later, write access to the packages and two-factor authentication on your npm account. It does not accept a granular token that bypasses 2FA, so sign
in as yourself. The first call asks for a 2FA code. On that prompt, choose to skip 2FA for the next
5 minutes, and the loop finishes without further prompts.

```sh
npm install --global npm@11.20.0
npm login
for package in auth auth-http auth-session auth-tanstack auth-workos create-app db db-tools oxlint-config theme tsconfig ui views vite-config; do
  npm trust github "@littleorgans/$package" --repository littleorgans/lilo-moon-template --file release.yml --allow-publish --yes
  sleep 2
done
npm trust list @littleorgans/auth
```

**Web.** For each package on npmjs.com: **Settings → Trusted Publisher → GitHub Actions**, then
organization or user `littleorgans`, repository `lilo-moon-template`, workflow filename
`release.yml`, environment empty. Save.

A package holds one trusted publisher. To replace one, find its ID with `npm trust list <package>`,
then run `npm trust revoke --id <id> <package>`.

Optional hardening, once every package trusts `release.yml`: set each package's **Settings →
Publishing access** to require two-factor authentication and disallow tokens. Trusted publishing
still works under that setting.

### Remove the token

1. Run `npm trust list` for each published package. Each must allow publishing from
   `littleorgans/lilo-moon-template` and `release.yml`.
2. On npmjs.com, **Access Tokens**: delete the token behind `LILO_NPM_TOKEN`.
3. Delete the organization secret: **littleorgans → Settings → Secrets and variables → Actions**,
   or `gh secret delete LILO_NPM_TOKEN --org littleorgans`.

No workflow edit follows. The next release publishes through OIDC, and a successful publish with no
token is the proof.

## Add a new package later

A new package repeats the bootstrap once, because it does not exist on the registry yet.

1. Add it to the `fixed` group in `.changeset/config.json`. `scripts/tests/versioning.test.mjs`
   fails until you do.
2. Before merging the Version PR that first releases it, create a short-lived granular token for
   the scope and store it as `LILO_NPM_TOKEN` again. The existing packages keep publishing through
   OIDC, and the new one uses the token.
3. After the release, attach the trusted publisher to the new package and remove the token as
   above.

If the token is missing, the publish stops at the new package with an authentication error. The
packages published before it stay published. Add the token and re-run the failed jobs.

## Recover from a partial release

Every step can be rerun. Prefer **Re-run failed jobs** on the release run: it downloads the gate's
artifact by ID (kept 30 days), so the bytes are the ones the gate checked, and the tags land on the
release commit. Until `v<version>` is on origin, a later push to `main` also retries the
release from its own commit. That retry stops before uploading if package tags already point at the
earlier commit, because a released tag never moves: re-run the original run instead.

- **Publish stopped partway.** Re-run failed jobs. Versions already on the registry with the same
  integrity are skipped, and the rest publish in dependency order.
- **Tagging failed after the publish.** Re-run failed jobs. The publish skips every package, and
  tags and the release that exist are kept. A tag that exists on another commit stops the job, so a
  released tag never moves.
- **The registry holds different bytes for a version.** The publish refuses it. A published version
  cannot be replaced, so release a new version with a changeset. This happens after **Re-run all
  jobs** if a rebuild does not reproduce the published bytes. `pnpm pack` output is deterministic,
  so this would mean the build changed.
- **The smoke failed.** The versions are live. Read the failure. If propagation was slow, re-run the
  job. It waits up to about five minutes. If the packages are broken, fix forward with a patch
  release rather than unpublishing.

## Sync the skills

The skills under `skills/lilo/` are written and reviewed here (decision D4), and reach agents
through the agent-runtimes catalog, `littleorgans/.agent-runtimes`. Its generator renders each
`skills/<owner>/<domain>/<skill>/SKILL.md` into the runtime homes that select it and never reads
this repository, so a reviewed copy has to be committed there. Sync after each release, and after a
change to skill text between releases:

1. From an up-to-date `main` with its tags fetched (`git fetch --tags`), with a clean catalog
   checkout on a new branch:

   ```sh
   moon run root:skills-sync -- <catalog>
   ```

   It replaces `<catalog>/skills/lilo/` with `skills/lilo/` as committed at `HEAD`: the skills,
   and `settings.toml` with the `lilo/build-core` bundle. A skill deleted here disappears there.
   Other owners are untouched. `--ref <commit>` syncs another commit.

2. It writes nothing when `skills/lilo/` has uncommitted changes and no `--ref` was given, when a
   skill breaks a rule the catalog enforces at load, or when a skill cites a path that the newest
   `v<major>.<minor>.<patch>` tag does not have. Skills send readers to the reference at the tag
   matching the version they install, so a path added after that release would send them to
   nothing. Sync once the release that adds it is out. `--tag <tag>` checks against another
   release tag.

3. In the catalog, review the diff, run `python3 bin/generate.py --catalog` to confirm the catalog
   loads, regenerate the runtimes that select the skills, and open the catalog's pull request. The
   script never commits.

CI runs `root:skills-check`, the same checks against the working tree, so a change that moves or
deletes a file updates the skills that cite it in the same pull request. To ask the release
question without syncing, run `node scripts/check-skills.mjs --at v<version>`.

## Run it locally

- `moon run root:release-rehearsal` runs the publish half against a local Verdaccio in Docker
  (image pinned by digest), with the npm `release.yml` pins. It covers the refusal of a tarball
  changed after the scan, a publish that fails partway and the rerun that completes it, integrity
  against the registry, the tags and the one release on a scratch clone, and the smoke. The
  `@littleorgans` scope resolves to Verdaccio before anything is published.
- `node scripts/release.mjs pack <directory>`, then
  `node scripts/check-packed-secrets.mjs <directory>` and
  `node scripts/published-shape.mjs <directory>`, repeat the gate's tarball checks.
- `changeset version` needs a GitHub token: `@changesets/changelog-github` reads pull request and
  author details from the API. Run `GITHUB_TOKEN=$(gh auth token) pnpm changeset:version`.

The rehearsal bootstrap and release registry calls have a two-minute process timeout; packed
consumer installs, the smoke's install and scaffold commands have a ten-minute timeout. A stalled npm process fails
the gate instead of waiting indefinitely. The npm bootstrap streams its output for diagnosis.
