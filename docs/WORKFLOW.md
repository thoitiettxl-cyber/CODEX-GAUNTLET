# Canonical repository workflow

## Authority order

1. Explicit user intent.
2. Current product contract in `docs/product/`.
3. Architecture and durable decisions.
4. Active execution plan.
5. Code, tests, schemas, `qa/verify`, and runtime evidence.
6. Completed plans and historical evidence.

## Read-only question

Inspect the smallest authoritative surface and answer with evidence. Do not mutate the repository.

## Bounded change

```text
inspect → edit → focused proof → ./qa/verify --mode targeted → report
```

A bounded task does not require a durable plan.

## Complex change

Create `docs/plans/active/<plan>.md` when work spans sessions, has significant dependency sequencing, involves multiple contributors, needs a recovery procedure, or cannot be resumed safely from the final diff alone. Update progress and decisions in Git. Move the plan to `docs/plans/completed/` only after validation.

## Consequential ambiguity

Pause before mutation. Present the concrete choice and effects. Continue only after product or user authority is clear.

## Completion

Review the final diff and run the canonical gate. `./qa/verify` is the only definition-of-pass. Harness metadata, hook feedback, and agent statements are not application evidence.
