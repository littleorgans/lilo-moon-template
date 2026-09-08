---
"@lilo-moon/auth": minor
"@lilo-moon/auth-session": minor
"@lilo-moon/auth-workos": minor
"@lilo-moon/auth-tanstack": minor
"@lilo-moon/db": minor
"@lilo-moon/theme": minor
"@lilo-moon/ui": minor
"@lilo-moon/views": minor
"@lilo-moon/vite-config": minor
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
