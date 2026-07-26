# Decisions

Decision records preserve lasting product, architecture, data ownership,
security, compatibility, and validation choices that future work must inherit.

Use `docs/templates/decision.md`. Task-local implementation choices remain in
the active execution plan and do not require a separate decision.

An installed consumer begins with no fabricated decisions. Add local decision
documents here as real choices are accepted, then index them in this file.

## Accepted decisions

- [0001 — Single verification authority](0001-single-verification-authority.md)
- [0002 — Serialize Harness CLI locking on Android](0002-android-exclusive-lock.md)
- [0003 — Use Harness as the orchestration state authority](0003-orchestration-first-harness-state.md)
- [0004 — Use a bounded local continuity store for agent sessions](0004-compaction-aware-session-continuity.md)
