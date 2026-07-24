# Activate orchestration-first Harness state

## Current context

The repository installs the complete Core Plus CLI, but its default workflow
keeps intake, story, trace, audit, proposal, and SQLite state optional. The user
has explicitly selected a stronger operating model: Harness must expose and
control structured work state, Git-native plans must preserve implementation
intent and recovery context, and `./qa/verify` must remain the sole pass/fail
authority.

This change is tracked as Harness intake `1`, story `TERMUX-001`, and semantic
run `20260724-orchestration-first`.

## Approach

1. Make the Harness work graph authoritative for lifecycle, readiness,
   dependency, and hierarchy of complex work.
2. Keep one Git-native execution plan authoritative for outcome, decisions,
   progress, risks, recovery, and validation context.
3. Add a Termux control-plane wrapper that pins the repository and database
   paths, supports initialization/rebuild, and exposes the complete CLI without
   hiding protocol-v1 commands.
4. Persist semantic changesets in Git while keeping the generated `harness.db`
   ignored and reproducible.
5. Activate intake, trace, audit, and proposal loops proportionally without
   allowing their metadata to replace executable proof.

## Progress

- [x] Read the product, workflow, architecture, protocol, and quality contracts.
- [x] Prove the isolated Harness story lifecycle on Termux.
- [x] Initialize the repository database and create `TERMUX-001`.
- [x] Update product, workflow, architecture, entrypoint, and runbooks.
- [x] Add focused self-tests for orchestration bootstrap and authority.
- [x] Record decision `0003` in Markdown and Harness state.
- [x] Record a detailed implementation trace for `TERMUX-001`.
- [x] Complete `TERMUX-001` with fresh proof.
- [x] Verify decision `0003`.
- [x] Run the first mandatory verification and review the implementation diff.
- [x] Run mandatory verification after final run-ID guard hardening.

## Last safe boundary

Implementation, trace, plan promotion, and story completion are complete. The
work graph is reconstructible from the tracked semantic changeset and
`TERMUX-001` is `implemented`. The remaining operation is canonical
verification on the final repository state.

## External side effects

- Local ignored `harness.db` contains intake `1`, story `TERMUX-001`, and
  decision `0003`.
- Stable run `20260724-orchestration-first` emitted the tracked semantic
  changeset. Query logical state before retrying any interrupted mutation.
- An isolated database was rebuilt successfully from the tracked changeset; it
  was used only as recovery proof.

## Decisions

- Harness story/work-graph state owns machine-readable task lifecycle,
  dependencies, hierarchy, and runnable selection for complex work.
- The active execution plan owns narrative implementation state and recovery;
  it is linked from the story `contract_doc`.
- Semantic changesets under `.harness/changesets/` are committed replay input.
  The generated root `harness.db` remains ignored and is rebuilt from them.
- `./qa/verify` remains the only repository definition-of-pass. `story complete`
  must run fresh proof but does not replace the final canonical gate.
- Bounded single-session changes stay lightweight. Read-only requests never
  write Harness state.
- The checksum-locked upstream CLI documentation remains intact. Local workflow,
  ADR, and runbook authority supersede its historical opt-in wording.

## Risks

- A database and its changesets can drift if callers bypass the control-plane
  wrapper or fail to use a stable `HARNESS_RUN_ID`.
- Making every trivial action a story would add noise and reduce signal.
- Story completion changes durable state after its verification command, so the
  repository gate must run once more on the final state.
- Policy and verification changes require explicit maintenance intent and must
  retain defense-in-depth behavior.

## Recovery

Before implementation is complete, revert the tracked documentation, scripts,
tests, decision, and semantic changeset changes. The ignored `harness.db` can be
removed only after preserving any wanted local state; it is reconstructible
from committed semantic changesets with the documented rebuild command.

After adoption, recover a missing or corrupt database by moving it aside and
running `scripts/termux-control orchestrator rebuild`. Never copy a live SQLite
file directly; use `harness-cli db snapshot` for a WAL-safe backup.

## Validation

- Focused shell syntax and Python self-tests.
- Harness protocol discovery and work-graph queries through
  `scripts/termux-control orchestrator`.
- Rebuild parity from committed semantic changesets in an isolated database.
- `scripts/termux-control doctor`.
- `./qa/verify --mode targeted`.
- Final `git diff --check`, worktree review, Harness trace, and story completion.

Evidence recorded:

- `bash -n scripts/termux-control` — passed.
- `python3 -m py_compile qa/selftest/run.py` — passed.
- `python3 qa/selftest/run.py --group acceptance` — 21/21 passed.
- isolated `scripts/termux-control orchestrator init` — replayed 4 semantic
  operations and reconstructed `TERMUX-001`.
- `scripts/termux-control doctor` — passed, including checksum-locked Harness
  integrity.
- `./qa/verify --mode targeted` — passed 41/41 structural checks and policy
  audit; consumer build/unit/integration/acceptance/coverage were correctly
  skipped because no application surface is declared.
- `git diff --check` — passed.
- Trace `#2` — detailed tier 3/3, meeting the high-risk lane requirement.
  Trace `#1` remains an immutable standard-tier attempt and documents why the
  detailed replacement was required.
- The first two `story complete` attempts were interrupted before mutation
  after logical-state queries confirmed `in_progress`: acceptance replay had
  re-entered the Android-exclusive repository writer lock. H18 now detects a
  held lock, validates the already runtime-proven semantic source in nested
  proof, and retains full isolated rebuild proof in standalone verification.
- `story complete TERMUX-001 --json` — passed fresh targeted verification and
  atomically moved the story to `implemented`.
- Final `./qa/verify --mode targeted` after lifecycle completion — passed
  41/41 structural checks and policy audit.
- `decision verify 0003` — passed fresh targeted verification; subsequent
  Harness audit reported entropy `0/100`.
- H21 proves a data value equal to `help` cannot bypass `HARNESS_RUN_ID`; both
  standalone and lock-held acceptance runs passed 21/21.
- Final canonical verification after H21 — passed 42/42 structural checks,
  Harness integrity, and policy audit.

The plan is complete. Any later unrelated mutation must enter a new authorized
intake.
