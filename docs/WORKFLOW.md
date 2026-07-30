# Canonical repository workflow

## Authority order

1. Explicit user intent.
2. Current product contract in `docs/product/`.
3. Architecture and durable decisions.
4. Harness work graph for lifecycle, readiness, dependencies, and hierarchy.
5. Active execution plan for progress, decisions, and recovery context.
6. Code, tests, schemas, `qa/verify`, and runtime evidence.
7. Completed plans and historical evidence.

Nested `AGENTS.md` and `AGENTS.override.md` files apply by repository
precedence: load the nearest applicable instruction only after this root entry
map directs you into that subtree.

## Read-only question

Inspect the smallest authoritative surface and answer with evidence. Querying
`scripts/termux-control orchestrator status` is allowed when task state matters,
but perform no lifecycle write and no heavy verification.

## Bounded change

Use a stable `HARNESS_RUN_ID`, record an intake classification, then:

```text
intake → inspect → edit → focused proof → trace when useful
       → ./qa/verify --mode targeted → report
```

A bounded single-session task does not require a durable plan or story.
Harness may emit a bounded `WorkContext`, but `storyId` remains optional and
Gauntlet independently classifies the concrete diff.

## Complex change

When work spans sessions, has significant dependency sequencing, involves
multiple contributors, needs a recovery procedure, or cannot be resumed safely
from the final diff alone:

1. Run `scripts/termux-control orchestrator init` and discover the protocol.
2. Record intake and create one story with a real verification command.
3. Link `story.contract_doc` to one file under `docs/plans/active/`.
4. Add dependency and hierarchy edges when they change runnable selection.
5. Transition the story with compare-and-set and `--require-runnable`.
6. Keep story lifecycle and plan progress current at each safe boundary.

Before implementation, emit a runnable `WorkContext` linked to the active
story and linked plan. Gauntlet validates repository identity, revisions,
paths, graph revision, digest, and requested mode; the context is never
application-pass evidence.

The work graph owns lifecycle and scheduling. The plan owns outcome, approach,
decisions, progress, risks, recovery, and validation context. Do not duplicate
either source blindly into the other.

## Consequential ambiguity

Pause before mutation. Present the concrete choice and effects. Continue only after product or user authority is clear.

## Completion

For story-backed work:

1. Review the final diff and run `./qa/verify` with the validated WorkContext.
2. Require a passing `VerificationReceipt` with structured command records,
   sealed logs, current policy/target digest, and no stale final state.
3. Validate the receipt through `scripts/gauntlet_handshake.py
   validate-receipt`; Harness links the receipt without interpreting tests.
4. Record validation and recovery context in the linked plan, then move it to
   `completed/`.
5. Update the story contract/evidence and run `story complete`; completion
   may reuse the current receipt digest and does not activate another scan.
6. Review the lifecycle-final diff and run `./qa/verify` once more.

Canonical verification tiers are:

- `targeted`: selected focused functional gates; security-sensitive work uses
  `security-fast`;
- `stop`: bounded Stop proof with recursion guard and no ordinary full scan;
- `ci`: final diff-scoped proof; sensitive changes use `security-full-diff`;
- `audit`: scheduled/release repository-wide proof through
  `security-audit-repository`.

Harness status/doctor never invoke Gauntlet, and Gauntlet never creates or
transitions a Harness story. This one-way handshake prevents activation loops.

`./qa/verify` is the only definition-of-pass. Harness metadata, hook feedback,
and agent statements are not application evidence.
