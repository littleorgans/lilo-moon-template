---
"@littleorgans/auth-session": patch
---

Accept a JSON array in `WORKOS_COOKIE_PASSWORD_PREVIOUS` to preserve legacy passwords containing
commas, surrounding whitespace, or a leading bracket. Comma-separated lists remain supported.
JSON parsing errors never include password material. Clarify rotation retention bounds, deployment
draining, and preserving outstanding keys during overlapping rotations.
