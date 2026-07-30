# Canonical repository workflow

## Authority order

1. Explicit user intent.
2. Current product contract in `docs/product/`.
3. Architecture and durable decisions.
4. Harness work-graph state for lifecycle, readiness, dependencies, and
   hierarchy.
5. Active execution plan for progress, decisions, and recovery context.
6. Code, tests, schemas, `qa/verify.ps1`, and runtime evidence.
7. Completed plans and historical evidence.

Nested `AGENTS.md` and `AGENTS.override.md` files apply by repository
precedence: load the nearest applicable instruction only after this root entry
map directs you into that subtree.

## Read-only question

Inspect the smallest authoritative surface and answer with evidence. Querying
`scripts/windows-control.ps1 orchestrator status` is allowed when task state
matters, but perform no lifecycle write and no heavy verification.

## Bounded change

Use native Windows PowerShell and a stable `HARNESS_RUN_ID` when a Harness
write is needed, then follow:

```text
intake → inspect → edit → focused proof → trace when useful
       → qa/verify.ps1 -Mode targeted → report
```

A Bounded single-session task does not require a durable plan or story. Harness
may emit a bounded `WorkContext`, but `storyId` remains optional and Gauntlet
independently classifies the concrete diff.

## Complex change

For multi-session, coordination-heavy, or recovery-sensitive work:

1. Run `scripts/windows-control.ps1 orchestrator init` and query the protocol.
2. Record intake and create one story with a real Windows verification command.
3. Link `story.contract_doc` to one file under `docs/plans/active/`.
4. Add dependency and hierarchy edges only when they change runnable selection.
5. Transition the story with compare-and-set and `--require-runnable`.
6. Keep story lifecycle and the linked plan's progress and recovery boundary
   current.

Before implementation, emit a runnable `WorkContext` linked to the active
story and linked plan. Gauntlet validates repository identity, revisions,
paths, graph revision, digest, and requested mode; the context is never
application-pass evidence.

The work graph owns lifecycle and scheduling. The linked plan owns intent,
progress, decisions, recovery, and validation context.

## Consequential ambiguity

Pause before mutation. Present the concrete choice and effects. Continue only
after product or user authority is clear.

## Completion

For story-backed work:

1. Review the final diff and run `qa/verify.ps1` with the current validated
   `WorkContext`.
2. Require a passing `VerificationReceipt` with structured command records,
   sealed logs, current policy/target digest, and no stale final state.
3. Validate the receipt through `scripts/gauntlet_handshake.py
   validate-receipt`; Harness links the receipt without interpreting tests.
4. Record validation and recovery context in the linked plan, then move it to
   `docs/plans/completed/`.
5. Update story evidence and run `story complete`; completion may reuse the
   current receipt digest and does not activate another scan.
6. Review the lifecycle-final diff and run `qa/verify.ps1` once more.

Canonical modes are:

- `targeted`: selected focused functional gates;
- `stop`: bounded Stop proof with recursion guard;
- `ci`: final diff-scoped proof;
- `audit`: scheduled or release repository-wide proof.

Harness status and doctor never invoke Gauntlet, and Gauntlet never creates or
transitions a Harness story. `qa/verify.ps1` is the only definition-of-pass.
