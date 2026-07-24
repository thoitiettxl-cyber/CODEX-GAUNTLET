# Canonical repository workflow

## Authority order

1. Explicit user intent.
2. Current product contract in `docs/product/`.
3. Architecture and durable decisions.
4. Harness work graph for lifecycle, readiness, dependencies, and hierarchy.
5. Active execution plan for progress, decisions, and recovery context.
6. Code, tests, schemas, `qa/verify`, and runtime evidence.
7. Completed plans and historical evidence.

## Read-only question

Inspect the smallest authoritative surface and answer with evidence. Querying
`scripts/termux-control orchestrator status` is allowed when task state matters,
but do not initialize or mutate Harness state.

## Bounded change

Use a stable `HARNESS_RUN_ID`, record an intake classification, then:

```text
intake → inspect → edit → focused proof → trace when useful
       → ./qa/verify --mode targeted → report
```

A bounded single-session task does not require a durable plan or story.

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

The work graph owns lifecycle and scheduling. The plan owns outcome, approach,
decisions, progress, risks, recovery, and validation context. Do not duplicate
either source blindly into the other.

## Consequential ambiguity

Pause before mutation. Present the concrete choice and effects. Continue only after product or user authority is clear.

## Completion

For story-backed work:

1. Run focused proof and record the implementation trace.
2. Record validation in the plan and move it to `completed/`.
3. Update the story contract path, then run `story complete` for a fresh,
   atomic lifecycle transition.
4. Review the final diff and run `./qa/verify` again on the final state.

`./qa/verify` is the only definition-of-pass. Harness metadata, hook feedback,
and agent statements are not application evidence.
