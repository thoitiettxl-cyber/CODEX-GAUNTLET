# Repository Harness on Windows

Harness owns work lifecycle and replayable orchestration state. It never defines
application pass/fail; all executable evidence converges on `qa/verify.ps1`.

## Pinned artifacts

The repository pins `harness-v0.1.7` at commit
`d43b70254308b0e10efed2efbcbe595f1e771f63`.

- `scripts/bin/harness.exe`: official `harness-windows-x64.exe` release
  asset, version `0.1.7`.
- `scripts/bin/harness-cli.exe`: CLI `0.1.23` built from the exact pinned
  source because the release has no CLI asset.

Exact hashes, sizes, build inputs, and source classification live in
`docs/provenance/windows-harness-build.json`.

## Controller and state

Use the native controller:

```powershell
& .\scripts\windows-control.ps1 status
& .\scripts\windows-control.ps1 doctor
& .\scripts\windows-control.ps1 orchestrator init
& .\scripts\windows-control.ps1 orchestrator status
```

The controller sets `HARNESS_REPO_ROOT` and uses `harness.windows.db` unless
an explicit absolute `HARNESS_DB_PATH` is provided. Generated database state
is ignored. Reviewed files under `.harness/changesets/` reconstruct the graph.

Use a stable `HARNESS_RUN_ID` for state-writing commands. Status, contract,
work-graph, and doctor queries are read-only and do not invoke Gauntlet.

## Ownership and updates

`.harness-core/manifest.json` defines Harness-owned repository payload. An
overlap with Codex, verifier, or CI paths fails closed. Normal operation is
hermetic and never fetches a latest release.

`scripts/bootstrap-harness.sh` remains only because it is a checksum-bound
file in the upstream Harness CLI compatibility payload. The Windows controller
never invokes it; `scripts/bootstrap-harness.ps1` is the active bootstrap.

Harness replacement or source rebuild requires the explicit maintenance runbook
at `docs/runbooks/harness-windows-rebuild.md`. Do not permit semantic merge conflicts without human direction.
A rejected or failed staged update must leave the installed pair unchanged. Run
the G + H self-tests and
`qa/verify.ps1` after an accepted maintenance change.

## Handshake

Harness emits a `WorkContext`; Gauntlet validates it and may issue a sealed
`VerificationReceipt`. Harness completion links the validated receipt digest
without interpreting test results. Neither component activates or mutates the
other component's lifecycle.
