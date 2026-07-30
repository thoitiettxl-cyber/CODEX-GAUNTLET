# Codex Gauntlet v6 + Repository Harness for Windows

This branch is a native Windows home for Codex. PowerShell, the resolved Windows
Python interpreter, and reviewed PE binaries are the only active execution
lane. It does not require WSL, Git Bash, Termux, or Android artifacts.

## Included surfaces

- a compact repository entry map in `AGENTS.md`;
- Windows-native Codex hooks and bounded session continuity;
- orchestration-first work state through Repository Harness;
- one verification authority exposed by `qa/verify.ps1`;
- offline policy and Security Intelligence checks;
- sealed `WorkContext → VerificationReceipt` evidence;
- Windows GitHub Actions enforcement;
- 80 scenarios across V6 core, handshake, precision, security, and operations,
  plus focused consumer and policy tests.

## Pinned Harness

The repository pins
[`harness-v0.1.7`](https://github.com/hoangnb24/repository-harness/releases/tag/harness-v0.1.7).

- `scripts/bin/harness.exe` is the official
  `harness-windows-x64.exe` release asset, version `0.1.7`, SHA-256
  `9948fa714ee8e7731c1691f3d84649832571b882d009aaa0c511a0c82086754c`.
- The release does not publish `harness-cli.exe`. The checked-in CLI is version
  `0.1.23`, built from the exact pinned tag commit and verified against
  `docs/provenance/windows-harness-build.json`.

Normal operation never downloads the latest Harness. Status, doctor,
verification, and CI use only checked-in artifacts.

## Start

Run from native Windows PowerShell:

```powershell
& .\scripts\windows-control.ps1 status
& .\scripts\windows-control.ps1 doctor
& .\scripts\windows-control.ps1 orchestrator init
& .\scripts\windows-control.ps1 orchestrator status
& .\qa\verify.ps1 -Mode targeted
& .\qa\verify.ps1 -Mode ci
```

State-changing orchestrator commands require a stable process-scoped
`HARNESS_RUN_ID`. The generated `harness.windows.db` stays ignored; the
Windows semantic changeset is the replay source.

## Boundaries and recovery

This repository does not install packages, elevate privileges, change
user-global Codex configuration, or publish releases as part of normal
operation. Branch `rtk` and Git history remain the recovery source for the
retired mobile environment; they are not runtime dependencies of branch
`win`.

Read `docs/WINDOWS.md` for operating details and
`docs/runbooks/harness-windows-rebuild.md` before any Harness maintenance.

`qa/verify.ps1` is the only application definition-of-pass. Harness metadata,
hooks, and agent statements are never substitutes for executable evidence.
