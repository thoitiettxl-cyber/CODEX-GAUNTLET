# Add compaction-aware Codex session continuity

Harness story: `TERMUX-002`

## Current context

The orchestration-first baseline is complete and pushed at commit `cc26455`.
Harness owns complex-work lifecycle, Git execution plans own intent and
recovery context, and `./qa/verify` remains the sole definition-of-pass.

The user approved this roadmap as a durable handoff for later sessions. The
research report at
`/storage/emulated/0/Download/deep-research-report (1).md` is reference material
only. Repository contracts and current Codex behavior remain authoritative.

Codex CLI `0.145.0` documents `PreCompact`, `PostCompact`, `SessionStart` with
`compact|resume`, `/compact`, `/resume`, `/fork`, `/goal`, compact-prompt
configuration, and local memories. Current project hooks cover only
`PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop`.

Existing durability:

- Harness story/work graph and compare-and-set lifecycle.
- Semantic JSONL changesets and reconstructible ignored `harness.db`.
- Git execution plans with a last safe boundary and external-side-effect notes.
- Canonical verification and Harness audit.

Missing continuity:

- compaction-aware checkpoint and rehydration hooks;
- a session-to-story binding;
- an atomic local checkpoint/event store;
- a replay-safe ledger for consequential external side effects;
- recovery metrics and game-day fixtures.

## Authority and scope

- Harness remains authoritative for story lifecycle, readiness, dependencies,
  and hierarchy.
- This plan remains authoritative for implementation intent and recovery.
- The continuity store owns only session bindings, compaction checkpoints,
  checkpoint events, and operation-retry observations.
- Git and target-system state remain authoritative for actual code and external
  side effects.
- `./qa/verify` remains the only pass/fail authority.
- Hooks must not mutate Harness lifecycle, accept proposals, or claim proof.
- Raw transcripts, prompts, tool payloads, credentials, and secrets must not be
  persisted.

## Approach

### Phase 1 — Contract and fixtures

1. Add a product contract for `session-continuity-v1`.
2. Specify the checkpoint schema and bounded rehydration packet.
3. Add fixture-driven tests for:
   - `PreCompact` with `manual` and `auto`;
   - `PostCompact` with `manual` and `auto`;
   - `SessionStart` with `startup`, `resume`, and `compact`;
   - a held Harness writer lock;
   - missing, corrupt, and stale checkpoints;
   - multiple active stories;
   - secret-bearing inputs.
4. Treat `transcript_path` only as diagnostic metadata. Do not parse it as a
   stable protocol.

### Phase 2 — Atomic local checkpoint store

Use a Termux-native SQLite store under an explicit state root such as:

```text
$PREFIX/var/lib/codex-gauntlet/session-state/<repo-id>.sqlite
```

Do not redefine `PREFIX`, `HOME`, or `CODEX_HOME`. Resolve and validate the
absolute target before mutation.

Minimum records:

- `session_binding`
- `checkpoint`
- `checkpoint_event`
- `operation_ledger`
- `recovery_attempt`

Minimum checkpoint fields:

```text
schema_version
session_id
story_id
story_revision
plan_path
git_head
worktree_status_hash
last_safe_boundary
completed_operations
pending_operations
external_side_effects
verification_state
previous_checkpoint
created_at
checksum
```

Use SQLite transactions, version/CAS checks, bounded lock waits, integrity
checks, and online backup. A failed write must leave the previous checkpoint
valid.

### Phase 3 — Compaction and resume bridge

Implement Termux Python handlers with repository-root resolution:

- `PreCompact`: resolve the current binding, capture a safe-boundary packet,
  and atomically commit it.
- `PostCompact`: validate the latest packet and emit a bounded `systemMessage`
  with story, plan, safe boundary, observed side effects, and exact next action.
- `SessionStart` for `resume|compact`: rehydrate the same bounded packet.
- `SessionEnd`: write only cheap terminal metadata within its short timeout.

The bridge must:

- use a short subprocess timeout when querying Harness;
- fall back to the last valid checkpoint instead of waiting on the Android
  exclusive writer lock;
- never call a Harness mutation from a lifecycle hook;
- refuse to guess when multiple active stories have no binding;
- cap injected context and redact sensitive values;
- report degraded recovery without blocking unrelated read-only work.

Add a compact-prompt override that preserves only:

- story ID and linked plan;
- current goal and constraints;
- completed versus pending operations;
- last safe boundary;
- stable external-operation identifiers and observed state;
- remaining verification;
- exact next action.

### Phase 4 — Session/story binding

Resolve in this order:

1. an existing binding for the hook `session_id`;
2. exactly one `in_progress` story;
3. otherwise an explicit ambiguity result requiring selection.

Do not infer the story from chat prose, a branch name, or a stale transcript.
Any automatic binding learned from tool events must accept only the exact
`scripts/termux-control orchestrator` command shape and verified successful
result.

### Phase 5 — Replay-safe external operations

Do not promise exactly-once execution for arbitrary shell commands. Start with
consequential control-plane operations:

- Git push;
- publish, deploy, and release;
- package or Android state mutation;
- external API writes;
- Harness lifecycle mutations.

Derive an operation key from:

```text
sha256(story_id + logical_step_id + operation + canonical_input)
```

Before retrying an unknown outcome, query both the ledger and the real target.
Reuse a stored successful result, attach to a live operation, or stop for human
direction. Never replay a consequential write merely because the previous
session disappeared.

### Phase 6 — Recovery, observability, and game days

Add `scripts/termux-control continuity` commands for:

- `status`
- `checkpoint`
- `verify`
- `recover`
- `audit`

Collect local structured metrics for checkpoint age/failures, rehydrate
latency, CAS conflicts, compact/resume outcomes, operation retries, and
lock-timeout fallbacks. Do not add Prometheus, Redis, Postgres, Temporal,
Restate, DBOS, Dapr, or an MCP memory server without a later demonstrated need.

Exercise:

- compaction during a long active story;
- interruption during checkpoint commit;
- corrupt newest checkpoint;
- held Harness writer lock;
- multiple active stories;
- side-effect timeout after the target committed;
- resume into a new session with only durable repository and checkpoint state.

Tests must feed hook fixture JSON directly. Do not launch nested Codex runtimes
as a fallback.

## Protected-path maintenance gate

Activation requires changes to project Codex hook and compact-prompt
configuration, which Gauntlet protects. Current path matching denies direct
mutation even when patch context merely names a protected target, and there is
no general protected-path maintenance transaction.

Prepare all unprotected implementation and fixtures first. Before changing the
project hook registry, compact-prompt setting, or policy-critical QA:

1. resolve exact target files and proposed diff;
2. obtain explicit human authorization for those exact targets;
3. use or add a narrow, reviewable maintenance transaction with allowlisted
   targets, backup, validation, and recovery;
4. never disable hooks, bypass trust, or exploit command-text matching;
5. re-review hook trust and run defense-in-depth verification.

This gate is a real prerequisite, not permission to evade Gauntlet.

## Progress

- [x] User accepted the roadmap and requested durable handoff.
- [x] Intake `2` and planned story `TERMUX-002` created.
- [x] Execution plan written with authority, recovery, and acceptance bounds.
- [ ] Product contract and checkpoint schema accepted.
- [ ] Fixture-driven continuity implementation completed.
- [ ] Exact protected-path maintenance authorized and applied.
- [ ] Game-day recovery evidence recorded.
- [ ] Story completed with fresh proof and final canonical verification.

## Last safe boundary

Planning and handoff only are complete. No continuity implementation,
dependency installation, protected-path mutation, or external service change
has started. `TERMUX-002` must remain `planned` until a later session re-reads
the contracts and intentionally starts implementation.

Exact next sequence:

```bash
scripts/termux-control orchestrator status
HARNESS_RUN_ID=<new-stable-run-id> \
  scripts/termux-control orchestrator story update \
  --id TERMUX-002 \
  --status in_progress \
  --expected-status planned \
  --require-runnable \
  --json
```

Then implement Phase 1 only. Do not edit protected Codex configuration until
the maintenance gate is satisfied.

## Decisions

- Reuse Harness, Git plans, and `qa/verify`; do not introduce a second lifecycle
  or verification authority.
- Prefer local SQLite and JSON fixture tests on Termux.
- Use actual Codex compact/resume lifecycle events, not foreign runtime hooks.
- Treat local Codex memories as optional recall, never project truth.
- Do not hard-code the research report's context-utilization thresholds until
  Codex exposes a stable measurable signal and local evidence justifies them.

## Risks

- Re-entering the Android-exclusive Harness lock from a hook can deadlock.
- A hook can amplify sensitive transcript content if packet fields are not
  strictly allowlisted.
- Ambiguous session/story binding can rehydrate the wrong work.
- A checkpoint can create false confidence if real external target state is not
  queried before retry.
- Protected-path activation can weaken Gauntlet if maintenance scope is broad.
- Persistent hooks can delay compaction or resume if their timeout is too long.

## Recovery

Before hook activation, recovery is deletion of only the new continuity state
and reverting the exact uncommitted implementation paths.

After activation:

1. disable new continuity writes only through the approved maintenance
   procedure;
2. preserve the latest database snapshot and event log;
3. restore the prior trusted hook/config files from the reviewed backup;
4. verify Harness work graph and Git plan independently;
5. run `./qa/verify --mode targeted`;
6. re-enable only after fixture and game-day proof passes.

Never delete or overwrite the root `harness.db` as part of continuity-store
recovery.

## External side effects

- Harness intake `2` and story `TERMUX-002` were created under semantic run
  `20260724-session-continuity-handoff`.
- The story is deliberately `planned` and currently runnable.
- Harness audit entropy is expected to be `5/100` while the planned story has
  not yet run its implementation verification; it is not orphaned because
  detailed planning trace `#3` is linked.
- No packages, services, protected hooks, Codex configuration, or external
  systems were changed.

## Validation

Handoff validation requires:

- `TERMUX-002` appears once as `planned`, runnable, and linked to this plan.
- The semantic changeset rebuilds the same logical work graph.
- No active implementation or protected-path diff exists.
- `git diff --check` passes.
- `./qa/verify --mode targeted` passes.

Handoff evidence recorded on 2026-07-24:

- isolated changeset rebuild matched the current logical work graph;
- `TERMUX-002` was `planned`, runnable, and linked to this file;
- detailed planning trace `#3` met the high-risk tier requirement;
- `git diff --check` passed;
- `./qa/verify --mode targeted` passed 42/42 structural checks and policy
  audit; consumer gates were skipped because no application surface is
  declared.

Implementation acceptance later requires:

- corrupt or interrupted writes preserve the previous valid checkpoint;
- compact/resume rehydrates the correct story and exact next action;
- held Harness locks never deadlock a hook;
- multiple stories produce explicit ambiguity rather than guessing;
- operation retries do not duplicate a fake consequential side effect;
- secret fixtures are redacted;
- hook failure degrades safely;
- final `./qa/verify --mode targeted` passes after story completion.
