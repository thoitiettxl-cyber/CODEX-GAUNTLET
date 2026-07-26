# Add Pi session continuity parity

Harness story: `TERMUX-006`

## Current context

`TERMUX-002` established the repository `session-continuity-v1` protocol for
Codex: a bounded SQLite store binds a runtime session to one Harness story,
checkpoints safe boundaries and operation state before compaction, and emits a
validated recovery packet after compaction or resume.

`TERMUX-005` added the trusted project-local Pi `0.82.1` Gauntlet adapter, but
explicitly excluded continuity. Before this story, Pi could save and resume its
native session but did not translate Pi lifecycle events into the repository
continuity protocol.

The user authorized the exact protected implementation targets proposed for
this follow-up. The active process maintenance allowlist covers
`.pi/extensions/gauntlet/index.ts`, the existing adapter modules, and
`qa/policy_audit.py`; it does not cover adding a fourth `.pi` module or editing
`qa/selftest/run.py`. Keep the implementation within the active exact
allowlist unless a later change is genuinely required and separately enabled.

## Outcome

A trusted Pi project session must use the same repository-owned continuity
store and recovery semantics as Codex while retaining Pi's native compaction
and session format:

- namespace Pi native session IDs so they cannot collide with Codex IDs;
- bind a Pi session to the same single in-progress Harness story rule;
- checkpoint before manual, threshold, or overflow compaction;
- validate and recover after compaction without triggering an unintended turn;
- recover after a persisted Pi session is resumed;
- preserve safe boundary, verification, pending/completed operation, and
  external-side-effect fields from the runtime-neutral checkpoint;
- fail open for ordinary runtime use but fail safe for recovery: never guess an
  ambiguous story, never replay a consequential side effect, and fall back to
  the latest valid checkpoint when the newest one is corrupt or stale;
- prove the adapter with unit fixtures and an installed-Pi `0.82.1` offline
  compaction/resume probe using temporary session state only.

Pi remains auxiliary-only, provides no sandbox, and never becomes a
verification authority.

## Approach

1. Generalize the continuity hook boundary so a native runtime adapter can
   submit the same normalized lifecycle envelope and receive a bounded,
   runtime-neutral outcome.
2. Add a dependency-free Pi bridge inside the currently allowlisted adapter
   layout. It invokes the repository continuity CLI with bounded timeout and
   output, queues normal recovery for the next `before_agent_start`, and uses
   an immediate steer only when Pi is already retrying an overflow-compacted
   turn.
3. Map Pi lifecycle events:
   - `session_before_compact` -> `PreCompact`;
   - `session_compact` -> `PostCompact`;
   - persisted `session_start` resume/fork -> `SessionStart/resume`;
   - `session_shutdown` -> `SessionEnd`.
4. Do not parse or persist transcript content. Use only the native session ID,
   lifecycle reason, and minimal session metadata needed to distinguish a
   fresh startup from reopening saved state.
5. Extend the product contract, architecture, Pi runbook, adapter tests, and
   policy audit. Keep `./qa/verify` as the single verification authority.

## Progress

- [x] Researched Pi `0.82.1` lifecycle events and compaction ordering from its
  versioned documentation and source.
- [x] Received user authorization for the proposed protected targets.
- [x] Created intake #10 and moved Harness story `TERMUX-006` from `planned`
  to `in_progress` with compare-and-set.
- [x] Implemented the bounded runtime-neutral lifecycle result and retained the
  Codex hook as a thin output adapter.
- [x] Added the Pi lifecycle bridge, namespaced session binding, safe recovery
  delivery, and explicit checkpoint guidance.
- [x] Added synthetic, corruption/stale fallback, initial Harness-unavailable,
  and installed Pi compaction/resume proof.
- [x] Updated repository contracts, ADR, architecture, runbook, inventory, and
  policy audit.
- [x] Canonical `./qa/verify --mode targeted` passed on the implementation
  state.
- [x] Harness story completion ran fresh proof atomically and marked
  `TERMUX-006` implemented.
- [x] Final post-completion `./qa/verify` passed.
- [x] Completed raw diff/status review without modifying or discarding the
  pre-existing TERMUX-005 worktree changes.

## Last safe boundary

The runtime-neutral lifecycle protocol, thin Codex adapter, Pi event mapping,
prompt delivery, product truth, and repeatable installed-runtime test are
implemented. Focused continuity tests pass 20/20; the combined Pi and hook
proof passes 16/16; policy audit and `git diff --check` pass.

