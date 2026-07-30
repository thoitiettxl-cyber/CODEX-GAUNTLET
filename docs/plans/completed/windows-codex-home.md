# Windows Codex home

Harness story: `WIN-002`

## Objective and non-goals

Turn branch `win` into a native Windows control plane for Codex. The active
repository identity, runtime entrypoints, verification commands, Codex hooks,
Harness binaries, documentation, and CI must all describe and exercise Windows
behavior without depending on Termux, Android, RTK, Pi, Magisk, WSL, Git Bash,
or Linux executables.

This migration does not rewrite or publish branch `rtk`, install Windows
packages, elevate privileges, change user-global Codex configuration, or claim
that Windows and Android artifacts are interchangeable. Git history and branch
`rtk` remain the recovery source for the retired platform-specific surfaces.

## Evidence baseline

- Confirmed: branch `win` remains based on `62833bf`, the same revision as
  `origin/rtk`; its worktree now contains the in-progress Windows migration.
- Confirmed: the Codex hooks, canonical wrapper, configured consumer commands,
  continuity path, and Harness integrity checks have been converted to native
  Windows candidates in the worktree. They still require final focused and
  canonical verification.
- Confirmed: native Windows PE builds of Harness `0.1.7` and Harness CLI
  `0.1.23` exist in the worktree and execute successfully. Harness `0.1.7` is
  the official Windows release artifact; Harness CLI `0.1.23` was built from
  the repository-pinned source because that release has no CLI asset.
- Confirmed from the current OpenAI Codex manual fetched on 2026-07-30: Codex
  supports native Windows PowerShell and sandbox operation; command hooks accept
  a Windows-only `commandWindows` override; WSL is an optional Linux environment,
  not a prerequisite for native Windows operation.
- Confirmed: `harness.windows.db` has been rebuilt from the ordered Windows
  semantic changesets; its work graph contains only `WIN-002`, linked to this plan and in
  `in_progress`. Any WorkContext or receipt created before the reset remains
  stale and cannot prove the current worktree.

## Gap matrix

| Capability | Current state | Target and acceptance signal | Priority / dependency |
|---|---|---|---|
| Repository identity | `codex-gauntlet-termux` and Termux product contract | Windows identity in `qa/repository-identity.json`, README, architecture, and product docs | P0; defines every other boundary |
| Control plane | Termux Bash entrypoint is authoritative; partial untracked PowerShell wrapper exists | `scripts/windows-control.ps1` is the documented native entrypoint and reports healthy Windows binaries | P0; required for orchestration and proof |
| Codex hooks | Absolute Termux interpreter paths and Bash command substitution | Native Windows commands execute repo-local Python handlers with no shell substitution | P0 security boundary |
| Verification | `qa/verify` and functional gates depend on Bash/POSIX commands | `qa/verify.ps1` delegates to the same Python authority; configured gates use argv-based Python execution on Windows | P0; completion gate |
| Harness integrity | Checker validates Android ELF and Android patch | Checker validates pinned PE artifacts and Windows provenance; Android patch and binaries are absent | P0; verification prerequisite |
| Active products | RTK, Pi, Magisk, Android plugin products remain active | Active Windows branch contains only Codex continuity, Gauntlet, Harness, and Windows operation | P1 after verification path is viable |
| CI | Ubuntu/Bash-only workflow | Windows runner executes the canonical PowerShell authority | P1; independent enforcement |
| Durable state | Termux stories/changesets and an obsolete completed Windows report define replay | Windows-only semantic changeset reconstructs the active work graph; stale completion claims are removed or marked superseded | P1; recovery and handoff |

## Work units and sequencing

1. Establish Windows identity and recovery boundaries in this plan, a new
   product contract, architecture decision, Harness story, and semantic
   changeset.
2. Make the Windows Harness/controller/integrity path independently runnable,
   preserving pinned source identity and exact hashes.
3. Convert Codex hooks, policy audit, lock handling, and canonical verification
   to native Windows; add focused Windows tests before retiring old paths.
4. Remove active Termux/Android/RTK/Pi/Magisk code, tests, documentation,
   binaries, and replay state from branch `win`; adjust verification selection
   to the remaining product surface.
5. Replace Ubuntu-only CI with Windows CI, review the complete diff, run focused
   proof, then run `powershell.exe -NoProfile -File qa/verify.ps1 -Mode ci`.
6. Record exact evidence and recovery context, move this plan to `completed/`,
   complete `WIN-002` with fresh proof, and rerun the canonical gate after the
   lifecycle-final diff.

## Decisions and constraints

- Windows is the only active runtime target on branch `win`; WSL and cross-
  platform skips do not count as native evidence.
- PowerShell scripts pass arguments as arrays and Python code uses
  `subprocess` without `shell=True` for repository verification.
- The existing security baseline remains: workspace isolation, human-reviewed
  approval in repository config, disabled sandbox network, hooks enabled, and
  one verification authority.
- Retiring tracked files on `win` is reversible through Git and branch `rtk`.
  No user-global file, credential, package, service, or external repository is
  changed.

## Progress

- [x] Created branch `win` at `62833bf` and preserved the existing worktree.
- [x] Inspected repository workflow, architecture, product contracts, Windows
  artifacts, current hooks, verifier, and official Codex Windows guidance.
- [x] Registered and activated Harness story `WIN-002`; rebuilt the Windows
  database so the work graph contains only this story.
