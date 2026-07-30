# Upgrade the current Termux control plane to Codex Gauntlet v6

Harness story: `TERMUX-016`

## Outcome

Forward-port Codex Gauntlet v6 into the current `731419f` repository without
replacing its Git history, Android Harness binaries, orchestration state,
session continuity, Pi Gauntlet, RTK, CLIProxyAPI modules, product contracts,
or existing application proof. The final repository must implement the v6
one-way WorkContext-to-VerificationReceipt handshake, precise policy and gate
selection, tiered verification, Security Intelligence, executable acceptance
corpora, and honest operational evidence.

## Current context

- The current repository has 297 tracked files and real consumer commands.
- The reference v6 bundle has unrelated history, only 128 tracked files, no
  consumer application surface, a metadata-only Harness shim, and cannot be
  merged or used as the destination repository.
- The checked-in Android/aarch64 Harness 0.1.7 and CLI 0.1.23 are the current
  lifecycle authority and must remain provenance-checked.
- The reference implementation is useful for schemas, fixtures, gate shapes,
  documentation, and negative regression evidence only.
- Independent review found two blockers that must not be copied: Termux-broken
  `/usr/bin/env` entrypoints and forgeable pass receipts with unverified string
  evidence.

## Scope

- Preserve every current product/runtime surface unless an existing accepted
  product decision already retired it.
- Add versioned WorkContext and VerificationReceipt contracts.
- Make receipt evidence structured, sealed, issuer-bound, and validated before
  a real Harness lifecycle completion.
- Separate Harness complexity classification from Gauntlet change/security
  classification.
- Add normalized-operation policy, stable rule IDs, targets, reasons, and
  remediation while preserving ordinary read-only behavior.
- Add targeted, stop, ci, and audit modes under the single `./qa/verify`
  authority.
- Add offline Security Intelligence with meaningful threat-model freshness,
  honest parsed/fallback/unsupported coverage, validation dispositions,
  calibrated attack paths, sealed reports, history, and human-only triage.
- Add executable C/H/P/S/O acceptance scenarios plus all existing application
  tests and Termux proofs.

## Non-goals

- Replacing the repository with the standalone v6 scaffold.
- Replacing Android artifacts with GNU/Linux aarch64 binaries.
- Removing Pi, continuity, RTK, Magisk, plugins, or orchestration history as a
  side effect of the Gauntlet upgrade.
- Treating metadata, source-string checks, proof gaps, or a zero-candidate scan
  as application proof.
- Installing or invoking an external security scanner.

## Approach

1. Freeze and verify the v3 baseline and current Harness graph.
2. Implement and adversarially test the handshake before wiring completion.
3. Port normalized policy, classifiers, and deterministic gate selection.
4. Extend `qa/verify` to four tiers without losing consumer commands.
5. Port and harden Security Intelligence, fixtures, contracts, and metrics.
6. Update documentation, ownership, compatibility, and CI.
7. Run focused proof, the strengthened 80-scenario suite, application tests,
   Termux ci/audit, clean-clone proof where practical, and final diff review.

## Progress

- [x] Inspect current v3 and reference v6 primary sources.
- [x] Verify the reference ZIP/bundle and identify portability/evidence gaps.
- [x] Record the executable v3 workspace baseline and clean-clone gap.
- [x] Implement secure handshake contracts and receipt validation.
- [x] Implement precise policy/classification and tiered verification.
- [x] Integrate Security Intelligence and strengthened corpora.
- [x] Update docs, CI, compatibility, and ownership contracts.
- [x] Complete all executable validation and receipt-linked lifecycle closure.

## Last safe boundary

The forward-port is implemented behind the existing Termux `./qa/verify`
entrypoint. The v3 regression suite passes 65/65, the strengthened v6 acceptance
suite passes 80/80, v6 unit discovery passes 30/30, policy audit passes, and all
declared consumer build/unit/integration/acceptance/coverage commands execute.
Threat-model freshness is current at digest
`fdde5eae2306d7d698f28ed2940222ce80b9816c18c4c62901880cfed4764187`.

