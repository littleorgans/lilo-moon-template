---
"@littleorgans/web": patch
---

The reference app no longer carries the demo product. The signed-in page drops the task board and
the full `Principal` JSON, and shows the session's user and organization beside the rows the scoped
transaction can see. The document and sign-in titles read "Workspace" instead of "Task board".

`@littleorgans/collections` is removed rather than published. It was an example whose only caller
was the task board, and it leaves the fixed version group before the first release.
