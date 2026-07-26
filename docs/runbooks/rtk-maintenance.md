# Maintain RTK on Termux

Use this runbook for RTK inventory, drift diagnosis, candidate discovery,
native source-build review, isolated rehearsal, an explicitly authorized
installation, or rollback. Routine status and doctor operations are read-only.

## Authority and safety

- Repository truth: `docs/product/rtk-termux.md`, inventory, provenance, and
  templates.
- User-global materialized state: the deployed binary, config, Codex policy,
  Codex AGENTS reference, Pi append policy, and absence of the prohibited Pi
  rewrite extension.
- Harness: optional inbound-tool presence metadata only.
- Executable pass/fail: `./qa/verify` only.

Never use a GNU/Linux `aarch64` release artifact on Android. Never run
`rtk init -g --codex` as an update shortcut: it may refresh upstream text and
must not silently replace the local accuracy policy. Never persist transcripts,
command history, secrets, or tee contents in Git, Harness, logs, or evidence.

## Inspect

Run raw:

```bash
scripts/termux-control rtk status --json
scripts/termux-control rtk doctor --json
scripts/termux-control orchestrator query tools \
  --capability command-output-filtering
```

Status compares metadata and parsed secret-free configuration without printing
the deployed bodies. Doctor adds native execution, raw recovery, exit-code,
tracking, telemetry, tee, and isolated filter probes. Stop on provenance,
source, privacy, or unexpected user-global drift; do not overwrite it.
Refreshing persisted presence with `tool check` is a Harness mutation and
requires a stable `HARNESS_RUN_ID`; routine inspection uses the query above.

The reports must include an exact Pi policy match and absence of
`~/.pi/agent/extensions/rtk.ts`. They report only target health, never the
contents of a user-global policy.

## Materialize Pi guidance

Pi's RTK integration is guidance-only. The repository template
`config/rtk/RTK.md` is materialized as
`~/.pi/agent/APPEND_SYSTEM.md`; no Pi package or automatic Bash rewrite
extension is installed.

Before an authorized write, resolve the shared Pi agent directory and inspect
the exact target without printing its body:

```bash
readlink -f "$HOME/.pi/agent"
if test -e "$HOME/.pi/agent/APPEND_SYSTEM.md"; then
  stat "$HOME/.pi/agent/APPEND_SYSTEM.md"
  sha256sum "$HOME/.pi/agent/APPEND_SYSTEM.md" config/rtk/RTK.md
fi
test ! -e "$HOME/.pi/agent/extensions/rtk.ts"
```

An absent target can be created from the reviewed template. If the target
exists and differs, create a mode-`0600` exact backup beside it and stop for
review; never silently replace unrelated append instructions. Reload an
existing Pi session with `/reload`, or start a new one, then run status,
doctor, the focused RTK tests, and canonical verification raw.

## Discover a candidate

Discovery reads stable `vMAJOR.MINOR.PATCH` refs and does not download, build,
install, change configuration, mutate Harness, or opt in to telemetry:

```bash
scripts/termux-control rtk update --dry-run --json
```

A newer version is only a candidate. Review the upstream release diff,
signature state, `Cargo.lock`, minimum Rust version, config schema, filter
semantics, exit-code handling, tee permissions and retention, tracking paths,
telemetry and consent, Codex template changes, and platform support.

Stop if the source identity is ambiguous, the release cannot be pinned, a
rollback binary is unavailable, or the privacy/network posture would change.

## Native build

Clone the official source into a `mktemp -d` directory, check out the reviewed
commit detached, and confirm the exact tag and commit. Do not redefine `HOME`,
`PREFIX`, or `CODEX_HOME`.

Build with the locked graph:

```bash
cargo build --release --locked
file target/release/rtk
readelf -l target/release/rtk
sha256sum target/release/rtk
```

The artifact must be `ELF64`, `AArch64`, and request
`/system/bin/linker64`. Run the upstream tests with isolated
`XDG_CONFIG_HOME` and `XDG_DATA_HOME`; the user's global exclusion config must
not affect source proof.

## Isolated rehearsal

Rehearse a reviewed candidate without changing active state:

```bash
scripts/termux-control rtk rehearse \
  --source /absolute/path/to/reviewed/rtk \
  --expected-commit <40-hex-commit> \
  --expected-sha256 <64-hex-artifact-sha256> \
  --json
```

The command validates the source identity, runs
`cargo build --release --locked`, stages the candidate and current baseline in
a temporary directory, materializes the repository templates into isolated XDG
paths, runs doctor probes, performs a temporary atomic switch, proves drift
detection, and restores the exact temporary baseline. It has no install code
path.

For an already reviewed candidate binary, `--candidate-binary` skips the source
build but retains all staging and rollback checks.

## Authorized installation

This repository intentionally has no unattended or one-command global install
path. After a successful rehearsal, installation is a separate human-reviewed
maintenance operation:

1. Record the active binary checksum and exact config/policy metadata.
2. Create private backups beside explicit target paths without printing file
   bodies.
3. Stage the candidate beside the active binary and validate it there.
4. Atomically switch only `~/.local/bin/rtk`.
5. Materialize templates only if the user has reviewed any detected drift.
6. Run `rtk doctor`, the focused repository suite, and `./qa/verify`.
7. Retain the preceding binary/config until the new state is accepted.
8. Update provenance and review the final Git diff.

Do not perform these steps from CI, lifecycle hooks, session startup, candidate
discovery, or merely because a release is newer.

## Rollback and recovery

If a staged or installed candidate fails:

1. Stop using RTK and run original commands raw.
2. Restore the exact preceding binary atomically and verify its recorded
   checksum.
3. Restore the private config and policy backups only to their exact targets.
4. Confirm telemetry still has no consent, tracking still persists nothing,
   the Codex reference is healthy, and tee data remains private.
5. Run `scripts/termux-control rtk doctor --json` and `./qa/verify`.
6. Record the failure without command bodies, secrets, or tee contents.

If RTK is intentionally unavailable, mark or remove only its inbound registry
entry. Never weaken repository verification or Harness lifecycle to compensate.
