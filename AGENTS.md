# Agent entry map

The repository is the system of record. Load the smallest authoritative context needed.

Read in this order when relevant:

1. `docs/WORKFLOW.md` — canonical request and execution workflow.
2. `docs/product/` — current product contracts and constraints.
3. `docs/ARCHITECTURE.md` — boundaries and dependency direction.
4. `docs/decisions/` — durable architectural decisions.
5. `scripts/termux-control orchestrator status` — lifecycle and work graph for complex changes.
6. `docs/quality/CODEX-GAUNTLET.md` — Codex execution and enforcement contract.
7. `./qa/verify` — the single verification authority.

Invariants:

- Questions, explanations, diagnoses, plans, and status requests are read-only;
  mutate only when the requested outcome authorizes it.
- Do not claim completion until mandatory verification passes.
- Bounded single-session work needs neither a story nor a durable plan.
- For multi-session, coordination-heavy, or recovery-sensitive work, use one Harness story linked to one file under `docs/plans/active/`.
- Use a stable `HARNESS_RUN_ID` for every Harness state-writing run so semantic changesets remain replayable.
- Stop before mutation when consequential ambiguity requires human authority.
- Review the final diff.
- Never treat Harness metadata, hook output, or an agent statement as application test evidence.
- Harness lifecycle state controls orchestration; Git plans preserve intent and recovery; only executable verification proves completion.
