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

- `TERMUX-014` — [Build the CLIProxyAPI policy and credential plugin suite](active/cli-proxy-api-plugin-suite.md)

## Recently Completed

- `TERMUX-015` — [Retire Pi Router from the active repository surface](completed/remove-pi-router.md)
- `TERMUX-011` — [Historical: Port the Pi Router management UI stack and operator experience](completed/pi-router-management-ui-stack-port.md)
- `TERMUX-010` — [Historical: Port CLI Proxy management capabilities to Pi Router](completed/pi-router-cli-proxy-capability-port.md)
- `TERMUX-009` — [Historical: Rebuild Pi Router Management Center as an operations console](completed/pi-router-operations-console.md)
- `TERMUX-007` — [Historical: Build the Pi Router MVP](completed/pi-router-mvp.md)
- `TERMUX-006` — [Add Pi session continuity parity](completed/pi-session-continuity.md)
- `TERMUX-005` — [Add a project-local Pi Gauntlet adapter](completed/pi-project-gauntlet.md)
- `TERMUX-002` — [Add compaction-aware Codex session continuity](completed/session-continuity-v1.md)
- `TERMUX-001` — [Activate orchestration-first Harness state](completed/orchestration-first-harness-state.md)
