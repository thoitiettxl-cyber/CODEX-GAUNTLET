# 0013 — Vendor CLIProxyAPI Magisk maintenance source

Date: 2026-07-28

## Status

Accepted; supersedes the external-implementation boundary in decision 0012.

## Context

Decision 0012 imported only project memory and deliberately left implementation
in `thoitiettxl-cyber/repository-harness`. The operator clarified that durable
knowledge without build, test, lifecycle, and update tools is insufficient:
`codex-gauntlet-termux` must be able to maintain the module directly.

The imported controller is root-capable and recovery-sensitive. Generated
runtime ZIPs depend on reviewed CLIProxyAPI/glibc/CA inputs, while live config,
OAuth accounts, plugins, and logs must never enter Git.

## Decision

1. Vendor the complete module source under
   `modules/cli-proxy-api-magisk/`, its module/feasibility/staging tests under
   `scripts/tests/`, and the secret-free status helper under `scripts/bin/`.
2. Pin every imported file's SHA-256 and executable mode to source commit
   `323b43cdd5789e6a4f7ce63b0d05ade91ebe0989`.
3. Expose non-root maintenance through
   `scripts/termux-control cli-proxy-api-magisk`; keep root/live commands behind
   explicit operator authorization and the runbook.
4. Keep generated ZIPs, extracted payloads, live config, credentials, plugins,
   logs, backups, and root runtime state untracked.
5. Require focused source, syntax, deterministic archive, update rollback,
   port ownership, unsafe-config, checksum, purge-confirmation, and secret-scan
   proof in addition to `./qa/verify` for implementation changes.

## Consequences

This repository becomes the maintenance owner of the vendored copy and can
review future changes locally. Upstream remains the provenance origin, not an
automatic update authority. A refresh requires explicit source comparison,
updated hashes, focused proof, and final canonical verification.

Root/device lifecycle claims still require fresh authorized live evidence.
Repository tests cannot prove boot, root manager behavior, OAuth, or real
provider routing by themselves.

## Validation

- Byte-for-byte and mode comparison against the pinned source checkout.
- Non-root source-drift and shell-syntax checks.
- Checksum-verified temporary runtime fixture and full default module suite.
- Canonical targeted and final repository verification.
