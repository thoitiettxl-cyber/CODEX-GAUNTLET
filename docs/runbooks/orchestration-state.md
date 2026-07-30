# Operate Harness orchestration state on Windows

## Authorities

- Harness work graph: lifecycle, runnable state, dependencies, and hierarchy.
- Linked Git plan: intent, progress, decisions, recovery, and validation.
- Git and external targets: actual implementation and side-effect state.
- `qa/verify.ps1`: sole executable definition-of-pass.

## Initialize and inspect

```powershell
& .\scripts\windows-control.ps1 orchestrator init
& .\scripts\windows-control.ps1 orchestrator status
& .\scripts\windows-control.ps1 orchestrator query contract --json
& .\scripts\windows-control.ps1 orchestrator query work-graph --json
```

The ignored default database is `harness.windows.db`. Initialization rebuilds
it from `.harness/changesets/` when no database exists.

## Mutate lifecycle

Set one stable run ID for a logical operation:

```powershell
$env:HARNESS_RUN_ID = 'win-example-001'
& .\scripts\windows-control.ps1 orchestrator story add --id WIN-EXAMPLE --title 'Example Windows change' --verify 'powershell.exe -NoProfile -File qa/verify.ps1 -Mode targeted' --contract-doc docs/plans/active/example.md
```

Use compare-and-set revisions and `--require-runnable` for transitions. Record
dependency or hierarchy edges only when they affect scheduling.

## Snapshot and rebuild

Create snapshots only at an explicit absolute path below the repository or a
unique directory under `$env:TEMP`. To rebuild, first move the existing
database to a separately named recovery file, then run:

```powershell
& .\scripts\windows-control.ps1 orchestrator rebuild
& .\scripts\windows-control.ps1 orchestrator status
```

The controller refuses to overwrite an existing database during rebuild.

## Completion

Generate a current story-linked `WorkContext`, run the canonical CI gate,
validate the resulting receipt, update the plan, and complete the story with the
validated receipt digest. Review the lifecycle-final diff and run the canonical
gate once more. Harness status, doctor, hooks, and plans are never application
pass evidence.
