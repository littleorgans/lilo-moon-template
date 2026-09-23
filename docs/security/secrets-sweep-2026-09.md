# Secrets sweep, September 2026

Phase 1 task 1.4. The sweep ran on 2026-09-23, before the first npm publish of `@littleorgans/*`,
against `origin/main` at `2a91cdd`, then reviewed after rebasing onto `a66f0bd` (#103) and
`c0231c1` (#105). There are now 10 published packages after the removal of collections. No
credential values appear here.

## Verdict

The scans found no real secret in the surfaces listed below. This is a detector-based finding, not
proof that every credential format is covered. No rotation or history rewrite is recommended from
these results. No credentials were verified against a provider.

## Tools

| Tool       | Version | Source                                        |
| ---------- | ------- | --------------------------------------------- |
| gitleaks   | 8.30.1  | Homebrew formula `gitleaks`, user-local       |
| trufflehog | 3.97.6  | Homebrew formula `trufflehog`, user-local     |
| secretlint | 13.0.4  | The repository pin, with `.secretlintrc.json` |

Trufflehog ran with `--no-verification`, so no candidate value was sent to a provider.

The maintainer's global Git config sets `format.pretty`, `format.graph` and `log.abbrevcommit`.
Under it, gitleaks parses no commits (`0 commits scanned`) and reports findings without a commit.
Every history scan below therefore ran with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`.
Anyone repeating this with gitleaks should do the same and check the `commits scanned` line.

## Original coverage

| Surface                    | What                                                                                                                          | Commands                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Public history             | `git clone --mirror` of GitHub: `main`, `changeset-release/main`, 76 `refs/pull/*/head`, 1 `refs/pull/*/merge`. 231 commits   | `gitleaks git --log-opts="--all" --redact`; `trufflehog git file://… --no-verification`        |
| Local history              | Every local branch, remote-tracking ref and reflog. 223 commits                                                               | `gitleaks git --log-opts="--all --reflog" --redact`                                            |
| Unreachable commits        | 212 dangling commits from `git fsck --unreachable --no-reflogs`, pinned as refs in a scratch repo that borrows the objects    | `gitleaks git --log-opts="--all" --redact`                                                     |
| Every blob ever stored     | 1,249 unique blobs from both object stores (`git cat-file --batch-all-objects`), merge results and unreachable blobs included | `gitleaks dir --redact`; `trufflehog filesystem --no-verification`; `secretlint --maskSecrets` |
| Packed tarballs            | `pnpm pack` of the original package set before #105 after `moon run :build`, unpacked: 361 files                              | `secretlint --maskSecrets`; `gitleaks dir --redact`; `trufflehog filesystem --no-verification` |
| Shipped working-tree files | 46 tracked files: every `*.md`, `docs/`, `db/` (migrations), `.changeset/`, `.env.example`, the LICENSE files                 | the same three                                                                                 |
| GitHub text                | Bodies of 104 issues and pull requests, issue comments, review comments and reviews, read through `gh api`                    | the same three                                                                                 |

## Findings

Every finding is a fixture or a false positive.

| Commits                                                             | File                                                                        | Rule                                    | Classification | Reasoning                                                                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b6efcff` (main), `b3104c4` (PR 68)                                 | `apps/web/tests/config.test.ts:9`, `apps/web/tests/wiring.test.ts:32`       | gitleaks `generic-api-key`              | Fixture        | `WORKOS_COOKIE_PASSWORD`, 32 characters. Exact comparison confirms a deliberately synthetic test fixture. A test file, not in any tarball.                                            |
| `657a8af` (main), `b90e81c` (PR 69)                                 | `packages/auth-session/tests/services.test.ts:10`                           | gitleaks `generic-api-key`              | Fixture        | The same value.                                                                                                                                                                       |
| `588d4e7` (main), `b1895e7` (PR 70)                                 | `packages/auth-tanstack/tests/runtime.test.ts:13`                           | gitleaks `generic-api-key`              | Fixture        | The same value.                                                                                                                                                                       |
| `e139199` (main), `68ec43d` (PR 85)                                 | `.moon/templates/application/tests/wiring.test.ts.tera:32`                  | gitleaks `generic-api-key`              | Fixture        | The same value, in the generator template. The blob scan found it in 22 blobs in all, including an older `auth-wiring.test.ts`; every one is this value.                              |
| `7cfdb01` (main), `49d7eb8` (PR 64)                                 | `.env.example:50` (now `:55`)                                               | trufflehog `Postgres`                   | Fixture        | A `postgres` URL with user `user`, a placeholder password and host `host`. A placeholder in the example env file.                                                                     |
| `2729a45`, `1edabaf` (main), `01c1d36` (PR 93), `7719f49` (PR 94)   | `scripts/tests/projects.test.mjs:228`                                       | trufflehog `URI`                        | Fixture        | An `https` URL with user `user`, a placeholder password and host `example.test`, a reserved domain. A test input for credential stripping.                                            |
| `5c459c2` (main), `4782f1d` (PR 100)                                | `packages/auth-http/tests/authenticate.test.ts:339`                         | trufflehog `URI`                        | Fixture        | An `https` URL with user `svc`, a synthetic password and host `logs.internal`, inside a test that an error message holding credentials is not echoed.                                 |
| `22326c7` (main), `246a7ce` (PR 51); reported by the blob scan only | `.github/workflows/release.yml:34`, and `:30` in an unreachable local draft | trufflehog `Github` (filesystem mode)   | False positive | The `pnpm/action-setup` pin, 40 hex characters: the pinned action commit SHA, not a token.                                                                                            |
| none; an unreachable local blob, never pushed                       | a draft `packages/db/README.md:89`                                          | secretlint `database-connection-string` | False positive | A `postgres` URL with user `orders_api`, an angle-bracket password placeholder and host `db.example.com`, a reserved domain, in a README draft. The blob is not in the GitHub mirror. |

The original tarball and GitHub-text scans produced no findings. Secretlint and gitleaks found none
in the shipped working-tree selection; trufflehog reported the `.env.example` placeholder covered
above.

## Rotation and history

Nothing to rotate. No history rewrite is recommended.

## Prevention

- **Diff scanning: no gitleaks gate added.** `root:secrets` already runs secretlint over the whole
  working tree in every CI run (`runInCI: "always"`), and in the pre-commit hook on every commit
  where the hooks are installed, but local hooks can be skipped and CI only sees the checked-out
  tree. GitHub secret scanning and push protection are enabled (reconfirmed through the API), while
  non-provider patterns and validity checks are disabled. This is not equivalent to scanning every
  intermediate commit with gitleaks: provider coverage and push-protection bypasses still leave
  gaps. A gitleaks gate would add a non-npm binary pin, or `gitleaks-action`, which needs a license
  for organization repositories. Across the full history its only extra hit was the generic rule on
  a known fixture.
- **Tarball scanning: added `root:packed-secrets`.** Both `.gitignore` and `.secretlintignore`
  exclude `dist`, so no gate saw the files npm mostly receives, and a build can inline a value the
  sources never held. `scripts/check-packed-secrets.mjs` packs every published package with
  `pnpm pack`, unpacks each tarball and runs secretlint over the result with no ignore files. The
  task depends on `#ts-library:build` and runs in CI when sources change. `changeset:publish` runs
  it between the build and `changeset publish`. `scripts/tests/packed-secrets.test.mjs` proves it
  passes a clean tarball, fails one whose `dist` holds a token assembled at runtime, fails closed on
  a failed pack or an empty package set, and removes its temporary directory each time. It also
  rejects `prepack`, `prepare`, `prepublishOnly` and `postpack` in every published package until
  task 1.8 publishes the scanned archives.

## Reviewer reproduction

- Rebased onto `a66f0bd` without conflicts. Gitleaks 8.30.1 with global/system Git config disabled
  scanned 237 local/reflog commits and reported 7 findings, exactly matching the original local
  finding tuples (commit, path, line, rule). The public mirror scan processed 219 commits and
  reproduced all 10 tuples in the corrected `gl-public.json`. The original `gl-mirror.json` is the
  broken-config run and has empty commit fields. The mirror holds 231 reachable commits; scanner
  processed counts differ from graph counts.
- Repeated the pinned unreachable-history scan: the same 10 generic-key findings. Compared the
  cookie values directly in their historical files without printing them. Also inspected the
  11-character WorkOS-shaped string in an unreachable `auth-http` config test: it is an invalid
  client-ID input, not a plausible complete provider key. Its provider-like prefix alone would not
  justify calling a full-length credential a fixture.
- Repacked the pre-removal package set after the migration rebase with Moon's pinned tools: 366
  extracted files, zero gitleaks or secretlint hits. The earlier 361-file count belongs to the
  builder's saved artifacts; a shell-toolchain pack produced only 314 files, so it is not the
  release comparison. The db tarball now includes the shipped migrations.
- The packed gate took 6.1 seconds (7.0 seconds wall time including Moon and a db rebuild; ten
  dependency builds were cached). Packing all packages is the main additional cost.
- The gate rejects a synthetic token in ignored `dist`, ignores nested `.gitignore`, masks findings,
  fails on a failed pack or an empty package set, and removes its temporary directory on normal
  success and exceptions. Process termination such as SIGKILL can still leave a temp directory. Pack
  and extraction subprocess output is suppressed because it may contain secrets.
- The original three focused tests passed. The ignored dist fixture explicitly lists its files
  because pinned pnpm otherwise omits them during packing. Mutation checks detected omitted cleanup, disabled
  masking, forwarded pack stderr, a successful empty-package exit, skipped dist scanning and
  respected nested ignore files. Mutations were restored before verification.
- `changeset:publish` waits for the Moon build and packed scan, then uses `&&` to prevent
  publication on failure. The release workflow calls this command when publishing is enabled.
  Changesets subsequently packs again: the inspected archives are not the exact uploaded bytes.
  The lifecycle-script guard prevents the four packaging hooks from changing contents between
  these steps. It is an interim guard, not proof of identical archives; task 1.8 will address
  publishing the scanned archives.
- Downloaded and scanned 12 recent completed Release/failed-CI runs out of 296 listed runs, with
  gitleaks and secretlint: zero findings. This is a sample, not full log coverage.

## Round 3 after #105

- Rebased onto `c0231c1` without conflicts using Moon 2.5.5. The current set is 10 published
  packages. Repacking with pinned pnpm and Node produced 349 extracted files; gitleaks and
  secretlint both reported zero findings. `root:packed-secrets` passed in 4.4 seconds, with ten
  dependency builds cached.
- All four focused tests passed. The new lifecycle guard was mutation-checked by adding each
  forbidden hook independently to a published manifest. Each command below exited 1 with
  `publish the scanned archives (task 1.8) before adding packaging lifecycle scripts`. All mutations
  were restored.

  ```sh
  node --test --test-name-pattern="published packages have no lifecycle" \
    scripts/tests/packed-secrets.test.mjs
  ```

## Not scanned

- Remaining GitHub Actions logs and caches. The builder found no artifacts. Before the first public
  publish, scanning all retained downloadable logs is worthwhile: masking only registered secrets
  does not protect arbitrary credentials printed by commands. Never echo raw logs during that
  review. Deleted/expired logs cannot be assessed.
- Commits GitHub still serves by SHA after a force push or branch deletion, unless they survive in
  the local object store. The deleted `origin/feat/*` branches were pull request heads, which the
  mirror holds. The `changeset-release/main` tip from before its last force push (`c919af2`)
  survives only locally, and the local scans cover it. GitHub offers no way to list the others.
- Forks, and the repository wiki. The wiki is enabled but has never been created.
- The npm registry: the original sweep received 404 from `npm view` for every package then in
  scope. Registry checks were not repeated in round 3.
- Scans for live keys: trufflehog ran without verification, so no candidate was tested against a
  provider.
