# Manage RTK as a durable Termux capability

Harness story: `TERMUX-003`

## Current context

The user wants RTK to remain safe and maintainable across future Codex
sessions, RTK releases, and newly observed command patterns. The initial work
was bounded installation and configuration, recorded by intake `3`. That work
installed RTK globally but did not make RTK a repository-managed operational
capability.

Current external state:

- RTK `0.43.0` was built from signed release commit
  `5a7880d404db8364d602f2ecdc41dd790f64013f` with Cargo's locked dependency
  graph for native Android `aarch64`.
- The installed binary is `~/.local/bin/rtk`, mode `0755`, with SHA-256
  `6a9471ac107faac6be1af6a36e8c7913bbfea79cbbcda8c2d3b2168221ad8114`.
- `~/.codex/AGENTS.md` references `~/.codex/RTK.md`; new Codex runs load the
  global accuracy-first guidance.
- `~/.config/rtk/config.toml` disables telemetry and tracking, excludes
  accuracy-critical commands from future automatic rewriting, and sends the
  optional history database to `/dev/null`.
- The `/dev/null` sink is a reviewed workaround for RTK `0.43.0`: its
  configuration parses `tracking.enabled = false`, but the recording path does
  not consult that value before opening and writing the SQLite history.
- Failure tee is local, failure-only, size bounded, and private. A truncation,
  degraded parser, passthrough marker, or ambiguous RTK result requires a raw
  rerun.
- Aggregate, redacted statistics from 17 prior Codex session files covered 453
  shell executions. The frequency of exact readers, Git inspection, compound
  shell, verification, and explicit output limiting is the reason the policy
  rejects "always prefix commands with RTK".

Current repository state:

- Intake `3` records the bounded install.
- Intake `4` and story `TERMUX-003` record this durable, multi-session
  operationalization.
- RTK is not registered in the Harness inbound tool registry.
- There is no repository-owned RTK product contract, runbook, provenance
  record, canonical configuration template, drift check, or control-plane
  command.

## Authority and scope

- This repository owns Termux operating policy, inventory, runbooks, pinned
  local tooling, and cross-repository procedures.
- Harness owns story lifecycle and registered-tool presence metadata only.
- Git owns the durable RTK contract, provenance, templates, implementation,
  recovery procedure, and validation evidence.
- The deployed files under `~/.local`, `~/.codex`, and `~/.config` remain
  generated user-local state. They must be updated only through an explicit,
  reviewable control-plane operation.
- `./qa/verify` remains the sole repository definition-of-pass.
- RTK output is lossy orientation evidence and can never replace raw
  repository evidence or executable verification.
- Do not read or persist raw transcripts, secret-bearing commands, tokens,
  credentials, cookies, private keys, or unredacted environment values.

## Approach

### Phase 1 — Contract, inventory, and provenance

1. Extend the Termux control-plane product truth with the RTK capability
   boundary.
2. Add a repository-owned RTK maintenance runbook covering:
   - pinned-source discovery and review;
   - native Android build constraints;
   - staging and isolated tests;
   - install, config migration, rollback, and recovery;
   - Codex new-session requirements;
   - prohibition on unattended updates.
3. Record build provenance: upstream tag and commit, source identity, Rust/Cargo
   versions, Android target identity, binary checksum, applied workarounds, and
   verification results.
4. Store canonical accuracy-first policy and runtime configuration as
   secret-free templates. Treat deployed user-global files as materialized
   state and detect drift without silently overwriting user edits.

### Phase 2 — Harness inbound tool registration

Register RTK as an optional external provider, not as Harness core:

```text
name: rtk
kind: binary
command: rtk
capability: command-output-filtering
responsibility: Tool access
```

Use a stable `HARNESS_RUN_ID`, review the semantic changeset, and run
`tool check --name rtk --json`. Registration records availability; it does not
make RTK authoritative, inject Codex instructions, or permit automatic use.

### Phase 3 — Termux control-plane operations

