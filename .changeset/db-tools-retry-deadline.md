---
"@littleorgans/db-tools": patch
---

Bound Docker inspection during container creation races by the remaining retry deadline, so a
stalled inspect cannot extend the fifteen-second retry window by another two minutes.
