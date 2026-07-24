# Documentation map

- `WORKFLOW.md`: canonical request and execution workflow.
- `HARNESS.md`: Repository Harness role, provenance, and maintenance lane.
- `ARCHITECTURE.md`: ownership boundaries and authority hierarchy.
- `product/`: current product contracts for this Termux control plane.
- `product/termux-control-plane.md`: operating contract for Termux and managed
  repositories.
- `quality/CODEX-GAUNTLET.md`: Codex-specific execution contract.
- `plans/active/`: durable plans in progress.
- `plans/completed/`: verified completed plans.
- `decisions/`: durable architecture decisions.
- `templates/exec-plan.md`: plan template.
- `provenance/termux-harness-build.json`: pinned native Harness build identity.
- `runbooks/harness-rebuild.md`: native Harness rebuild and recovery procedure.
- `runbooks/orchestration-state.md`: initialize, query, snapshot, rebuild, and
  recover Harness work state.
- `FEATURE_INTAKE.md`, `TRACE_SPEC.md`, `TOOL_REGISTRY.md`, and related
  documents: checksum-locked upstream compatibility references for the pinned
  Core Plus CLI. Their historical default-workflow notes do not override
  `WORKFLOW.md`, `HARNESS.md`, or `runbooks/orchestration-state.md`.
