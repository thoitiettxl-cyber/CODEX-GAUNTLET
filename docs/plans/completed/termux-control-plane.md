# Establish the Termux control plane

## Current context

This repository already combines Repository Harness and Codex Gauntlet, but it
ships a non-executable scaffold adapter pinned to an obsolete CLI-only release.
The workspace itself is not currently a Git checkout.

## Approach

Adopt the official core from `harness-v0.1.7`, build both Rust executables
natively on Termux, record reproducible provenance, and make this repository the
documented entrypoint for Termux and repository operations.

## Progress

- [x] Read the local workflow, product, architecture, and quality contracts.
- [x] Read the upstream Repository Harness README.
- [x] Build `harness` and `harness-cli` from the pinned source on Termux.
- [x] Adopt the current repository into the official Harness 0.1.7 core state.
- [x] Add the operational entrypoint and reproducible build lane.
- [x] Update Gauntlet compatibility checks.
- [x] Run mandatory verification and review the final changes.

## Decisions

- `harness-v0.1.7` at commit
  `d43b70254308b0e10efed2efbcbe595f1e771f63` is the source of truth.
- The tag contains `harness 0.1.7` and compatibility CLI `harness-cli 0.1.23`;
  both are built because they serve different roles.
- Termux updates rebuild from a pinned source. Upstream self-update rejects
  `android/aarch64`, so Linux release assets must not be substituted.
- The Android compatibility patch replaces the unsupported shared epoch lock
  with an exclusive lock, preserving safety by serializing CLI operations.
- `./qa/verify` remains the only definition of pass.

## Risks

- The upstream core test suite has one platform-assumption failure:
  `release_handoff::rejects_a_candidate_that_does_not_match_its_release_checksum`
  reaches the intentionally unsupported `android/aarch64` self-update branch.
- Without `.git`, change classification is conservative and Git-based diff
  review is unavailable until the workspace is initialized or cloned.

## Recovery

The previous scaffold `.harness-core` was retained temporarily at
`/data/data/com.termux/files/usr/tmp/tmp.phpFRVSMEc/harness-core-scaffold`.
Rebuilding the installed executables is deterministic at the source identity
level through `scripts/build-harness-termux`.

## Validation

- `cargo build --locked --release --workspace`: passed for both Android ARM64
  binaries.
- `cargo test --locked --package harness-cli`: all 99 tests passed after the
  Android lock patch.
- `cargo test --locked --workspace`: all reached tests passed except the known
  upstream self-update platform assumption for unsupported `android/aarch64`.
- `scripts/termux-control doctor`: passed.
- `./qa/verify --mode targeted`: passed, including all 34 structural checks and
  the policy audit.
- `bash -n` and Python compile checks: passed.
- Installed artifact checksums match the recorded provenance.

The final review used the retained pre-change scaffold manifest and explicit
file inspection because this workspace has no `.git` metadata.
