# Rebuild Harness on Termux

Use this runbook only for an explicitly authorized Harness maintenance change.
The build replaces checked-in binaries and may replace the checked-in schema
bundle, so prepare the recovery path before running it.

## Preconditions

- Run on Termux for Android `aarch64`.
- Start from a clean Git worktree and record the current commit.
- Review the pinned repository, tag, commit, and Android patch in
  `scripts/build-harness-termux`.
- Ensure `git`, `cargo`, `rustc`, `install`, and `sha256sum` are available.
  The recorded build used Rust and Cargo 1.96.1; a different toolchain requires
  provenance and compatibility review.
- Ensure enough temporary storage is available for a locked Rust workspace
  build.
- Provide network access to clone the pinned source and fetch any uncached
  locked Cargo dependencies.

Record the recoverable starting point:

```bash
git status --short
git rev-parse HEAD
sha256sum scripts/bin/harness scripts/bin/harness-cli
```

Stop if the worktree is not clean. Do not overwrite unrelated local work.

## Rebuild

The maintenance flag confirms that the pinned source identity and recovery
steps have been reviewed:

```bash
CODEX_GAUNTLET_MAINTENANCE=1 scripts/termux-control rebuild-harness
```

The script checks out the pinned commit, verifies and applies the reviewed
Android locking patch, runs the upstream CLI tests, builds the locked
workspace, verifies the pinned CLI payload manifest, and installs the complete
Core Plus CLI payload: static compatibility files, two binaries, and schemas.

## Focused proof

Review every resulting file before updating recorded provenance:

```bash
git status --short
git diff --stat
git diff -- scripts/schema
scripts/bin/harness --version
scripts/bin/harness-cli --version
sha256sum scripts/bin/harness scripts/bin/harness-cli
scripts/termux-control doctor
```

If the artifacts intentionally changed, update
`docs/provenance/termux-harness-build.json` and `qa/compatibility.json` from the
reviewed build output. Do not accept an unexpected tag, commit, version, schema
set, or checksum.

Finish with:

```bash
./qa/verify --mode targeted
git diff --check
git diff
```

CI remains the final mergeability check.

## Recovery

If the build or installation fails before the change is accepted, restore only
the rebuild targets from the recorded starting commit:

```bash
grep -Ev '^(#|$)' scripts/harness-cli-install-files.txt |
  xargs git restore --source=HEAD --
git restore --source=HEAD -- scripts/bin/harness scripts/bin/harness-cli scripts/schema
```

Then confirm recovery:

```bash
git status --short
scripts/termux-control doctor
./qa/verify --mode targeted
```

If the starting worktree was not clean, stop and recover with human direction;
do not use a broad reset or discard unrelated changes. If an accepted Harness
upgrade later needs reversal, revert its Git commit rather than restoring an
arbitrary older binary.
