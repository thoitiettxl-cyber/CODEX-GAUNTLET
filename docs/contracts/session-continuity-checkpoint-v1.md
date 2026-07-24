# Session continuity checkpoint protocol v1

## Envelope

A checkpoint is one immutable SQLite row. JSON-valued fields use compact UTF-8
JSON with sorted object keys. Unknown additive fields require a later schema
version; v1 readers reject a non-`1` `schema_version`.

Required fields:

| Field | Type | Constraint |
| --- | --- | --- |
| `schema_version` | integer | exactly `1` |
| `session_id` | string | 1-128 characters |
| `story_id` | string | 1-128 characters |
| `story_revision` | string | Harness work-graph revision or last observed revision |
| `plan_path` | string | repository-relative linked plan |
| `git_head` | string | observed commit id or `unknown` |
| `worktree_status_hash` | string | SHA-256 of porcelain status bytes |
| `last_safe_boundary` | string | redacted, at most 1,000 characters |
| `completed_operations` | JSON array | at most 64 redacted entries |
| `pending_operations` | JSON array | at most 64 redacted entries |
| `external_side_effects` | JSON array | at most 64 redacted observations |
| `verification_state` | JSON object | bounded redacted observations, never proof |
| `next_action` | string | one redacted exact action, at most 1,000 characters |
| `previous_checkpoint` | integer or null | prior valid row for the story |
| `created_at` | string | UTC RFC 3339 timestamp |
| `checksum` | string | lowercase SHA-256 |

The checksum is SHA-256 over the compact, sorted JSON encoding of all required
fields except `checksum`. The SQLite row id is not part of the checksum.

## Bounds

- Each identifier is at most 128 characters.
- Human strings are at most 1,000 characters.
- JSON collections contain at most 64 entries.
- A rehydration `systemMessage` is at most 7,000 UTF-8 characters.
- Hook diagnostics contain categories and recovery actions, not raw exception
  payloads or hook input.

## Atomic write

The writer:

1. starts `BEGIN IMMEDIATE` with a bounded busy timeout;
2. reads the current latest row id for the story;
3. compares it with the caller's expected latest row id;
4. inserts the new checkpoint and its event in the same transaction;
5. commits;
6. creates a validated online backup through SQLite's backup API and an atomic
   rename.

A compare-and-set mismatch or injected/interrupted failure rolls back the
transaction. Backup failure records degraded health but does not invalidate a
committed checkpoint.

## Read and recovery

Readers scan newest to oldest and select the first row whose schema, JSON
fields, bounds, and checksum validate. A corrupt newest row is reported and
skipped; it is never overwritten or silently declared valid.

Recovery is append-only. It clones the newest valid row into a new checksummed
checkpoint, links `previous_checkpoint` to that valid row, and records the raw
latest row as the compare-and-set expectation. This preserves forensic
evidence while restoring an unambiguous head.

A missing or corrupt database may be diagnosed against its validated online
backup. Replacing a database is a separate explicit operator recovery action;
hooks never replace it automatically.

## Operation ledger

Operation states are `prepared`, `in_progress`, `unknown`, `succeeded`, or
`failed`. Stored fields include the operation key, story, logical step,
operation class, canonical-input hash, state, bounded target observation, and
timestamps. Canonical input itself is not persisted.

A repeated key with a `succeeded` state reuses the recorded result. For
`unknown`, the caller must query the target before executing. A positive target
observation transitions to `succeeded` without executing again; an
indeterminate target observation requires human direction.
