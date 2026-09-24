---
name: publish-package
description: For maintainers of littleorgans/lilo-moon-template. Change and release the published @littleorgans packages, deciding whether a change needs a changeset, choosing the bump under one fixed version, writing action-required notes, setting peer ranges and exports, adding a package, and running or recovering a release and the skills sync that follows. Use when a change touches a published package, when preparing or recovering a release, or when adding a package to the fixed group.
---

# Publish a package

Every published `@littleorgans/*` package shares one version and releases from one commit on
`main`. The pipeline decides almost nothing on its own: it refuses what it can check and publishes
what was merged. The judgment is in the pull request. This skill is for maintainers of
`littleorgans/lilo-moon-template`; a project that uses the packages never publishes them.

- `docs/releasing.md`: the flow, authentication, bootstrap, adding a package, recovery and the
  skills sync. Follow it for every step; this skill does not repeat them.
- `docs/decisions.md`, "Publishing waits for the whole gate on the released commit" and
  "JavaScript library exports": why the pipeline and the export shape look this way.
- `.changeset/config.json`: the `fixed` group.

## Does it need a changeset?

A change to a published package's code, types, exports, peers or packed files needs one. A change
only to `apps/web`, `services/api`, tests, docs or scripts does not. Those are private and never
versioned, and naming one in a changeset breaks the release. Nothing checks that a changeset is
present: that is review's job. Look at the diff under `packages/*`, not at the pull request
title.

## Choosing the bump

The `fixed` group bumps every package to the same version, so choose for the most serious change in
the release. During `0.x` a breaking change is a **minor**, and everything else is a patch.
Breaking includes a removed or renamed export, a narrower accepted input, a raised peer floor or a
new required peer, a changed default, and a new required option. The consumer's exhaustive
`switch` over a union counts: adding an access state or a failure reason breaks their typecheck.

## Write for the person upgrading

The changeset body is the changelog entry. Say what changed and what it means for a project. When a
project must change its own glue, the files under `src/server/` that create-app wrote once and
nothing updates, start a paragraph with "Action required", name the file and the edit, and make the
same edit to the reference in the same pull request, so the next generated project has it.

## Peers and exports

- Anything the consumer must share one copy of is a peer: `drizzle-orm`, `pg` and `@types/pg` for
  `db`; `react` and `react-dom` for `ui` and `views`, and `tailwindcss` for `ui`;
  `@littleorgans/auth` for `auth-http`, which recognizes `AuthError` by class. An adapter's
  framework is an optional peer, as `hono` is.
- Peer ranges are caret ranges from a named `*-peer` catalog in `pnpm-workspace.yaml`.
  `root:published-shape` checks `db`'s caret peer ranges, tests its peer floors, and compares
  `publishConfig.exports` to `exports` with `@littleorgans/source` removed. Use that gate when
  changing peers or exports; a floor you cannot install and test is a floor you cannot claim.

## A new package

It joins the `fixed` group, ships the root `LICENSE`, and needs the token bootstrap once more,
because npm attaches a trusted publisher only to a package that exists. `docs/releasing.md`, "Add a
new package later", has the order.

## Releasing and after

Merging the Version Packages pull request releases, and only while `NPM_PUBLISH_ENABLED` is `true`.
A published version cannot be replaced: fix forward with a patch rather than unpublishing. There is
no deprecation policy yet; propose one before the first deprecation. After a release, sync the
skills to the agent-runtimes catalog as `docs/releasing.md` describes, so what agents read matches
what people install.

## Gates

- `root:scripts-test` fails a published package outside the `fixed` group, a changeset naming a
  private package, and a package without the root `LICENSE`.
- `root:published-shape` runs `publint` and `attw` on each tarball, checks the exports, installs
  the tarballs into fresh consumers and generated projects, and typechecks against TypeScript 5.
- `root:packed-secrets` scans each tarball, and `root:release-rehearsal` publishes against a local
  registry.
- The release gate runs `moon ci --force` on the release commit, publishes the scanned bytes, and a
  smoke job installs the published versions from npm.
