# Product truth

This repository is the native Windows operating control plane for Codex. Its
current contracts are:

- `windows-codex-home.md` for platform identity, entrypoints, Harness
  provenance, verification, and non-goals;
- `session-continuity-v1.md` for bounded Codex compaction/resume state and
  replay-safe operation observations;
- `project-scopes-v1.md` for resolving projects stored inside this repository
  or declared at an external Windows path.

The continuity implementation is the local consumer application surface.
`qa/project-commands.json` declares executable build, unit, integration,
acceptance, coverage, mutation, and migration commands. All pass/fail decisions
remain under `qa/verify.ps1`.
