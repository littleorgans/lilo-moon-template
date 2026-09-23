---
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
---

Add a way for server code to call a service as the signed-in person. `readUserAccess` in
`@littleorgans/auth-session`, exposed as `asUser()` on the `@littleorgans/auth-tanstack` runtime,
returns the same five states as `Access`. The signed-in state carries a `fetch` that sets
`Authorization: Bearer` with the person's access token, refreshed through the existing shared
refresh when it has expired. There is no accessor for the raw token: it lives only in that
function's closure, so it cannot be returned from a loader, serialised or logged by accident.

`fetch` sends only to origins listed in the new `serviceOrigins` runtime option (HTTPS except on
localhost, origin only, empty by default) and rejects anything else before a request is made.
`anonymous`, `ended`, `broken` and `unavailable` carry no `fetch` and are never thrown.