The installed Pi `0.82.1` test used temporary agent/session/store roots,
performed native manual compaction with an extension-provided offline summary,
persisted a real Pi `compaction` entry, then reopened the same JSONL in a second
process and recovered story, plan, safe boundary, completed/pending operations,
external observation, verification state, and exact next action.

Harness story `TERMUX-006` is `implemented` and links this completed plan.
The first completion attempt correctly exposed a fixture assumption: the
runtime-neutral result is degraded while the completion transaction holds the
Harness writer lock. The assertion now verifies that the flag agrees with the
recovery message. Focused lock tests passed, and the second atomic completion
proof passed the full targeted matrix.

Final post-completion `./qa/verify` passed. Raw Git status and diff review
confirmed the intended TERMUX-006 additions remain uncommitted alongside the
pre-existing TERMUX-005 worktree changes; `git diff --check` is clean. No
implementation work remains. Commit, push, or publication is outside this
request.

## Decisions

- Reuse the existing bounded SQLite store and checkpoint schema; do not create
  a Pi-specific database or lifecycle authority.
- Preserve Pi's native compaction summarizer and session format.
- Prefix the persisted native ID as `pi:<session-id>` instead of migrating the
  store schema.
- Queue ordinary recovery for the next `before_agent_start`; only an overflow
  retry receives an immediate steer because Pi is already continuing that
  turn.
- Keep runtime adapters thin and dependency-free.

## Risks

- A recovery message sent at the wrong Pi lifecycle point can start an
  unintended provider turn.
- Pi may report a reopened CLI session as `startup`; minimal persisted-session
  metadata is required to classify it without reading transcript content.
- A slow Harness query can delay compaction; existing bounded timeout and
  last-valid-checkpoint fallback must remain effective.
- The current maintenance allowlist is narrower than the originally proposed
  file list, so module layout and QA changes must not silently exceed it.

## Recovery

Before runtime activation, revert only TERMUX-006 paths and delete temporary
probe state. Do not remove or rewrite the shared continuity database.

After activation, preserve the latest database and event records, remove the
Pi lifecycle registration only through an exact-target maintenance session,
run focused continuity tests, then run `./qa/verify --mode targeted`.

## External side effects

- No packages, global Pi settings, credentials, trust records, or persistent Pi
  sessions may be changed.
- Harness lifecycle writes use stable run ID
  `20260726-termux006-pi-continuity`.
- The installed-runtime probe must use a `mktemp -d` session directory and
  temporary project approval only.
- Two manual exploratory probes and the repeatable consumer test created only
  temporary data below `$PREFIX/tmp`; no provider request, package, global
  trust record, credential, or user session was changed.
- The Gauntlet gate rejected one mixed protected/unprotected patch. The change
  was reapplied as separate exact-target and ordinary patches; no bypass or
  policy change was used.

## Validation

Required evidence:

- normalized lifecycle fixtures cover manual/threshold/overflow compaction,
  persisted resume, fresh startup, shutdown, ambiguity, stale/corrupt fallback,
  and bounded output;
- Pi adapter tests prove event mapping and delivery timing;
- the installed Pi `0.82.1` probe performs compaction and reopens the same
  temporary session without a provider request or global-state mutation;
- `./qa/verify --mode targeted` passes;
- the completed-plan story proof and final `./qa/verify` pass.

Recorded focused evidence:

- `python3 -m unittest -v tests.continuity.test_store
  tests.continuity.test_cli tests.continuity.test_hooks
  tests.continuity.test_game_day` — 20 passed;
- `python3 -m unittest -v tests.pi.test_adapter
  tests.continuity.test_hooks` — 16 passed, including the installed Pi
  compaction/resume consumer;
- `python3 qa/policy_audit.py` — passed;
- `git diff --check` — passed.
- `./qa/verify --mode targeted` — passed all 65 structural checks plus policy,
  build, unit, integration, acceptance, and coverage gates; the Pi integration
  passed 7/7 including the installed runtime.
- First `story complete TERMUX-006 --json` — proof failed because one lifecycle
  test required `degraded=false` while the Harness writer lock was
  intentionally exercising lock-timeout fallback; the story remained
  `in_progress`.
- Focused neutral-protocol and held-writer-lock tests — 2/2 passed after
  correcting the assertion.
- Second `story complete TERMUX-006 --json` — fresh targeted proof passed and
  atomically marked the story `implemented`.
- Final post-completion `./qa/verify` — passed the same full matrix on the
  implemented story state.
- Final raw `git status --short` and diff review — completed; pre-existing
  TERMUX-005 changes were preserved and `git diff --check` passed.
