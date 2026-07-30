# Architecture

## Layers

| Layer | Owner | Artifact | Role |
|---|---|---|---|
| 1 | Harness + project | `AGENTS.md` | Compact entry map |
| 2 | Harness | `docs/` | Product truth, decisions, and plans |
| 3 | Harness | `.agents/skills/` | Repository workflows |
| 4 | Gauntlet | `.codex/` | Native Codex policy and lifecycle adapter |
| 5 | Gauntlet | `qa/`, `gauntlet/` | Canonical verification and offline security |
| 6 | Harness | `.harness-core/`, `scripts/bin/*.exe` | Pinned core, CLI, and provenance |
| 7 | Repository | `scripts/windows-control.ps1` | Native Windows control plane |
| 8 | Repository | Windows CI | Independent final enforcement |
| 9 | Harness + repository | `.harness/changesets/`, `harness.windows.db` | Replayable lifecycle state |

## Ownership

Harness-managed paths change only through the reviewed Harness maintenance
lane. Gauntlet-managed paths change only under explicit Gauntlet maintenance
authority. Product code, tests, infrastructure, and product truth remain
project-owned.

The Harness manifest must never claim `.codex/**`, `qa/**`, or the Windows CI
workflow. An overlap fails closed and requires an explicit architecture
decision.

## One-way verification

```text
Harness WorkContext
        ↓ validated input
Gauntlet policy + qa/verify.ps1
        ↓ sealed VerificationReceipt
Explicit Harness completion reference
        ↓
Repository CI required status
```

Repository CI verified is the final merge authority. Harness owns lifecycle,
readiness, dependencies, hierarchy, and runnable selection. The linked Git plan
owns intent, progress, decisions, recovery, and validation context. The ignored
SQLite database is generated from reviewed semantic changesets.

Gauntlet alone decides executable pass/fail. Lifecycle-only semantic changes
are excluded from the receipt target-state digest so story completion can link
a current receipt without causing a circular scan.

## Native Windows adapters

`scripts/windows-control.ps1` is the human and agent entrypoint. It resolves
repo-local `harness.exe`, `harness-cli.exe`, Python, the Windows database,
and PowerShell verification without using a compatibility shell.

`scripts/gauntlet_policy.py` owns destructive-command, protected-path, and
exact-maintenance decisions. Codex hooks translate native events into that
shared policy contract. `scripts/continuity/lifecycle.py` stores bounded
compaction/resume checkpoints below `LOCALAPPDATA` and reads Harness with a
short timeout; it never mutates story lifecycle.

## Security Intelligence

`gauntlet/security/` owns offline target normalization, knowledge ingestion,
threat-model freshness, discovery, validation, attack-path calibration,
findings, sealed history, and export. `qa/security/` is an internal adapter.
Neither is a second verification authority.

The active platform is native Windows x64. WSL, Git Bash, Linux executables,
mobile binaries, and retired agent adapters are outside the runtime boundary.
