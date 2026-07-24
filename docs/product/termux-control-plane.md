# Termux control-plane contract

## Purpose

`codex-gauntlet-termux` is the operating repository for this Termux
environment. Changes to Termux packages, developer tools, repositories,
automation, and agent configuration start here so their intent, implementation,
and proof remain inspectable.

It is a control plane, not an owner of every target repository. Product code
and truth stay in their own repositories; this repository owns the operating
policy, inventory, runbooks, pinned tooling, and cross-repository procedures.

## Entry points

- `scripts/termux-control status` reports the local platform and pinned tools.
- `scripts/termux-control doctor` checks that the Termux Harness installation
  is healthy.
- `scripts/termux-control verify` runs the sole repository verification
  authority.
- `scripts/termux-control orchestrator` initializes, rebuilds, queries, and
  invokes the pinned Harness orchestration CLI against an explicit database.
- `scripts/termux-control continuity` binds sessions, records and verifies
  bounded checkpoints, recovers a valid predecessor, audits local recovery
  metrics, and records replay-safe operation observations.
- `scripts/termux-control rebuild-harness` rebuilds the pinned Harness tools
  from source according to `docs/runbooks/harness-rebuild.md`.

## Change contract

Every consequential Termux or repository mutation must have:

1. an explicit target and desired outcome;
2. a pre-change inspection and a recovery path;
3. pinned or otherwise reviewable inputs;
4. focused runtime evidence;
5. `./qa/verify` evidence for changes to this control plane;
6. a final diff review when Git metadata is available.

Every authorized change receives an intake classification. Complex,
multi-session, coordination-heavy, or recovery-sensitive work also receives a
Harness story linked to one Git-native execution plan.

Secrets, tokens, private keys, and unredacted credentials must never be stored
in this repository. Runtime state and generated databases stay ignored unless a
separate contract explicitly makes them durable.

## Harness boundary

The native `harness` binary maintains repository-centered core files.
`harness-cli` is the structured orchestration control plane. Its work graph is
authoritative for complex-work lifecycle, readiness, dependencies, and
hierarchy. It does not replace `./qa/verify`.

The generated `harness.db` remains ignored local state. Versioned semantic
changesets under `.harness/changesets/` are the reviewable replay source used to
rebuild it. The pinned migrations under `scripts/schema/` remain the schema
authority. Intake, trace, intervention, audit, backlog, and proposal features
are active when their evidence applies, but they never count as executable
application proof.

On Termux, upstream self-update is unsupported for `android/aarch64`. Updates
must use the pinned source-build lane; a Linux release binary is not compatible
with Android's dynamic linker.

Android also lacks the shared advisory lock used by the compatibility CLI.
The build lane applies the reviewed local patch that substitutes an exclusive
lock on Android. This preserves fail-closed epoch fencing while serializing CLI
operations.
