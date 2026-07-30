# Codex Gauntlet v6 + Repository Harness for Termux

The operating control plane for this Termux environment and its repositories,
implementing the one-way **WorkContext → VerificationReceipt** architecture
without replacing the existing Termux control plane or product surfaces.

## What is implemented

- compact `AGENTS.md` entry map;
- repository knowledge, decisions, and durable plans under `docs/`;
- orchestration-first intake, work graph, trace, and semantic replay through
  the pinned Harness CLI;
- ten repository skills under `.agents/skills/`, including explicit security
  workflows;
- Codex sandbox and lifecycle hooks under `.codex/`;
- a single verification authority: `./qa/verify`;
- Harness provenance and compatibility checks;
- ownership-aware policy audit;
- normalized-operation policy with stable rule IDs and remediation;
- independent complexity and security classification;
- targeted, Stop, CI, and repository-audit verification tiers;
- offline Security Intelligence with meaningful threat-model freshness,
  validation disposition, calibrated attack paths, stable findings, sealed
  reports, human-only triage, and JSON/CSV/SARIF export;
- structured, sealed verifier evidence and issuer-bound receipts;
- a hermetic GitHub Actions workflow that never downloads the latest Harness;
- 80 scenarios across Core, Handshake, Precision, Security, and Operational
  integrity, plus the preserved v3/Termux regression suite.

## Native Termux tools

The repository pins upstream tag `harness-v0.1.7` and builds its Rust tools
natively for `aarch64-linux-android`. The tag provides `harness 0.1.7` and
`harness-cli 0.1.23`. The complete Core Plus CLI payload is installed: the
19-file repository core, 23-file compatibility bundle, native binaries, and 14
schema migrations.

Upstream self-update does not support `android/aarch64`. Use
`scripts/termux-control rebuild-harness` to rebuild from the pinned tag; never
substitute a GNU/Linux release binary.

The rebuild lane requires explicit maintenance authorization:

```bash
CODEX_GAUNTLET_MAINTENANCE=1 scripts/termux-control rebuild-harness
```

Read the [Harness rebuild runbook](docs/runbooks/harness-rebuild.md) before
using the maintenance lane. It records prerequisites, recovery, and required
proof.

## Optional auxiliary tools

User-global helpers are optional inbound Harness capabilities, not verification
authorities. Pi is registered as an auxiliary agent runtime; its
[inventory](docs/inventory/pi.json) links to the shared
[Pi Termux runbook](docs/runbooks/pi-termux.md). Native ripgrep resolution is
recorded in its [inventory](docs/inventory/rg.json) and
[Termux runbook](docs/runbooks/rg-termux.md). Agent entry files keep only
generic capability-routing instructions.

CLIProxyAPI Magisk is recorded as a separate optional root-managed provider
gateway. Its source-pinned [product contract](docs/product/cli-proxy-api-magisk.md),
[inventory](docs/inventory/cli-proxy-api-magisk.json),
[operations runbook](docs/runbooks/cli-proxy-api-magisk.md), and vendored
[`modules/cli-proxy-api-magisk`](modules/cli-proxy-api-magisk/) implementation
preserve the runtime, security, build, test, update, and recovery capability.
Credentials and live root state remain outside this control plane.

```bash
scripts/termux-control cli-proxy-api-magisk status
scripts/termux-control cli-proxy-api-magisk source-check
scripts/termux-control cli-proxy-api-magisk syntax
```

The staged native CLIProxyAPI policy plugin suite is maintained separately from
the Magisk ZIP. Its checksum-pinned non-root workflow is:

```bash
scripts/termux-control cli-proxy-api-plugins status
scripts/termux-control cli-proxy-api-plugins all
```

See the [plugin suite contract](docs/product/cli-proxy-api-plugin-suite.md) and
[operations runbook](docs/runbooks/cli-proxy-api-plugins.md). Live installation
remains a separately authorized root-managed action.

## Start

```bash
./scripts/termux-control status
./scripts/termux-control doctor
./scripts/termux-control orchestrator init
./scripts/termux-control orchestrator status
./scripts/termux-control verify
./qa/verify --mode targeted
./qa/verify --mode ci
./qa/verify --mode audit
```

Use a stable `HARNESS_RUN_ID` for state-changing orchestrator commands. Complex
work uses one Harness story linked to one Git-native execution plan. The
generated `harness.db` stays ignored; semantic changesets are committed so the
database can be rebuilt.

This repository already declares `application_present=true` and retains its
real continuity, Pi, RTK, Harness, and control-plane commands in
`qa/project-commands.json`. An empty selected consumer gate is recorded as a
proof gap and fails closed.

## Authority

`./qa/verify` is the only application definition-of-pass. Harness metadata, hooks, and agent statements are never substitutes for executable evidence.
