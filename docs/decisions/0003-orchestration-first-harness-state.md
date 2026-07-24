# 0003 Use Harness as the orchestration state authority

Date: 2026-07-24

## Status

Accepted

## Context

The repository installs the complete Harness Core Plus CLI but previously kept
its SQLite intake, story, trace, and orchestration lifecycle outside the default
workflow. Git-native execution plans preserved narrative context well, but
there was no active machine-readable authority for lifecycle, readiness,
dependencies, hierarchy, or replayable state.

The user explicitly selected a model that uses Harness for structured control,
Git for inspectable implementation context, and Gauntlet for executable
verification.

## Decision

For complex, multi-session, coordination-heavy, or recovery-sensitive work:

- the Harness work graph is authoritative for lifecycle, readiness,
  dependencies, hierarchy, and runnable selection;
- one linked Git-native execution plan is authoritative for outcome, progress,
  decisions, risks, recovery, and validation context;
- semantic changesets are committed as replay input while the generated
  `harness.db` remains ignored and reproducible;
- `./qa/verify` remains the sole repository definition-of-pass.

Read-only requests never mutate Harness state. Bounded single-session changes
do not require a story. Trace, audit, intervention, backlog, and proposal
features are used when their evidence applies; they never substitute for
application or repository proof.

## Alternatives Considered

1. Keep all SQLite capabilities optional and use only Git plans. Rejected
   because it leaves the installed work graph and orchestration protocol idle.
2. Make Harness metadata the completion authority. Rejected because metadata
   cannot replace executable verification.
3. Require stories for every request. Rejected because read-only and bounded
   work would pay coordination overhead without gaining useful durability.

## Consequences

Positive:

- Codex can query a stable work graph instead of reconstructing lifecycle from
  chat history.
- Concurrent or resumed work can use compare-and-set transitions and runnable
  checks.
- Database loss is recoverable from reviewed semantic changesets.
- Rich plan context and machine state have explicit, non-overlapping owners.

Tradeoffs:

- Complex changes must keep a story and execution plan linked and current.
- Operators must use the pinned database path and stable run identifiers.
- Final verification still runs after story completion updates durable state.

## Follow-Up

- Exercise snapshot/rebuild recovery periodically.
- Review trace friction and audit proposals without auto-accepting them.
- Revisit the boundary if a future Harness release offers a single
  repository-native materialization flow for installed consumers.
