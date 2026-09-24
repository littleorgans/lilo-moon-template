---
"@littleorgans/create-app": patch
---

Validate npm's full scoped-package name length independently of the database login-role limit.
Long legitimate project names remain accepted, while names npm cannot install are refused even
when the project has no database.
