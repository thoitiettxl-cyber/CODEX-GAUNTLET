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
- [0005 — Use Pi provider runtime behind a local Responses gateway](0005-pi-router-local-provider-gateway.md)
- [0006 — Package Pi Router as a verified Termux SEA](0006-package-pi-router-as-a-verified-termux-sea.md)
- [0007 — Bound the Pi Router operations console](0007-bound-pi-router-operations-console.md)
- [0008 — Separate Pi Router keys and isolate provider accounts](0008-separate-pi-router-keys-and-isolate-provider-accounts.md)
- [0009 — Use a modern single-file Pi Router console](0009-use-a-modern-single-file-pi-router-console.md)
- [0010 — Enable Pi Router raw management and protocol adapters](0010-enable-pi-router-raw-management-and-protocol-adapters.md)
