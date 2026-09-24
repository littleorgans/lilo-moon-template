# @littleorgans/create-app

## 0.2.0

### Minor Changes

- [#123](https://github.com/littleorgans/lilo-moon-template/pull/123) [`1573e1d`](https://github.com/littleorgans/lilo-moon-template/commit/1573e1d6b0b14fc8fa0162e097992ba2279a4faa) Thanks [@srobinson](https://github.com/srobinson)! - Add `@littleorgans/create-app`, so `pnpm create @littleorgans/app` (or `npm create`) starts a
  project on the published packages: a Moon workspace with a TanStack Start web app (`--web`), a
  TypeScript service (`--service`), or both, and optionally Postgres (`--db`) with the identity
  migrations, the Atlas schema, the RLS seed and the database gates. Every choice is a flag:
  `--organization-policy` is required with a web app, names and ports default to the reference's and
  the command says when it took one. At a terminal it asks for what has no default. It writes only
  into a new or empty directory, then prints the remaining steps: the first commit and install, the
  OAuth callback to register, the environment, the database login role and its grant, and the first
  `moon ci --force`.

  The template is generated at build time from the reference app, the reference service, `db/` and
  the workspace root of the release commit, and pins every `@littleorgans/*` package and the
  reusable `moon-ci.yml` workflow at that release. A reference change the generator does not
  recognize fails the build, and `root:published-shape` requires every kind of project it writes to
  pass its own `moon ci` from the packed tarballs before a release.

### Patch Changes

- [#123](https://github.com/littleorgans/lilo-moon-template/pull/123) [`1573e1d`](https://github.com/littleorgans/lilo-moon-template/commit/1573e1d6b0b14fc8fa0162e097992ba2279a4faa) Thanks [@srobinson](https://github.com/srobinson)! - Validate npm's full scoped-package name length independently of the database login-role limit.
  Long legitimate project names remain accepted, while names npm cannot install are refused even
  when the project has no database.

- [#123](https://github.com/littleorgans/lilo-moon-template/pull/123) [`1573e1d`](https://github.com/littleorgans/lilo-moon-template/commit/1573e1d6b0b14fc8fa0162e097992ba2279a4faa) Thanks [@srobinson](https://github.com/srobinson)! - Clarify that bypassing the wait for a fresh release requires reviewing and approving its exact
  package versions, then removing those temporary approvals when the versions mature.

- [#123](https://github.com/littleorgans/lilo-moon-template/pull/123) [`1573e1d`](https://github.com/littleorgans/lilo-moon-template/commit/1573e1d6b0b14fc8fa0162e097992ba2279a4faa) Thanks [@srobinson](https://github.com/srobinson)! - The printed install step says that pnpm installs a version only once it is a day old, names the
  error a fresh project meets on release day, and says how to exempt those exact versions. Generated
  projects keep the wait for `@littleorgans/*`.

- [#123](https://github.com/littleorgans/lilo-moon-template/pull/123) [`1573e1d`](https://github.com/littleorgans/lilo-moon-template/commit/1573e1d6b0b14fc8fa0162e097992ba2279a4faa) Thanks [@srobinson](https://github.com/srobinson)! - Harden generated projects: leave the cookie secret empty, quote target paths in printed shell
  commands and SQL role identifiers, refuse invalid terminal answers, refuse names whose login roles
  Postgres would truncate or reserve (`pg_`), and preflight bundle paths. Fail generation for deleted
  rewrite targets, ambiguous environment paragraphs, symlinks, binary data and tracked environment
  values instead of silently shipping unsafe or incomplete output.
