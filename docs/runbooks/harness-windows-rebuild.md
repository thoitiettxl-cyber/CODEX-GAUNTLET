# Rebuild Harness on Windows

Use this runbook only for an explicitly authorized Harness maintenance change.
It stages the native Windows PE pair and replaces it only after validation.

## Preconditions

- Run in native Windows PowerShell without elevation.
- Review the repository, tag, commit, target, and exact destination files in
  `scripts/build-harness-windows.ps1`.
- Resolve `git`, `cargo`, and `rustc` with `Get-Command`.
- Review `git status --short`.
- Use process-scoped maintenance authorization; never persist it globally.

The recorded CLI build used Rust/Cargo `1.92.0` for
`x86_64-pc-windows-msvc`. A different toolchain requires a provenance and
checksum review.

## Rebuild

```powershell
$env:CODEX_GAUNTLET_MAINTENANCE = '1'
& .\scripts\build-harness-windows.ps1
```

The script uses a unique directory below `$env:TEMP`, checks out the exact
pinned commit, verifies the payload manifest, runs upstream CLI tests, builds
the locked release with reproducibility flags, downloads the official core
asset and checksum, validates staged versions, and only then copies both files
into `scripts/bin/`.

## Focused proof

```powershell
& .\scripts\bin\harness.exe --version
& .\scripts\bin\harness-cli.exe --version
Get-FileHash -Algorithm SHA256 .\scripts\bin\harness.exe
Get-FileHash -Algorithm SHA256 .\scripts\bin\harness-cli.exe
python .\qa\check_harness.py --skip-doctor-command
```

Compare versions, sizes, and hashes with
`docs/provenance/windows-harness-build.json`, then run `qa/verify.ps1`.

## Recovery

If staging or validation fails, the installed pair is unchanged. If an accepted
copy later proves invalid, revert only the commit that changed
`scripts/bin/harness.exe`, `scripts/bin/harness-cli.exe`, and their
provenance. Do not use a broad reset or clean operation.