The first repository audit correctly failed after discovering that repository
target enumeration used `rglob` and therefore scanned ignored Go toolchains and
cache payloads. Fifty-three of 54 candidates came from ignored `.cache` paths;
the remaining candidate was the canonical configured-command runner's
`shell=True`. Repository discovery now uses Git-visible tracked plus
non-ignored untracked files, with a regression fixture, and the runner executes
normalized argv with only a bounded repository-local `mkdir -p` prelude. The
rerun `./qa/verify --mode audit` passed with scan
`20260729T172751Z-731419f6c0-c09c4f136f`, zero candidates, zero selected proof
gaps, and story-linked receipt
`vr-8d251c3c07e7df7fee7923d61849d523`.

A final-snapshot temporary clone rebuilt `harness.db` from 26 semantic
changesets/146 operations, passed `harness doctor`, and passed
`./qa/verify --mode ci` with zero candidates, zero proof gaps, and receipt
`vr-a0f25db04a3f2d093dbcede465f398ea`. `TERMUX-016` remains `in_progress`; the
workspace CI WorkContext then produced zero candidates, zero proof gaps, and
receipt `vr-3460afcef0b656da21a9c0183fb6a816`; the Harness adapter validated that
receipt as current and linked to `TERMUX-016`.

The first atomic `story complete` attempt exposed a nested-writer regression:
two contract fixtures queried the live Harness graph while the parent
completion transaction held Android's exclusive writer lock. The attempt was
interrupted before lifecycle mutation, `harness doctor` confirmed a clean
transaction, and the fixtures were changed to use deterministic mocked graph
state. A lock-held regression run then passed all 65 self-tests and 30 v6 unit
tests within explicit timeouts. Detailed trace 45 records the diagnosis and
recovery. The second `story complete TERMUX-016 --json` ran fresh CI, passed
with zero candidates and zero proof gaps, emitted receipt
`vr-425709a266c7b74fdf168dfd5a9dfc51`, and atomically moved the story to
`implemented`.

The post-lifecycle specification review then found that the 80-scenario v6
suite was executable but had only been run as focused evidence, outside the
canonical verifier's command records. The suite now has a fail-closed CLI,
uses checksum/provenance validation instead of Android binary execution in
cross-platform CI, and runs as the `v6-acceptance` command whenever `selftest`
is selected. Policy audit and verifier contract tests enforce that wiring.
Both native Termux and simulated cross-platform runs pass 80/80.

Final raw-diff review found one additional final-worktree edge case: policy
audit combined tracked and changed paths without removing files deleted from
the worktree, then attempted to read every path. A legitimate deletion could
therefore crash the audit, while new untracked manifest/secret paths were not
covered by checks that still iterated only tracked files. Policy audit now
derives the current Git-visible path set, excludes deleted paths and symlinks
from content inspection, and applies final-worktree checks to new files. The
verifier contract suite includes direct deleted/untracked-path and configured
argv regression proof.

The first canonical rerun after that correction exposed a separate false-pass
path in the legacy consumer coverage command. Python's stdlib `trace` CLI
catches `SystemExit`, so a failed `unittest` run was printed as `FAILED` while
the wrapper returned zero and the verifier initially minted a pass receipt.
That receipt is rejected as completion evidence. The continuity parity fixture
now exercises both runtime adapters under the same deterministic held-lock
condition, and the canonical verifier independently fails closed when coverage
output contains a unittest failure despite a zero wrapper status. Focused
instrumented continuity proof and the new verifier regression both pass.

## Decisions

- Start from current HEAD; do not merge either the standalone v6 history or the
  saved v5 branch.
- Keep the verified Android source-build Harness lane. Production readiness on
  Termux means pinned upstream source/SHA, reviewed Android patch, reproducible
  payload manifest, checksum, doctor, integration proof, and CI—not an
  unavailable Linux artifact or metadata shim.
