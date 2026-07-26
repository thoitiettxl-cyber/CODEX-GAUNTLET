# 0004 Use a bounded local continuity store for agent sessions

Date: 2026-07-24

## Status

Accepted

## Context

Harness and Git already preserve complex-work lifecycle and intent, but a
Agent compaction or an interrupted Termux session can lose the immediate safe
boundary, exact next action, and observations needed to avoid repeating a
consequential external write.

Using Harness as conversational memory would mix authority domains and could
deadlock lifecycle hooks on Android's exclusive CLI lock. Persisting
transcripts would create an unstable protocol and a secret-retention risk.

## Decision

Use one generated Termux-native SQLite database per repository for bounded
session bindings, checksummed checkpoints, checkpoint events, operation
observations, and recovery attempts.

Lifecycle hooks read Harness only with a short timeout and never mutate it.
Existing session bindings and valid checkpoints are the lock-safe fallback.
The store persists only allowlisted, redacted fields and does not read
transcripts. Consequential operation retries require a stable operation key
and a real-target observation.

Runtime adapters translate native lifecycle events to one normalized protocol.
Pi IDs are namespaced as `pi:<native-session-id>`; native session formats and
summarizers remain outside the store.

Harness remains authoritative for lifecycle and scheduling, the Git plan for
intent and recovery, external targets for their real state, and `./qa/verify`
for pass/fail.

## Consequences

Positive:

- compact/resume can restore the current story and safe boundary without
  reconstructing chat history;
- interrupted or corrupt newest records fall back to an earlier checksummed
  checkpoint;
- Android writer-lock contention is bounded;
- operation observations reduce accidental duplicate side effects.
- Codex and Pi recover from the same checkpoint semantics without sharing
  transcript formats.

Tradeoffs:

- agents must record explicit safe boundaries for high-quality recovery;
- the local database is device-local and remains generated state;
- hook trust must be reviewed whenever lifecycle hook definitions change;
- the ledger cannot guarantee exactly-once behavior for arbitrary commands.

## Rejected alternatives

- Harness fields as session memory: mixes lifecycle authority and hook state.
- Raw transcript parsing: unstable and sensitive.
- Redis, Postgres, Temporal, Dapr, LangGraph, or an MCP memory service: no
  demonstrated need for a distributed runtime.
- Automatic retry after session loss: cannot distinguish rollback from a
  committed external write.
