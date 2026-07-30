# Codex Gauntlet enforcement contract

## Baseline

The checked-in Codex configuration keeps:

- `sandbox_mode = "workspace-write"`;
- `approval_policy = "on-request"`;
- user-reviewed approvals;
- sandbox network disabled;
- project hooks enabled;
- native Windows unelevated sandbox behavior.

Native Windows PowerShell, Python, and reviewed repository PE artifacts are the
only active runtime lane.

## Defense in depth

`PreToolUse` blocks destructive commands, policy bypass, protected-path
mutation, and unauthorized Harness maintenance. `PermissionRequest` never
auto-allows protected escalation. `PostToolUse` provides bounded feedback.
`Stop` calls `qa/verify.ps1 -Mode stop` with a recursion guard.

Hooks are not a complete security boundary. Sandbox behavior, approval policy,
hook trust, policy audit, code review, and Windows CI remain independent
controls.

## Protected paths and maintenance

Ordinary tasks may not directly modify `.codex/**`, `.harness-core/**`,
policy-critical QA files, or managed `.agents/skills/**` paths. Maintenance
requires explicit intent, an exact process-scoped target allowlist, and normal
human approval. Managed Harness core and skill paths remain hard protected.

Shell mutation never enters the exact-file maintenance lane. The lane applies
only to reviewed edit, write, or patch operations. It must not weaken sandbox,
approval, network, or hook policy and must never be persisted globally.

## Single authority

There is no `harness verify`. All build, test, coverage, acceptance, mutation,
provenance, policy, and security requirements are orchestrated by
`qa/verify.ps1`.

The verifier executes the checked-in Windows PE artifacts and validates their
pinned versions and SHA-256 values. Cross-platform skips do not count as native
Windows proof.

Experimental Rules are optional defense in depth and are not required for the
core contract. Compatibility failure in a hook, policy input, Harness artifact,
classifier, or verifier fails closed.

## V6 handshake and modes

Harness produces an integrity-protected `WorkContext`. Gauntlet validates it
but does not mutate lifecycle. Only the internal verifier behind
`qa/verify.ps1` can acquire the process-bound issuer capability, seal
structured command evidence, and mint a `VerificationReceipt`.

The modes are `targeted`, `stop`, `ci`, and `audit`. Ordinary work does
not run a repository-wide security scan. Sensitive targeted/Stop work uses the
fast profile; sensitive CI uses full diff scope; scheduled audit uses repository
scope. All security components remain offline implementation details beneath
the single verifier.
