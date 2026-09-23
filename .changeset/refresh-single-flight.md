---
"@littleorgans/auth-session": patch
---

Concurrent requests that refresh one expired session now share a single provider call. WorkOS
rotates the refresh token on every use, so parallel loaders each spending the same token could see
one of them refused with `invalid_grant` and clear the cookie the others had just renewed. The call
is shared in process memory, keyed by a SHA-256 digest of the refresh token and removed when it
settles; each request still verifies the result and writes its own cookie. Separate instances rely
on WorkOS's 30-second reuse window.
