---
"@littleorgans/auth": patch
"@littleorgans/auth-http": patch
"@littleorgans/auth-session": patch
"@littleorgans/auth-tanstack": patch
"@littleorgans/auth-workos": patch
"@littleorgans/db": patch
"@littleorgans/db-tools": patch
"@littleorgans/theme": patch
"@littleorgans/ui": patch
"@littleorgans/views": patch
---

Published `exports` no longer carry the workspace-only `@littleorgans/source` condition. With it,
an application running `vite dev` through `@littleorgans/vite-config` resolved these installed
packages to their TypeScript `src` instead of the compiled `dist`, and Node refuses to strip types
inside `node_modules`. Every entry point now resolves to `dist` under every condition.
