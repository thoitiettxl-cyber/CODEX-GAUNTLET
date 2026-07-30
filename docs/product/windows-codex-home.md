# Windows Codex home

## Purpose

Provide one self-contained native Windows repository for Codex operation,
Harness orchestration, continuity, policy enforcement, verification, and CI.

## Supported platform

- Windows x64 with native Windows PowerShell.
- A Windows Python interpreter discoverable as `python`.
- Checked-in PE binaries `scripts/bin/harness.exe` and
  `scripts/bin/harness-cli.exe`.
- Git for repository identity and diff evidence.

WSL, Git Bash, Linux or mobile binaries, package installation, elevation, and
user-global Codex configuration are outside the supported runtime.

## Contracts

1. `scripts/windows-control.ps1` is the control-plane entrypoint.
2. `harness.windows.db` is generated local state; the Windows semantic
   changeset is its replay source.
3. Harness core is the official Windows x64 `harness-v0.1.7` asset. CLI
   `0.1.23` is built from the exact pinned tag because that release has no CLI
   asset.
4. Codex hooks invoke repo-local Python handlers through native Windows command
   declarations.
5. `qa/verify.ps1` is the only executable pass/fail authority.
6. Windows CI runs the same verifier and does not fetch release artifacts.
7. Continuity may read Harness with a bounded timeout but never mutates story
   lifecycle.

## Non-goals

The Windows branch does not modify or publish the retired mobile branch,
install software, manage credentials, elevate privileges, or promise binary
interchangeability with another operating system.

## Acceptance

- Both PE binaries match pinned SHA-256 values and execute their expected
  versions.
- Status, doctor, orchestrator query, hooks, continuity, and focused tests run
  natively.
- Active docs and CI describe only the Windows execution lane.
- A current story-linked `qa/verify.ps1 -Mode ci` receipt passes, story
  completion is recorded, and the lifecycle-final canonical gate passes.
