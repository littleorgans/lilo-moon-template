---
"@littleorgans/auth": patch
---

Classify malformed provider key sets and corrupt public key material as authentication
unavailability rather than a bad client token. Propagate unknown runtime failures so the
application can log them and return a server error.
