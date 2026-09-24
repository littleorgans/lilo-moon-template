---
"@littleorgans/create-app": minor
---

Add `@littleorgans/create-app`, so `pnpm create @littleorgans/app` (or `npm create`) starts a
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