Add a narrow RTK lane beneath `scripts/termux-control`, following existing
entrypoint conventions:

- `rtk status`: report installed version, checksum, source/provenance match,
  deployed-policy/config drift, Codex reference health, telemetry consent, and
  Harness registry status without printing secrets.
- `rtk doctor`: run native-binary, config parsing, raw-recovery, exit-code,
  tracking-sink, tee-permission, and isolated filter checks.
- `rtk update --dry-run`: resolve a candidate release and produce a reviewable
  comparison without changing binary, config, Harness state, or the network
  consent posture.
- An explicit maintenance operation may build and install only a reviewed,
  pinned candidate. It must stage beside the active binary, preserve a
  recoverable previous binary, validate before switching, and restore the
  preceding binary/config on failure.

Do not auto-update at session start, from lifecycle hooks, in CI, or merely
because a newer release exists.

### Phase 4 — Accuracy and privacy fixtures

Build a secret-free synthetic corpus based on aggregate command shapes, not
replayed transcripts. At minimum prove:

- commands requiring exact bytes, complete bodies, all matches, stable JSON,
  checksums, mutation, final Git review, or canonical verification remain raw;
- supported noisy test/build/lint/log commands may be compacted only where the
  policy permits;
- RTK preserves the child exit code;
- stdout/stderr recovery is explicit and usable after truncation or parser
  degradation;
- tracking and telemetry remain absent;
- failure tee artifacts have private permissions and bounded retention;
- source/config changes never rely solely on filtered output;
- an upstream template refresh cannot replace the local policy silently.

### Phase 5 — Update rehearsal and completion

1. Rehearse candidate discovery, source build, isolated test, staged install,
   rollback, and drift detection without changing the active binary.
2. Run focused tests and `./qa/verify --mode targeted`.
3. Record a detailed trace because the work spans external global state,
   provenance, tool registry, and recovery-sensitive update behavior.
4. Move this plan to `docs/plans/completed/`, update the story contract path,
   and complete `TERMUX-003` with fresh proof.
5. Run canonical verification again after lifecycle and changeset mutations.

## Progress

- [x] Initial RTK research, native build, install, and accuracy-first global
      configuration completed.
- [x] Upstream source and Codex integration behavior audited.
- [x] Aggregate/redacted prior-session command patterns analyzed.
- [x] Tracking persistence bug identified and blocked with a verified
      `/dev/null` database sink.
- [x] Intake `3` records the bounded installation.
- [x] User clarified durable maintenance, operations, update, and cross-session
      requirements.
- [x] Intake `4` and in-progress story `TERMUX-003` created for the durable
      integration.
- [x] This active execution plan records the handoff and recovery context.
- [x] Add repository contract, inventory, runbook, provenance, and templates.
- [x] Register and check RTK in the Harness inbound tool registry.
- [x] Add `scripts/termux-control rtk` status, doctor, and safe update lanes.
- [x] Add accuracy, privacy, drift, update, and rollback fixtures.
- [x] Rehearse update and rollback with isolated runtime directories.
- [x] Complete focused proof, canonical consumer integration, and
      pre-lifecycle verification.
- [x] Record the detailed trace and prepare the completed plan.
- [x] Complete story lifecycle with fresh proof.
- [x] Run final verification and review the complete diff/status.

## Last safe boundary

Harness story `TERMUX-003` is `implemented`, points to this completed plan, and
records unit, integration, end-to-end, and platform proof. Contract, inventory,
provenance, templates, runbook, inbound registration, status, doctor,
discovery, rehearsal, synthetic fixtures, and canonical consumer commands are
implemented. The active RTK binary and user-global configuration remain
unchanged.

The exact next action is:

```text
No implementation or lifecycle action remains. Future RTK updates start with
the maintenance runbook and require a newly reviewed pinned candidate.
```

The protected QA blocker was resolved by resuming with the exact process
allowlist `qa/project-commands.json`. No other protected target was authorized
or changed.

## Decisions

