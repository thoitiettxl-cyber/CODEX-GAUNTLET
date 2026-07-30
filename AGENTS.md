# Agent entry map

The repository is the system of record. Load the smallest authoritative context needed.

Read in this order when relevant:

1. `docs/WORKFLOW.md` — canonical request and execution workflow.
2. `docs/product/` — current product contracts and constraints.
3. `scripts/termux-control orchestrator query tools --json` plus
   `docs/inventory/` — optional user-global/helper capabilities, only when relevant.
4. `docs/ARCHITECTURE.md` — boundaries and dependency direction.
5. `docs/decisions/` — durable architectural decisions.
6. `scripts/termux-control orchestrator status` — lifecycle and work graph for complex changes.
7. `docs/quality/CODEX-GAUNTLET.md` — Codex execution and enforcement contract.
8. `docs/quality/SECURITY-GATE.md` and `security/threat-model.md` — security
   evidence and meaningful freshness contracts, only when relevant.
9. `./qa/verify` — the single verification authority.

Invariants:

- Questions, explanations, diagnoses, plans, and status requests are read-only;
  mutate only when the requested outcome authorizes it.
- Do not claim completion until mandatory verification passes.
- Bounded single-session work needs neither a story nor a durable plan.
- For multi-session, coordination-heavy, or recovery-sensitive work, use one Harness story linked to one file under `docs/plans/active/`.
- Use a stable `HARNESS_RUN_ID` for every Harness state-writing run so semantic changesets remain replayable.
- Stop before mutation when consequential ambiguity requires human authority.
- Represent auxiliary user-global tools through the Harness registry,
  `docs/inventory/<tool>.json`, and linked runbooks; keep tool-specific details
  out of this entry map and load them only when relevant.
- Review the final diff.
- Never treat Harness metadata, hook output, or an agent statement as application test evidence.
- Harness lifecycle state controls orchestration; Git plans preserve intent and recovery; only executable verification proves completion.
- Harness emits immutable `WorkContext`; only `./qa/verify` emits a sealed
  `VerificationReceipt`. Neither side activates or mutates the other's
  lifecycle.
