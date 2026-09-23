---
"@littleorgans/auth-session": minor
"@littleorgans/auth-tanstack": minor
---

`serviceOrigins` accepts `{ origin: "http://api:3000", insecure: true }` next to plain strings, so
a web app can call a service over plain http inside a cluster. The opt-in is per origin: it covers
that exact scheme, host and port, and there is no setting that allows http everywhere. `insecure`
must be `true`, and an insecure entry must be `http`. String entries keep the old rule (HTTPS except
on localhost), and the error for a refused http origin now names the object form.
`InsecureServiceOrigin` and `ServiceOrigin` are exported from both packages.
