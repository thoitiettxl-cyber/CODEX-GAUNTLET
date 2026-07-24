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

## Single authority

There is no `harness verify`. All test, coverage, acceptance, mutation, provenance, and policy requirements are orchestrated by `./qa/verify`.
