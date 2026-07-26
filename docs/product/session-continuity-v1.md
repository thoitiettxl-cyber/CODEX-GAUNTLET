# Session continuity v1

## Purpose

Session continuity preserves the minimum durable context needed to resume a
supported Termux agent task after compaction or interruption. Codex and Pi use
native lifecycle adapters around the same protocol, store, and checkpoint
schema. Continuity does not create a new task authority, memory service,
transcript protocol, or verification result.

Authority remains split as follows:

- Harness owns story lifecycle, dependency, hierarchy, and runnable state.
- The linked Git execution plan owns intent, progress, decisions, recovery, and
  validation context.
- Git and external target systems own actual code and side-effect state.
- `./qa/verify` is the only pass/fail authority.
- The continuity store owns session bindings, bounded checkpoints, checkpoint
  events, operation observations, and recovery attempts only.

## Runtime boundary

The implementation uses Python and SQLite shipped by Termux. The default store
is one database per resolved repository under:

```text
$PREFIX/var/lib/codex-gauntlet/session-state/<repo-id>.sqlite
```

The root and database path must be absolute. `PREFIX`, `HOME`, and
`CODEX_HOME` are inputs to the environment and are never redefined.

The database is generated local state and is not committed. It uses WAL,
bounded busy waits, transactions, compare-and-set checkpoint chaining,
integrity checks, and SQLite online backup. A failed checkpoint transaction
must not damage or replace the preceding valid checkpoint.

## Binding

A normalized runtime session resolves its story in this order:

1. an existing binding for the exact `session_id`;
2. exactly one Harness story whose status is `in_progress`;
3. an explicit ambiguity or unavailable result.

Multiple active stories are never guessed. Chat prose, branches, transcript
contents, and stale transcript paths are not binding evidence. A user can make
an explicit binding with the continuity CLI.

Native IDs occupy one shared store namespace. Codex keeps its native ID; Pi
uses `pi:<native-session-id>`. This avoids cross-runtime collisions without
changing the v1 checkpoint schema.

Harness reads have a short timeout. Lifecycle hooks never call a Harness
mutation. When a bound session already has a valid checkpoint, a Harness lock
or read failure degrades to that checkpoint instead of delaying the hook.

## Checkpoints

Checkpoint records conform to
`docs/contracts/session-continuity-checkpoint-v1.md`. Packets are allowlisted,
checksummed, size bounded, and linked to the prior checkpoint. They include the
story and plan, last safe boundary, completed and pending operations, observed
external effects, remaining verification, and one exact next action.

Normalized lifecycle behavior:

- `PreCompact` with trigger `manual` or `auto` atomically refreshes the latest
  safe-boundary packet. If no explicit safe boundary exists, it records a
  degraded packet that directs the resumed agent to inspect the plan before a
  consequential write.
- `PostCompact` with trigger `manual` or `auto` validates and emits the latest
  bounded packet.
- `SessionStart` with source `resume` or `compact` rehydrates that packet.
- `SessionStart` with source `startup` establishes or reports a binding without
  pretending a resume occurred.
- `SessionEnd` writes only a cheap terminal event and never queries Harness.

All lifecycle failures exit without blocking unrelated work and emit a bounded
degraded-recovery warning when the event supports output.

## Native runtime adapters

Codex hook JSON is translated directly to the normalized lifecycle and back to
Codex's `continue`/`systemMessage` response.

The trusted Pi `0.82.1` project extension maps:

- `session_before_compact` reason `manual` to `PreCompact/manual`;
- `session_before_compact` reason `threshold|overflow` to `PreCompact/auto`;
- `session_compact` to the matching `PostCompact`;
- `session_start` reason `resume|fork`, or startup of a persisted nonempty
  session, to `SessionStart/resume`;
- a fresh `session_start` to `SessionStart/startup`; and
- `session_shutdown` to `SessionEnd`.

Pi's native summarizer and session JSONL remain authoritative for conversation
compaction. The adapter never reads `branchEntries` or transcript content.
After ordinary manual or threshold compaction, it holds the recovery packet in
memory and appends it to the next `before_agent_start` system prompt. During an
overflow retry, when Pi is already continuing the interrupted turn, it queues
the packet as a non-triggering steer. This prevents continuity from starting an
unrequested provider turn.

In-memory Pi sessions have no cross-process resume target and are not bound to
the durable store. Persistent Pi sessions receive a prompt-visible namespaced
session key so the agent can record explicit checkpoints and operation
observations through the same CLI as Codex.

## Sensitive data

Raw transcripts, prompts, Pi branch entries, tool payloads, credentials,
cookies, private keys, and secret values must never be stored.
`transcript_path` may be accepted as diagnostic metadata from Codex but is
neither read nor persisted.

All persisted human strings pass through bounded redaction. Consequential
operation inputs are canonicalized in memory to derive a key, but only their
hash is stored.

## Consequential operations

Continuity does not promise exactly-once shell execution. The ledger covers
operation intent and observations for Git push, publish/deploy/release,
package or Android mutation, external API writes, and Harness lifecycle
mutations.

The stable operation key is:

```text
sha256(story_id + logical_step_id + operation + canonical_input)
```

Before an unknown operation is retried, the caller must inspect both the local
ledger and the real target. If the target already committed, continuity records
the observation and reuses it. If the target cannot establish state, the
operation stops for human direction; session loss alone is never a retry
signal.

## CLI

`scripts/termux-control continuity` provides:

- `status` for bindings, checkpoints, and degraded state;
- `bind` for an explicit session/story association;
- `checkpoint` for an explicit safe boundary and next action;
- `verify` for SQLite integrity, checksums, and online-backup health;
- `recover` for an append-only recovery checkpoint based on the newest valid
  predecessor;
- `audit` for local checkpoint, recovery, lock-timeout, and operation metrics;
- `operation` for replay-safe begin, observation, and completion records.
- `lifecycle` for the bounded runtime-neutral JSON protocol consumed by native
  adapters.

CLI output never turns continuity metadata into Harness lifecycle state or
verification proof.

## Acceptance

The version is accepted only when executable fixtures prove:

- interrupted and corrupt newest writes preserve the previous valid packet;
- compact and resume restore the correct story, plan, safe boundary, and next
  action;
- a held Harness writer lock causes a bounded fallback, not a deadlock;
- multiple active stories produce explicit ambiguity;
- an identical operation key does not repeat a fake committed side effect;
- secret-bearing fixture values are absent from output and SQLite;
- hook/store failures degrade safely;
- Pi manual compaction writes a native compaction entry and a second Pi process
  reopening the same temporary session receives the validated recovery packet;
- changeset replay matches the live logical work graph; and
- final `./qa/verify --mode targeted` passes.
