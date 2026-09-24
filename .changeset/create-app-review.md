---
"@littleorgans/create-app": patch
---

Harden generated projects: leave the cookie secret empty, quote target paths in printed shell
commands, bound names to prevent truncated login roles, and preflight bundle paths. Fail generation
for deleted rewrite targets, symlinks, binary data and tracked environment values instead of silently
shipping unsafe or incomplete output.
