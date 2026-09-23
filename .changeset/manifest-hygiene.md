---
"@littleorgans/db": minor
"@littleorgans/ui": minor
"@littleorgans/views": minor
"@littleorgans/auth-tanstack": minor
"@littleorgans/vite-config": minor
---

Consumers now own the versions of shared runtime libraries. `@littleorgans/db` takes `drizzle-orm`
(`^0.45.0`) and `pg` (`^8.15.0`) as peer dependencies instead of exact dependencies, so an
application on another 0.45 release shares one Drizzle copy with the package rather than failing
to typecheck against a nested second copy. `@littleorgans/ui` takes `tailwindcss` (`^4.0.0`) as a
peer. Install these alongside the packages.

Open-ended peer ranges become caret ranges on the supported major: React `^19.0.0`,
`@tanstack/react-start` `^1.168.0` and Vite `^8.0.0`. All published packages now release together
at one version.