- RTK is a repository-managed optional capability but not Harness core.
- Register RTK only in the inbound tool registry with capability
  `command-output-filtering`; never classify it as verification.
- Preserve prompt-level Codex integration. Do not add transparent command
  rewriting unless a later contract and executable evidence prove that approval
  and accuracy semantics remain safe.
- Correctness, raw evidence, repository instructions, and canonical
  verification always outrank token reduction.
- Pin reviewed release identities and build natively for Android; never
  substitute GNU/Linux `aarch64` binaries.
- Monitor new releases, but require explicit review and authorization before
  installation.
- Keep RTK local history and network telemetry disabled.
- Session-derived improvements use redacted aggregate command shapes and
  synthetic fixtures, never raw secret-bearing history.

## Risks

- RTK filters are intentionally lossy and may omit data needed for a later
  decision.
- Upstream updates may change filter semantics, exit codes, config schema,
  telemetry, tracking, tee behavior, or Codex templates.
- RTK `0.43.0` does not honor `tracking.enabled = false` on its recording path.
  Removing the `/dev/null` sink without source review could persist full
  commands and project paths.
- Re-running `rtk init -g --codex` may refresh upstream guidance and must not
  silently replace the local accuracy-first policy.
- Updating global files can affect every future Codex repository and therefore
  needs explicit target resolution, backup, validation, and rollback.
- Existing Codex sessions do not reload changed `AGENTS.md` guidance; activation
  evidence requires a newly launched session.
- Registering RTK in Harness without a consuming workflow provides inventory
  only; it does not enforce policy.

## Recovery

- Raw commands remain the universal operational fallback if RTK is missing,
  untrusted, broken, or ambiguous.
- Do not overwrite the active RTK binary until a staged candidate passes
  isolated proof. Preserve the exact previous binary and checksum until the
  new installation passes doctor and verification.
- Preserve user-global policy/config before an authorized deployment and
  restore them atomically if validation fails. Never print their potentially
  sensitive contents in recovery logs.
- Remove or mark the inbound registry provider missing if RTK is intentionally
  unavailable; do not weaken repository verification to accommodate it.
- If Harness state must be rebuilt, replay reviewed semantic changesets. Never
  copy a live `harness.db`.
- Stop for human direction on source identity mismatch, semantic changeset
  conflict, unexpected global-file drift, telemetry consent change, secret
  exposure, or an update whose rollback target cannot be established.

## External side effects

Observed pre-handoff external state:

- `~/.local/bin/rtk` contains the active native Android RTK `0.43.0` binary.
- `~/.codex/AGENTS.md` references `~/.codex/RTK.md`.
- `~/.codex/RTK.md` contains the global accuracy-first and raw-recovery policy.
- `~/.config/rtk/config.toml` contains the privacy, exclusion, tee, limit, and
  tracking-sink configuration.
- RTK telemetry reports no consent, disabled transmission, and no device salt.
- No RTK history database remains after the tracking-sink smoke test.

No external service, package manager, Android system state, Git remote,
release, deployment, or publication was changed. The ignored Harness database
now records RTK as a present inbound binary provider, with the replayable
operation stored under
`.harness/changesets/rtk-operations-implementation-20260725.changeset.jsonl`.
Candidate discovery contacted only the pinned upstream Git remote. Native build
and staged switch/rollback ran under `$PREFIX/tmp`; active RTK paths were not
changed.

## Validation

Evidence completed before this handoff:

- `cargo build --release --locked` passed for RTK `0.43.0`.
- Upstream tests passed with isolated `XDG_CONFIG_HOME`: 2,237 unit tests
  passed, 8 ignored, and 50 focused integration tests passed.
- An initial unisolated upstream test run had 16 failures because the tests
  consumed the intentional global command-exclusion config; the isolated rerun
  established the actual source result.
- Native Android ELF identity and installed SHA-256 were checked.
- Raw proxy byte equivalence, exit-code preservation, private failure tee,
  telemetry disablement, and absence of persisted history were checked.
