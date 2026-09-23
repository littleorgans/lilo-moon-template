---
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
---

The email sign-in handlers refuse cross-origin POSTs and ask a throttle before calling the provider.
`startEmailSignIn` and `completeEmailSignIn` answer 403 unless the request's `Origin` equals the
application's own, exactly as sign-out always has, so a page on another site can no longer make a
visitor's browser send codes. Their deps gain `origin` and a required `throttle`, which is asked
about the client and the lower-cased address before each provider call; a refusal is a 429 with
`Retry-After`.

`createAuthRuntime` requires a `throttle` option. The packages ship no rate limiter, because one
kept in a single process's memory is wrong for any deployment with more than one instance: back it
with a shared store, or pass one that always allows when something in front of the application
already limits these routes. The runtime also gains `origin()`, and `refuseCrossOrigin` is exported
for an application's own POST routes.
