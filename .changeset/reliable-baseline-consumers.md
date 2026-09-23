---
"@littleorgans/auth": minor
"@littleorgans/auth-session": minor
"@littleorgans/auth-workos": minor
"@littleorgans/auth-tanstack": minor
"@littleorgans/db": minor
"@littleorgans/theme": minor
"@littleorgans/ui": minor
"@littleorgans/views": minor
"@littleorgans/vite-config": minor
---

Prepare the baseline libraries for independent consumers. Require expiring access tokens, preserve
sessions during provider outages, namespace application cookies, and use POST signout with the
provider logout redirect. Organization provisioning is an explicit application policy, and database
scoping no longer inserts application rows.

Keep TanStack server route boundaries visible to the compiler. The route option factories are
replaced by literal server configuration and a shared postHandlers helper. Browser builds now reject
server dependencies. Vite configuration takes the consuming workspace root and publishes compiled
exports. CSS source registration works from installed libraries, themes accept application names,
and heading size can be chosen independently of document level.

These changes intentionally revise the initial APIs before the first external release.
