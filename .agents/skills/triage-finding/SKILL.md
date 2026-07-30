---
name: triage-finding
description: Record human-approved security triage
---

# Triage finding

Run only after a human explicitly chooses the action. Record `findingId`, action, non-empty reason, exact human `approvedBy`, approval time, and optional expiry. Codex may explain evidence and draft the record but may not approve its own waiver.

Triage records are append-only. Expired waivers cease to suppress findings automatically.