- [x] Installed and pinned native PE artifacts for Harness `0.1.7` and Harness
  CLI `0.1.23`; converted the controller, integrity checker, hooks, continuity,
  and most verification paths to Windows.
- [x] Retired Termux/Android/RTK/Pi/Magisk runtime surfaces and Android replay
  state from branch `win`.
- [x] Rewrote the authoritative product, workflow, architecture, Harness,
  continuity, quality, Windows operation, decision, plan, and runbook surfaces;
  bound CI to Windows and removed the final empty Pi adapter directory.
- [x] Passed consumer unit, integration, acceptance, and coverage gates; Harness
  integrity, policy audit, config audit, continuity acceptance, and the 65-case
  G + H self-test pass on native Windows.
- [x] Pass focused proof and canonical CI verification.
- [x] Finalize plan and Harness lifecycle with a fresh receipt.

## Last safe boundary

Branch `win` contains the in-progress native Windows migration. The local
`harness.windows.db` graph contains only `WIN-002` in `in_progress`. Native
Harness/CLI version and checksum checks pass. Consumer unit, integration,
acceptance, and coverage gates pass; Harness integrity, policy audit, the
65-case G + H self-test, the 80-case V6 suite, and canonical targeted proof have
all passed on native Windows with zero proof gaps. A story-linked canonical CI
run also passed every executable gate and emitted receipt
`vr-82a0bd449fb7ea3125fda1ea00a38525`, but the receipt became stale before
validation because the user temporarily changed
`.codex/config.toml:sandbox_workspace_write.network_access` from `false` to
`true` at 2026-07-30 08:21:17 UTC to use Internet access. The change was not
made by the verifier or this implementation workflow. The required checked-in
value has been restored to `false`, and that stale receipt must not be used for
completion.

The next CI attempt emitted failing receipt
`vr-5dd9bef7b99ff6d999e3626c05c0a1c6`: H18 reproduced a semantic replay
conflict because filename ordering applied the revision-3 `freshness` update
before the revision-2 `validated` update. The three update changesets now use
explicit `01`, `02`, and `03` filename prefixes without changing their
contents. A fresh temporary rebuild applied all four Windows changesets and its
complete work graph, including revision and verify command, exactly matched the
live graph; the focused Harness acceptance self-test passes 22/22. No current
passing canonical receipt existed at that boundary.

After recording the user's intentional temporary network toggle, canonical
targeted verification passed with receipt
`vr-420a803365cf4632afbb2066af80b0d7`. Story-linked canonical CI then passed
with WorkContext digest
`3aeafab02bb3339f08b297b44e8094b608c8f2e83e883268b05a7614f4c96834`
and receipt `vr-a6054b5ada150b58537651166d1b30b1` (receipt digest
`651ffbede06b4c97a6ae5be8f3cba3bb08c3dd1ef4ecac8587e5f8c367cd48d9`).
Receipt validation against the current repository and `WIN-002` passed with
zero proof gaps, and the config hash remained unchanged throughout CI. Moving
this plan to `completed/` changes the target diff, so that receipt is retained
as the pre-finalization boundary rather than reused as final completion proof.

Final-target canonical CI then passed with WorkContext digest
`b11a285dfba0228ea318db607d895830316bb9d9f3db4bb1933228b84b5ad200`
and receipt `vr-9ddafa022c18ffedeac90c5d9b81a6b2` (receipt digest
`20608591af740843483588c432cc85e0789f0bb9ade1b079c25ef50264fe4de0`).
The receipt validated current with zero proof gaps before and after the
lifecycle-only receipt-link update. `story complete` validated that sealed
receipt and transitioned `WIN-002` to `implemented` at graph revision
`29f917916b3b6c87c1684c113c4a0dea67fa00c04bb75cab67f02885c7bdf89d`.
The lifecycle-final canonical gate is the only remaining operation; its runtime
receipt belongs in the final handoff, and no tracked mutation may follow it.

## Risks and recovery

- Broad retirement can hide a still-needed dependency. Search all remaining
  tracked paths for platform terms after each removal and require the canonical
  verifier to fail closed on empty gates.
- Hook conversion changes a security boundary. Keep the Python policy core,
  add Windows command-shape tests, and do not weaken approvals or sandboxing.
- Generated `harness.db` contains prior Termux state. Do not treat it as
  authoritative; validate replay from the Windows semantic changeset before
  completion.
- Recover code and historical artifacts from branch `rtk` or revision
  `62833bf`; never use a broad reset or clean operation.

## External side effects

No external mutation is authorized or planned. The only durable state changes
are inside branch `win` and the ignored local Harness database.

After the first story-linked CI pass, the user intentionally changed the
repository Codex network setting to `true` for temporary Internet access. The
required checked-in value was restored to `false`; no network action or
credential use was performed by this workflow. Any temporary network toggle
during proof invalidates the current WorkContext and receipt, so emit fresh
evidence after restoring the baseline.

## Validation

- Native version/hash checks for `scripts/bin/harness.exe` and
  `scripts/bin/harness-cli.exe`.
- Focused hook, policy, continuity, verifier, and Harness integrity tests.
- Search proving active Windows source contains no Termux/Android/RTK/Pi/Magisk
  runtime dependency, with explicit allowlisting only for migration/history
  text that remains intentionally documented.
- `powershell.exe -NoProfile -File qa/verify.ps1 -Mode targeted`.
- `powershell.exe -NoProfile -File qa/verify.ps1 -Mode ci` with a current
  story-linked WorkContext and sealed VerificationReceipt.
