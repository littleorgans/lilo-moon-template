# Secrets sweep, September 2026

Phase 1 task 1.4. The sweep ran on 2026-09-23, before the first npm publish of `@littleorgans/*`,
against `origin/main` at `2a91cdd`. No values appear here. A redacted value shows its type, its
location and at most its first four characters.

## Verdict

No real secret was found in any public ref, any local ref, reflog or unreachable object, any
packed tarball, the shipped docs, or the GitHub issue and pull request text. Nothing needs rotating
and nothing needs a history rewrite.

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

## Coverage

| Surface                    | What                                                                                                                          | Commands                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Public history             | `git clone --mirror` of GitHub: `main`, `changeset-release/main`, 76 `refs/pull/*/head`, 1 `refs/pull/*/merge`. 231 commits   | `gitleaks git --log-opts="--all" --redact`; `trufflehog git file://… --no-verification`        |
| Local history              | Every local branch, remote-tracking ref and reflog. 223 commits                                                               | `gitleaks git --log-opts="--all --reflog" --redact`                                            |
| Unreachable commits        | 212 dangling commits from `git fsck --unreachable --no-reflogs`, pinned as refs in a scratch repo that borrows the objects    | `gitleaks git --log-opts="--all" --redact`                                                     |
| Every blob ever stored     | 1,249 unique blobs from both object stores (`git cat-file --batch-all-objects`), merge results and unreachable blobs included | `gitleaks dir --redact`; `trufflehog filesystem --no-verification`; `secretlint --maskSecrets` |
| Packed tarballs            | `pnpm pack` of all 11 published packages after `moon run :build`, unpacked: 361 files                                         | `secretlint --maskSecrets`; `gitleaks dir --redact`; `trufflehog filesystem --no-verification` |
| Shipped working-tree files | 46 tracked files: every `*.md`, `docs/`, `db/` (migrations), `.changeset/`, `.env.example`, the LICENSE files                 | the same three                                                                                 |
| GitHub text                | Bodies of 104 issues and pull requests, issue comments, review comments and reviews, read through `gh api`                    | the same three                                                                                 |

## Findings

Every finding is a fixture or a false positive.

| Commits                                                             | File                                                                        | Rule                                    | Classification | Reasoning                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b6efcff` (main), `b3104c4` (PR 68)                                 | `apps/web/tests/config.test.ts:9`, `apps/web/tests/wiring.test.ts:32`       | gitleaks `generic-api-key`              | Fixture        | `WORKOS_COOKIE_PASSWORD`, value `0123…`, 32 characters. Checked by exact comparison: it is the 16-character hex alphabet written twice, to meet the 32-character minimum. A test file, not in any tarball. |
| `657a8af` (main), `b90e81c` (PR 69)                                 | `packages/auth-session/tests/services.test.ts:10`                           | gitleaks `generic-api-key`              | Fixture        | The same value.                                                                                                                                                                                            |
| `588d4e7` (main), `b1895e7` (PR 70)                                 | `packages/auth-tanstack/tests/runtime.test.ts:13`                           | gitleaks `generic-api-key`              | Fixture        | The same value.                                                                                                                                                                                            |
| `e139199` (main), `68ec43d` (PR 85)                                 | `.moon/templates/application/tests/wiring.test.ts.tera:32`                  | gitleaks `generic-api-key`              | Fixture        | The same value, in the generator template. The blob scan found it in 22 blobs in all, including an older `auth-wiring.test.ts`; every one is this value.                                                   |
| `7cfdb01` (main), `49d7eb8` (PR 64)                                 | `.env.example:50` (now `:55`)                                               | trufflehog `Postgres`                   | Fixture        | A `postgres` URL with user `user`, password `pass…` (8 lowercase letters) and host `host`. A placeholder in the example env file.                                                                          |
| `2729a45`, `1edabaf` (main), `01c1d36` (PR 93), `7719f49` (PR 94)   | `scripts/tests/projects.test.mjs:228`                                       | trufflehog `URI`                        | Fixture        | An `https` URL with user `user`, password `pass…` and host `example.test`, a reserved domain. A test input for credential stripping.                                                                       |
| `5c459c2` (main), `4782f1d` (PR 100)                                | `packages/auth-http/tests/authenticate.test.ts:339`                         | trufflehog `URI`                        | Fixture        | An `https` URL with user `svc`, password `secr…` and host `logs.internal`, inside a test that an error message holding credentials is not echoed.                                                          |
| `22326c7` (main), `246a7ce` (PR 51); reported by the blob scan only | `.github/workflows/release.yml:34`, and `:30` in an unreachable local draft | trufflehog `Github` (filesystem mode)   | False positive | `pnpm/action-setup@0977…`, 40 hex characters: the pinned action commit SHA, not a token.                                                                                                                   |
| none; an unreachable local blob, never pushed                       | a draft `packages/db/README.md:89`                                          | secretlint `database-connection-string` | False positive | A `postgres` URL with user `orders_api`, password `<pas…` and host `db.example.com`: a literal angle-bracket placeholder in a README draft, on a reserved domain. The blob is not in the GitHub mirror.    |

The tarballs, the shipped working-tree files and the GitHub text produced no findings from any of
the three tools. Apart from `.env.example`, whose placeholder is covered above, the working tree is
clean.

## Rotation and history

Nothing to rotate. No history rewrite is recommended.

## Prevention

- **Diff scanning: no gitleaks gate added.** `root:secrets` already runs secretlint over the whole
  working tree in every CI run (`runInCI: "always"`), and in the pre-commit hook on every commit
  where the hooks are installed, so intermediate commits are covered as well as the pull request
  tip. GitHub secret scanning and push protection are both enabled on the repository, so GitHub
  rejects a push that carries a supported provider's key. A gitleaks gate would add a non-npm binary
  pin, or `gitleaks-action`, which needs a license for organization repositories. Across the full
  history its only extra hit was the generic rule on a known fixture.
- **Tarball scanning: added `root:packed-secrets`.** Both `.gitignore` and `.secretlintignore`
  exclude `dist`, so no gate saw the files npm mostly receives, and a build can inline a value the
  sources never held. `scripts/check-packed-secrets.mjs` packs every published package with
  `pnpm pack`, unpacks each tarball and runs secretlint over the result with no ignore files. The
  task depends on `#ts-library:build` and runs in CI when sources change. `changeset:publish` runs it
  between the build and `changeset publish`. `scripts/tests/packed-secrets.test.mjs` proves it
  passes a clean tarball and fails one whose `dist` holds a token assembled at runtime.

## Not scanned

- GitHub Actions run logs (292 runs) and caches. There are no artifacts. GitHub masks registered
  secrets in logs.
- Commits GitHub still serves by SHA after a force push or branch deletion, unless they survive in
  the local object store. The deleted `origin/feat/*` branches were pull request heads, which the
  mirror holds. The `changeset-release/main` tip from before its last force push (`c919af2`)
  survives only locally, and the local scans cover it. GitHub offers no way to list the others.
- Forks, and the repository wiki. The wiki is enabled but has never been created.
- The npm registry: no `@littleorgans/*` package is published yet (`npm view` returns 404 for all
  11).
- Scans for live keys: trufflehog ran without verification, so no candidate was tested against a
  provider.
