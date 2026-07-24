# Execution Plans

Execution plans are Git-native working memory for complex tasks. They preserve
enough context for another agent or human to resume work without reconstructing
intent from chat history or a partial diff.

## When To Create A Plan

Use an ephemeral plan for bounded, single-session work.

Create one durable plan and link it from one Harness story when work spans
sessions, coordinates contributors, has meaningful dependencies or ordering,
requires recovery steps, or would be unsafe to resume from the diff alone.

Use `docs/templates/exec-plan.md` and place the file under `active/`.

## Lifecycle

```text
docs/plans/active/<slug>.md
  -> update progress and decisions during implementation
  -> record final validation and result
  -> move to docs/plans/completed/<slug>.md
```

The plan is authoritative for task intent, progress, decisions, recovery, and
validation context. The linked Harness story is authoritative for lifecycle,
readiness, dependencies, and hierarchy. Promote a lasting product or
architecture decision into `docs/decisions/`; keep task-local choices in the
plan.

## Active Plans

- None.

## Recently Completed

- `TERMUX-002` — [Add compaction-aware Codex session continuity](completed/session-continuity-v1.md)
- `TERMUX-001` — [Activate orchestration-first Harness state](completed/orchestration-first-harness-state.md)
