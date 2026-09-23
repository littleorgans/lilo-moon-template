---
"@littleorgans/auth": minor
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
"@littleorgans/auth-workos": minor
"@littleorgans/db": minor
"@littleorgans/theme": minor
"@littleorgans/ui": minor
"@littleorgans/views": minor
"@littleorgans/vite-config": minor
---

Publish under the `@littleorgans` npm scope instead of `@lilo-moon`. Imports and the workspace
source export condition move from `@lilo-moon/*` and `@lilo-moon/source` to `@littleorgans/*` and
`@littleorgans/source`. Every package now ships an MIT `LICENSE`. Nothing was published under the
old scope, so no deprecation is needed.
