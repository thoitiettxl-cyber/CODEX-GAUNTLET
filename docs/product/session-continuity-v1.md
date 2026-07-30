# Session continuity v1

## Purpose and authority

Session continuity preserves the minimum durable context needed to resume a
Codex task after compaction or interruption. It is not a task authority,
transcript store, memory service, or verification result.

- Harness owns story lifecycle, dependencies, hierarchy, and runnable state.
- The linked Git plan owns intent, progress, decisions, recovery, and
  validation context.
- Git and external targets own actual side-effect state.
- `qa/verify.ps1` is the only pass/fail authority.
- Continuity owns only session bindings, bounded checkpoints, events, operation
  observations, and recovery attempts.

## Storage

The implementation uses Python and SQLite on native Windows. By default, one
database per resolved repository is stored under:

```text
%LOCALAPPDATA%\CodexGauntlet\session-state\<repo-id>.sqlite
```

`CODEX_CONTINUITY_STATE_ROOT` may provide another absolute root. Relative
paths fail safely. The database is generated local state and is never
committed. It uses WAL, bounded busy waits, transactions, compare-and-set
checkpoint chaining, integrity checks, and SQLite online backup.

## Binding

A normalized Codex session resolves its story in this order:

1. an existing exact `session_id` binding;
2. exactly one Harness story in `in_progress`;
3. an explicit ambiguity or unavailable result.

Multiple active stories are never guessed. Chat prose, branch names, and stale
transcript paths are not binding evidence. Harness reads use a short timeout.
When a valid checkpoint already exists, Harness lock or read failure degrades
to that checkpoint instead of delaying the hook.

## Checkpoints

Packets conform to
`docs/contracts/session-continuity-checkpoint-v1.md`. They are allowlisted,
checksummed, size-bounded, and linked to the prior checkpoint. Each packet
records the story and plan, safe boundary, completed and pending operations,
observed external effects, verification state, and one exact next action.

- `PreCompact` atomically refreshes the safe-boundary packet.
- `PostCompact` validates and emits the latest packet.
- `SessionStart` with `resume` or `compact` rehydrates it.
- `SessionStart` with `startup` establishes or reports binding only.
- `SessionEnd` records a cheap terminal event and never queries Harness.

Lifecycle failure must not block unrelated work. When output is supported, it
emits a bounded degraded-recovery warning without exposing secrets or internal
paths.

## Replay-safe operations

Operation observations are identified by deterministic keys. A replay request
may report committed, failed, unknown, or safe-to-retry state, but it never
guesses an external outcome and never repeats a committed side effect. Raw
prompts, transcripts, credentials, tokens, environment dumps, and canonical
tool inputs are not stored.

## CLI and tests

```powershell
& .\scripts\windows-control.ps1 continuity status
& .\scripts\windows-control.ps1 continuity verify
& .\scripts\windows-control.ps1 continuity recover
& .\scripts\windows-control.ps1 continuity audit
```

Unit, hook, CLI, game-day, corruption, ambiguity, lock-timeout, redaction,
backup, and semantic-replay behavior are declared in
`qa/project-commands.json` and run by the canonical verifier.
