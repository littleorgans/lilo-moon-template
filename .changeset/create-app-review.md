---
"@littleorgans/create-app": patch
---

Harden generated projects: leave the cookie secret empty, quote target paths in printed shell
commands and SQL role identifiers, refuse invalid terminal answers, bound names to prevent truncated login roles, and preflight bundle paths. Fail generation
for deleted rewrite targets, ambiguous environment paragraphs, symlinks, binary data and tracked environment values instead of silently
shipping unsafe or incomplete output.
