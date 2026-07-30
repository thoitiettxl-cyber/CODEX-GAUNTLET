# Decision 0004: Use bounded native Windows session continuity

- Status: accepted
- Date: 2026-07-30

## Context

Compaction or interruption can remove the immediate safe boundary of a Codex
task. Harness lifecycle state alone cannot reconstruct implementation intent,
external side effects, or remaining verification. Persisting transcripts or
credentials would create an unacceptable data boundary.

## Decision

Use one generated SQLite database per resolved repository below
`%LOCALAPPDATA%\CodexGauntlet\session-state`. Store only allowlisted,
size-bounded, checksummed checkpoints, bindings, events, operation observations,
and recovery attempts.

Codex lifecycle hooks map native session events to the shared protocol. Harness
reads use a bounded timeout and never mutate story lifecycle. Binding uses an
existing session binding or exactly one active story; ambiguity is explicit.

## Consequences

- Compaction and resume can recover a precise safe boundary and next action.
- WAL, transactions, compare-and-set chains, integrity checks, and online backup
  protect the last valid checkpoint.
- Raw transcripts, prompts, tool payloads, credentials, and canonical inputs
  remain outside the store.
- Lock or Harness failures degrade safely without blocking unrelated work.
- `qa/verify.ps1` remains the sole pass/fail authority.
