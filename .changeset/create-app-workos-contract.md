---
"@littleorgans/create-app": patch
---

`create-app` classifies this repository's new `workos-contract.yml` workflow as the template's own,
so a generated project gets no copy of it and needs no WorkOS secrets in CI. Generated projects are
unchanged.
