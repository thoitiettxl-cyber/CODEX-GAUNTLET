# Architecture

## Nine layers

| Layer | Owner | Artifact | Role |
|---|---|---|---|
| 1 | Harness + project | `AGENTS.md` | Compact entry map |
| 2 | Harness | `docs/` | Repository knowledge and plans |
| 3 | Harness | `.agents/skills/onboard-*` | Brownfield discovery |
| 4 | Gauntlet | `.agents/skills/verify-*` | Codex workflows |
| 5 | Gauntlet | `.codex/`, `.pi/extensions/gauntlet/` | Native runtime adapters |
| 6 | Gauntlet | `qa/` | Canonical verification engine |
| 7 | Harness | `.harness-core/`, `scripts/bin/harness` | Provenance and controlled maintenance |
| 8 | Repository | CI | Independent final enforcement |
| 9 | Harness + repository | `.harness/changesets/`, `harness.db` | Replayable orchestration state |

## Ownership

Harness-managed paths may change only through the official maintenance lane. Gauntlet-managed paths may change only in explicit Gauntlet maintenance. Product code, tests, dependencies, infrastructure, and product truth remain project-owned.

The Harness manifest must never claim `.codex/**`, `qa/**`, or `.github/workflows/codex-gauntlet.yml`. An overlap fails closed and requires an explicit architecture decision.

## Verification

```text
Agent done → Harness context complete → Local Gauntlet verified → Repository CI verified
```

Only the final state is mergeable.

## Orchestration authority

Harness work-graph state owns task lifecycle, readiness, dependencies,
hierarchy, and runnable selection. A linked Git execution plan owns intent,
progress, decisions, recovery, and validation context. Semantic changesets are
reviewed and committed; the SQLite database is generated and ignored.

Gauntlet retains sole executable pass/fail authority through `./qa/verify`.
Story completion may invoke that command as fresh proof, but metadata never
redefines verification.

## Runtime policy adapters

`scripts/gauntlet_policy.py` owns pure destructive-command, protected-path,
and exact-maintenance decisions. Codex hooks and the trusted Pi extension
translate their native tool events into that shared contract while preserving
runtime-specific outputs and approval behavior.

Codex retains its workspace sandbox, user-reviewed approvals, native hooks,
and Stop semantics. Pi has no built-in sandbox: its adapter can block covered
built-in tool calls and trigger canonical verification, but it cannot isolate
the process, credentials, network, filesystem, custom tools, or extensions.
Pi remains auxiliary-only and never becomes a verification authority.

`scripts/continuity/lifecycle.py` owns the runtime-neutral compaction/resume
result. The Codex hook adapter serializes it as `systemMessage`; the Pi adapter
namespaces native session IDs, maps Pi session events, and injects recovery at
a lifecycle-safe delivery point. Both adapters use the same bounded store and
checkpoint schema. Neither adapter owns conversation transcripts or native
compaction summaries.

## Termux control plane

The repository owns Termux operating policy, runbooks, pinned local tooling,
and cross-repository coordination. Target repositories retain ownership of
their product code and tests.

Compaction-aware continuity is generated local control-plane state. It owns
only session bindings, bounded checkpoints, checkpoint events, operation
observations, and recovery attempts. It may read Harness with a bounded timeout
but cannot mutate story lifecycle. It cannot replace the linked Git plan,
target-system state, or `./qa/verify`.

`scripts/termux-control` is the human and agent entrypoint. It delegates
repository pass/fail to `./qa/verify`; it does not introduce a second
verification authority.

Harness updates on Termux follow a source-build lane because upstream release
self-update does not support `android/aarch64`.

## Optional provider gateway

`pi-router/` is an optional repository-local service at the product boundary.
It embeds Pi's provider/model/auth runtime but does not embed the Pi agent
loop, session manager, tools, or extensions. Its only inbound application
surface is a loopback OpenAI Responses HTTP API protected by a router-local
bearer token.

Router credential and model state is separate from both repository state and
Pi CLI state. The dependency direction is:

```text
Codex or another Responses client
  → pi-router HTTP adapter
  → Pi ModelRuntime
  → configured upstream provider
```

`pi-router` cannot mutate Harness lifecycle, invoke Gauntlet policy, or define
verification success. The provider gateway contract is
[`docs/product/pi-router.md`](product/pi-router.md).
