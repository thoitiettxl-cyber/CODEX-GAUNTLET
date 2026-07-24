# Codex Gauntlet v3 + Repository Harness for Termux

The operating control plane for this Termux environment and its repositories,
implementing **Codex Gauntlet v3 — Repository Harness Integrated**.

## What is implemented

- compact `AGENTS.md` entry map;
- repository knowledge, decisions, and durable plans under `docs/`;
- five repository skills under `.agents/skills/`;
- Codex sandbox and lifecycle hooks under `.codex/`;
- a single verification authority: `./qa/verify`;
- Harness provenance and compatibility checks;
- ownership-aware policy audit;
- a hermetic GitHub Actions workflow that never downloads the latest Harness;
- 34 named structural acceptance checks (`G01–G18`, `H01–H16`).

## Native Termux tools

The repository pins upstream tag `harness-v0.1.7` and builds its Rust tools
natively for `aarch64-linux-android`. The tag provides `harness 0.1.7` and
`harness-cli 0.1.23`.

Upstream self-update does not support `android/aarch64`. Use
`scripts/termux-control rebuild-harness` to rebuild from the pinned tag; never
substitute a GNU/Linux release binary.

The rebuild lane requires explicit maintenance authorization:

```bash
CODEX_GAUNTLET_MAINTENANCE=1 scripts/termux-control rebuild-harness
```

## Start

```bash
./scripts/termux-control status
./scripts/termux-control doctor
./scripts/termux-control verify
```

For a consumer application, set `application_present` to `true` in `qa/project-commands.json` and provide real executable commands for every required gate. Empty commands fail closed once an application is declared.

## Authority

`./qa/verify` is the only application definition-of-pass. Harness metadata, hooks, and agent statements are never substitutes for executable evidence.
