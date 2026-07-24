# Agent entry map

The repository is the system of record. Load the smallest authoritative context needed.

Read in this order when relevant:

1. `docs/WORKFLOW.md` — canonical request and execution workflow.
2. `docs/product/` — current product contracts and constraints.
3. `docs/ARCHITECTURE.md` — boundaries and dependency direction.
4. `docs/decisions/` — durable architectural decisions.
5. `docs/quality/CODEX-GAUNTLET.md` — Codex execution and enforcement contract.
6. `./qa/verify` — the single verification authority.

Invariants:

- Questions, explanations, diagnoses, plans, and status requests are read-only;
  mutate only when the requested outcome authorizes it.
- Do not claim completion until mandatory verification passes.
- Use `docs/plans/active/` only for multi-session, coordination-heavy, or recovery-sensitive work.
- Stop before mutation when consequential ambiguity requires human authority.
- Review the final diff.
- Never treat Harness metadata, hook output, or an agent statement as application test evidence.
- SQLite intake, story, trace, scoring, audit, and proposal commands are
  optional compatibility features; use them only when explicitly selected.
