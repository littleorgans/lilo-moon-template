# AGENTS.md

This project is built on the `@littleorgans/*` packages. Moon owns the task graph and pnpm owns
the packages. `moon ci` is read only and is what CI runs. `just check` repairs formatting and lint.

- Starting or extending the project: the `lilo/build/start-project` skill.
- The glue in `apps/*/src/server/` and `services/*/src/server/` came from the reference app in
  https://github.com/littleorgans/lilo-moon-template, through `@littleorgans/create-app`, at the
  tag matching the installed `@littleorgans/*` version. Compare against that tag, not `main`.
- Fixes reach this project through package upgrades, not by copying the glue again. When you
  upgrade, read each package's changelog for "action required" notes.