- A local digest proves integrity, not issuer authenticity. A pass receipt must
  be minted through the canonical verifier with structured command-result
  evidence and validated against sealed evidence before lifecycle completion.
- Fallback lexical discovery may generate candidates but cannot independently
  create a blocking high/critical finding.
- Repository audits enumerate Git-visible files rather than ignored local
  caches, generated toolchains, databases, or bytecode.
- Configured consumer commands execute as argv; the only supported compound
  form is a validated `.qa-artifacts/` `mkdir -p` prelude.
- Existing application commands remain mandatory; no scaffold-style
  `application_present=false` downgrade is allowed.

## Risks

- Policy changes can false-block ordinary inspection or miss protected writes.
- Handshake mistakes can corrupt lifecycle state or accept fabricated proof.
- Security discovery can repeat v5 noise and severity overclaiming.
- Verification refactoring can silently drop current product gates.
- Harness-owned and Gauntlet-owned paths can overlap during integration.
- Generated artifacts can invalidate their own target/dirty-state digests if
  repository and ignored-state boundaries are not explicit.

## Recovery

- Keep each phase as a coherent reviewable diff on top of `731419f`.
- Do not reset or rewrite history; revert only exact v6 changes if a phase fails.
- Preserve current Android Harness binaries and provenance files until the new
  compatibility checks pass against them.
- Keep v5 and standalone v6 sources as read-only references; never use them as
  rollback authorities.
- If lifecycle proof fails, leave `TERMUX-016` in progress and record the exact
  failed command and last valid receipt rather than forcing completion.

## External side effects

- Harness story and semantic changeset mutations use stable run ID
  `codex-gauntlet-v6-20260729`.
- No network, deployment, publishing, root operation, package installation, or
  external service mutation is authorized by this plan.

## Validation

- Baseline and final `scripts/bin/harness doctor` on Termux.
- Focused contract tests that reject forged receipts, nonexistent stories,
  stale targets, stale policy, missing evidence, and lifecycle loops.
- Existing build, unit, integration, acceptance, coverage, mutation, Harness,
  continuity, Pi, RTK, Magisk, and plugin proof selected by repository truth.
- Strengthened C/H/P/S/O acceptance corpus, including dependency and
  multi-language/fallback cases.
- `./qa/verify --mode targeted`, `--mode ci`, and `--mode audit` on final state.
- Final receipt target/diff review, clean tracked worktree after generated
  evidence is excluded correctly, required CI status when available, and
  explicit report of any remaining external proof.

Current executable evidence:

- `python3 -m unittest discover -s qa/tests -v` — 35/35 pass.
- v6 C/H/P/S/O acceptance — 80/80 pass.
- `python3 qa/policy_audit.py` — pass.
- `scripts/bin/harness doctor` — pass on the workspace and rebuilt clone.
- Final-snapshot clone bootstrap and `./qa/verify --mode ci` — pass with zero
  candidates and zero proof gaps.
- `./qa/verify --mode targeted --work-context ...` — pass with zero proof gaps
  before the final audit-scope correction; a final-state rerun remains.
- `./qa/verify --mode audit --work-context ...` — pass with zero proof gaps and
  a sealed zero-candidate repository report after the correction.
- `./qa/verify --mode ci --work-context ...` — pass with zero proof gaps;
  `scripts/gauntlet_handshake.py validate-receipt --story TERMUX-016` validated
  receipt `vr-3460afcef0b656da21a9c0183fb6a816`.
- Lock-held nested-completion proof — 65/65 self-tests and 30/30 v6 unit tests
  pass without querying the parent transaction database.
- Canonical v6 acceptance wiring — native Termux and cross-platform 80/80 pass;
  `./qa/verify` records the suite as `v6-acceptance`.
- `story complete TERMUX-016 --json` — fresh CI pass, receipt
  `vr-425709a266c7b74fdf168dfd5a9dfc51`, story status `implemented`.
- External required GitHub status is not available from this local execution;
  local evidence does not claim repository CI mergeability.
