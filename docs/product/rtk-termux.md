# RTK on Termux

## Outcome

The Termux control plane keeps RTK available as a pinned, optional,
accuracy-first output-filtering capability while raw execution and
`./qa/verify` remain universal fallbacks.

## Owned artifacts

- `docs/inventory/rtk.json` identifies ownership and deployed targets.
- `docs/provenance/rtk-termux-build.json` pins source, toolchain, target,
  artifact identity, workarounds, and prior verification.
- `config/rtk/config.toml` is the canonical secret-free runtime template.
- `config/rtk/RTK.md` is the canonical Codex accuracy policy.
- `docs/runbooks/rtk-maintenance.md` defines review, update, recovery, and
  rollback.
- `scripts/termux-control rtk` provides status, doctor, discovery, and isolated
  rehearsal operations.

The files deployed under the user's home directory are not repository truth.
The control plane detects both semantic and byte drift and never overwrites
them from status, doctor, startup, hooks, CI, or dry-run operations.

## Accuracy contract

The default posture is raw execution. RTK is permitted only when a supported
filter is useful and complete output is not required for the next decision.

Raw execution is mandatory for:

- repository instructions, contracts, source, configuration, schemas, and
  exact file bodies;
- all matches, stable JSON, checksums, byte comparisons, and output consumed by
  another command or file;
- compound commands, pipelines, redirects, heredocs, and shell evaluation;
- mutation, installation, publication, final Git status/diff, and canonical
  verification;
- any result with truncation, degraded parsing, passthrough, recovery markers,
  or ambiguity.

Supported noisy test, build, lint, and log commands may be compacted for
orientation. Filtered output never proves correctness. The original command
must be run raw when its exact result drives an edit, report, or pass/fail
claim.

## Privacy contract

- Telemetry stays disabled with no consent and no device salt.
- Local command tracking stays disabled. For RTK `0.43.0`, the database path
  stays `/dev/null` because the recording path does not honor
  `tracking.enabled = false`.
- No raw transcripts, command history, secrets, credentials, cookies,
  environment values, or tee contents enter Git, Harness, status output, or
  traces.
- Failure tee is failure-only, size- and count-bounded, and private. Synthetic
  fixtures use `umask 077`.
- Session-derived improvements use aggregate command shapes and synthetic
  inputs only.

## Update contract

There are no unattended updates. Discovery is read-only and a candidate is not
trusted merely because its semantic version is newer. Maintenance must review
the upstream tag and commit, signature state, `Cargo.lock`, configuration and
privacy semantics, Codex templates, exit-code propagation, tee behavior, and
tracking/telemetry paths.

Builds run natively on Android `aarch64` with `cargo build --release --locked`.
A candidate is staged beside a recoverable previous binary and tested with
isolated XDG directories before any authorized switch. The control-plane
rehearsal switches and rolls back only inside a temporary directory; it cannot
install into the user's active paths.

## Acceptance

- `rtk status --json` reports provenance, drift, privacy, Codex reference, and
  Harness registry health without secret-bearing bodies.
- `rtk doctor --json` proves native execution, config parsing, raw proxy byte
  and exit-code preservation, isolated filtering, private bounded tee, absent
  tracking persistence, and disabled telemetry.
- `rtk update --dry-run --json` reports a reviewable stable-tag candidate and
  makes no local or Harness mutation.
- `rtk rehearse` validates a reviewed candidate, performs a temporary staged
  switch, detects drift, and restores the exact temporary baseline.
- Synthetic policy fixtures prove mandatory-raw and permitted-filter command
  shapes.
- Focused tests and `./qa/verify --mode targeted` pass on the final state.
