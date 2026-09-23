# Security policy

## Report a vulnerability

Report vulnerabilities privately through GitHub:
[Report a vulnerability](https://github.com/littleorgans/lilo-moon-template/security/advisories/new)
on this repository's **Security** tab. Do not open a public issue, pull request or discussion for
it.

Include the package and version, what an attacker can do, and the steps or code that show it. The
maintainers reply in the advisory, agree a fix and a disclosure date with you, and credit you in the
published advisory unless you ask them not to.

## Scope

- The `@littleorgans/*` packages published to npm from `packages/`.
- The reference application in `apps/web` and the reference service in `services/api`, where a
  flaw would carry into a project that follows them.
- The release workflow and what it publishes: `.github/workflows/release.yml`, `scripts/release.mjs`.

## Supported versions

Fixes land in the latest release. During `0.x`, every package shares one version and only the
newest minor line receives fixes.

## Verifying a release

Every version is published from `.github/workflows/release.yml` with npm provenance. `npm audit
signatures` in a project that installs the packages checks the registry signatures and the
provenance attestations.
