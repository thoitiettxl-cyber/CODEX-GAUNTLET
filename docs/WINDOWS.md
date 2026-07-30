# Native Windows operating profile

## Scope

Branch `win` is a standalone native Windows home for Codex. The repository
executes through Windows PowerShell, the resolved Windows Python interpreter,
and reviewed PE binaries. WSL and Git Bash are not prerequisites or fallback
runtimes.

Branch `rtk` and Git history are recovery sources only. No mobile runtime,
binary, configuration, or state database is consulted by normal Windows
operation.

## Entry points

```powershell
& .\scripts\windows-control.ps1 status
& .\scripts\windows-control.ps1 doctor
& .\scripts\windows-control.ps1 orchestrator status
& .\scripts\windows-control.ps1 continuity status
& .\qa\verify.ps1 -Mode targeted
```

`scripts/windows-control.ps1` binds:

- `scripts/bin/harness.exe` to the official Harness `0.1.7` Windows x64
  release;
- `scripts/bin/harness-cli.exe` to CLI `0.1.23` built from the same pinned
  source tag;
- `harness.windows.db` as the ignored local database unless an explicit
  absolute `HARNESS_DB_PATH` is supplied;
- `.harness/changesets/` as the replayable lifecycle source.

State-changing orchestrator commands require a stable process-scoped
`HARNESS_RUN_ID`.

## Session defaults

- Run from native Windows PowerShell.
- Resolve required commands with `Get-Command`.
- Use `python` only after it resolves to a Windows interpreter.
- Keep temporary files under `$env:TEMP` or the repository.
- Never redefine `HOME`, `USERPROFILE`, `CODEX_HOME`, or `PATH`.
- Do not install packages, elevate privileges, or change user-global Codex
  configuration unless a separate user request explicitly authorizes it.

## Verification and CI

`qa/verify.ps1` delegates to the Python verifier with an argument array.
Functional gates execute through `qa/run-configured.py` without
`shell=True`. Windows GitHub Actions runs the same entrypoint for CI and
scheduled audit.

Hooks use `commandWindows` and repo-local Python handlers. The sandbox,
approval, protected-path, offline security, and Stop-gate contracts remain
fail-closed.

## Harness maintenance

Normal operation is hermetic and never downloads a latest release. Rebuilding
or replacing the pinned binaries is a separate reviewed maintenance action.
Read `docs/runbooks/harness-windows-rebuild.md` first; its script uses a unique
directory under `$env:TEMP`, validates the pinned tag/commit and release
checksum, and does not require elevation.

## Recovery

Repository changes are recoverable by reverting the relevant commit or reading
the retired implementation from branch `rtk`. Database recovery uses the
Windows semantic changeset. Do not use broad reset, clean, or history rewrite
operations as routine recovery.
