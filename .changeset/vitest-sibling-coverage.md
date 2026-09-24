---
"@littleorgans/vite-config": patch
---

`testDefaults` leaves a sibling project whose directory name extends the current one (such as
`packages/db-tools` next to `packages/db`) out of coverage. Vitest treated its files as inside the
project because their paths start with the project root.
