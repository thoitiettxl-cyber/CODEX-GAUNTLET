---
name: validate-finding
description: Validate a security candidate with bounded evidence
---

# Validate finding

Run only when explicitly invoked. Prefer a focused local reproduction or test. Keep execution bounded and offline. Every candidate must receive one disposition: `reportable`, `suppressed`, `not_applicable`, or `deferred`.

When build/runtime evidence is unavailable, use `static_only` with a concrete `proofGap`; never claim reproduction without evidence.
