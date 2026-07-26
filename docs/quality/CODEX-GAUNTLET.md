# Codex Gauntlet enforcement contract

## Baseline

- `sandbox_mode = "workspace-write"`
- `approval_policy = "on-request"`
- `approvals_reviewer = "user"`
- outbound network disabled in the workspace-write sandbox
- project hooks enabled and subject to Codex hook trust

## Defense in depth

`PreToolUse` blocks destructive commands, policy bypass, ordinary protected-path mutation, and unauthorized Harness updates. `PermissionRequest` never auto-allows protected escalation. `PostToolUse` provides cheap feedback only. `Stop` calls `./qa/verify --mode stop` and uses `stop_hook_active` to avoid infinite continuation.

Hooks are not a complete security boundary. Hosted or specialized tool paths may not traverse local hooks. Sandbox, policy audit, code review, and CI remain independent controls.

## Protected paths

Ordinary tasks may not directly modify `.codex/**`, `.harness-core/**`, policy-critical QA files, or the managed `.agents/skills/**` directories. Maintenance exceptions require explicit intent and human approval.

Gauntlet maintenance uses two process-scoped variables:

- `CODEX_GAUNTLET_MAINTENANCE=1`;
- `CODEX_GAUNTLET_MAINTENANCE_TARGETS`, a comma-separated exact allowlist of
  repository-relative targets.

The operator must launch or resume Codex with both variables. Maintenance is
accepted only for `apply_patch`, `Edit`, or `Write` events whose extracted
targets are all in that exact allowlist. Shell mutation does not enter this
lane. `.harness-core/**` and managed `.agents/skills/**` remain denied even if
listed. `PermissionRequest` emits no allow decision for a valid maintenance
request, so normal human approval remains authoritative.

The active project Pi adapter under `.pi/**` is also Gauntlet-managed and
protected from ordinary mutation.

On Termux versions where the workspace sandbox cannot initialize because
Android denies a `bwrap` `/proc/sys` read, the operator may select a temporary
no-sandbox invocation after reviewing the exact target allowlist. That runtime
choice must not be persisted in `.codex/config.toml`, must not weaken repository
policy, and must not use `--dangerously-bypass-hook-trust`.

## Single authority

There is no `harness verify`. All test, coverage, acceptance, mutation, provenance, and policy requirements are orchestrated by `./qa/verify`.

GitHub-hosted Ubuntu cannot execute Android ELF artifacts. CI runs the same
authority with `CODEX_GAUNTLET_CROSS_PLATFORM=1`, which verifies their pinned
checksums and all repository policy while skipping only native binary
execution. The Termux local gate must execute the binaries and `harness doctor`.

## Pi defense-in-depth adapter

The trusted `.pi/extensions/gauntlet/` adapter uses the shared policy core for
Pi's built-in `bash`, `edit`, and `write` events, reports successful mutations,
delegates settled mutation epochs to `./qa/verify --mode stop`, and maps Pi
session lifecycle events to the shared continuity protocol. It must fail
closed when a covered decision cannot be obtained or non-interactive execution
would require human authority. Continuity failures degrade safely without
guessing a story or authorizing a side-effect replay.

This is not sandbox parity. Pi project trust controls resource loading only,
and the extension runs with the same user permissions as Pi. Custom and
extension tools remain outside the built-in mutation gate. Static and
synthetic proof is cross-platform; only the Termux gate claims execution of
the installed Pi runtime, including its offline compaction/resume probe.
