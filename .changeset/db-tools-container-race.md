---
"@littleorgans/db-tools": patch
---

Fix the checkout's Postgres container failing to start when several tasks start it at once, as the
database checks of one `moon ci` do on a fresh checkout. A task that lost the race for the
container's name could inspect before the winner's container existed and fail with "does not match
the requested image and loopback port"; it now waits for that container.
