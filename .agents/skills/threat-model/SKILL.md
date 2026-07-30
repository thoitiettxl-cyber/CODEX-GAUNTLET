---
name: threat-model
description: Build or refresh the repository threat model
---

# Threat model

Run only when explicitly invoked. Inspect repository-wide assets, trust boundaries, attacker-controlled inputs, invariants, assumptions, and existing `AGENTS.md` or `SECURITY.md` guidance. Refresh `security/threat-model.md` through `gauntlet.security.threat_model.build_threat_model`; do not invent product guarantees.

After the artifact is reviewed, run the fast security path and `./qa/verify`. A stale model must block security-sensitive completion.
