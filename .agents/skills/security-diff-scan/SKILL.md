---
name: security-diff-scan
description: Review a diff with repository security context
---

# Security diff scan

Run only when explicitly invoked or when the canonical change classifier marks a change security-sensitive. Normalize the requested diff through `gauntlet.security.targets`, reuse the repository threat model, discover candidates, and preserve proof gaps. Do not invoke an external scanner, enable network, or create a second pass/fail command.

All reportability and merge decisions remain with `./qa/verify` and `qa/security/gates.py`.