- `rtk init --show --codex` reported valid global RTK guidance and `AGENTS.md`
  reference.
- The prior repository `./qa/verify` and
  `./qa/verify --mode targeted` runs passed.

Remaining handoff proof:

- Spec-check passed against `docs/product/termux-control-plane.md`,
  `docs/ARCHITECTURE.md`, `docs/TOOL_REGISTRY.md`, the live work graph, and
  the secret-storage boundary.
- An isolated Harness database rebuilt from 5 semantic changesets and 22
  operations, then reproduced intake `4` and in-progress `TERMUX-003` with the
  correct linked plan.
- `./qa/verify --mode targeted` passed: 57/57 structural checks, policy audit,
  build, 7 unit tests, 9 integration tests, 2 acceptance tests, and coverage.
- Re-run the same canonical command after this validation record, then review
  both RTK semantic changesets and final Git diff/status. Record the final
  result in the continuity checkpoint used by the next session.

Implementation evidence on 2026-07-25:

- `scripts/termux-control rtk status --json` passed every provenance, drift,
  privacy, Codex-reference, telemetry, and Harness-registry check.
- `scripts/termux-control rtk doctor --json` passed canonical config parsing,
  raw stdout/stderr equivalence, child exit-code preservation, isolated
  filtering, private bounded failure tee, absent tracking persistence, and
  disabled telemetry/no-salt checks.
- Live `rtk update --dry-run` resolved `v0.43.0` at the pinned commit and
  reported no newer stable update and no mutations.
- Locked native source rehearsal rebuilt the exact pinned checksum, validated
  Android ELF identity, passed isolated doctor, switched and rolled back the
  temporary binary, and detected/restored a synthetic template replacement.
  It reported `active_paths_changed: false`.
- `python3 -m unittest -v tests.rtk.test_policy tests.rtk.test_control` passed
  10 tests.
- `python3 -m unittest discover -s tests -t . -p 'test_*.py' -v` passed all 28
  repository tests. The first invocation without `-t .` failed four continuity
  imports because it selected the wrong unittest top-level; the corrected
  package-aware invocation passed.
- Pre-lifecycle `./qa/verify --mode targeted` passed 57/57 structural checks,
  policy audit, build, 7 configured unit tests, 9 configured integration
  tests, 2 configured acceptance tests, and continuity coverage.
- After the exact protected QA maintenance resume,
  `qa/project-commands.json` added RTK to build, unit, integration, and
  coverage consumers.
- Focused configured gates passed: build; 7 continuity and 3 RTK unit tests;
  9 continuity and 7 RTK integration tests; 18 continuity and 10 RTK coverage
  executions.
- The new pre-lifecycle `./qa/verify --mode targeted` passed 57/57 structural
  checks, policy audit, build, all configured unit/integration/acceptance
  consumers, continuity coverage, and RTK coverage. RTK consumer tests now run
  inside the sole verification authority.
- Detailed trace `#6` achieved tier 3/3 and supersedes the earlier standard
  trace `#5`.
- The first fresh `story complete` proof exposed changeset filename ordering:
  implementation trace operations sorted before the handoff intake and
  isolated replay failed with `unknown intake uid`. No lifecycle completion
  occurred.
- Renaming the implementation changeset after the handoff restored replay
  order. The focused semantic replay acceptance test passed.
- A second fresh `story complete` ran the complete targeted authority,
  including RTK consumers and semantic replay, passed, and transitioned
  `TERMUX-003` to `implemented`.
- The CLI recreated a changeset fragment from the stable run ID for the final
  completion operation. That exact operation was consolidated into the
  correctly ordered implementation changeset; the fragment was removed.
- Final raw review hardened candidate discovery to peel annotated release tags
  and source rehearsal to reject untracked files. All 10 RTK tests, live
  dry-run discovery, and locked native rehearsal passed again.
- Post-lifecycle semantic replay passed, and final
  `./qa/verify --mode targeted` passed the full structural, policy, build,
  unit, integration, acceptance, continuity coverage, and RTK coverage gates.
