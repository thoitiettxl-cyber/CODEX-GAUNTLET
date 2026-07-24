---
name: mutation-audit
description: Audit mutation testing requirements
---

# Mutation audit

Run only when explicitly invoked. Determine whether the changed behavior is security-critical or otherwise requires mutation evidence. Execute the configured mutation command through `./qa/verify`; do not lower thresholds, exclude surviving mutants without justification, or treat metadata as evidence.
