# Product truth

This repository is the Termux operating control plane. Its current contracts
are:

- [`termux-control-plane.md`](termux-control-plane.md) for the control-plane
  boundary and entrypoints;
- [`session-continuity-v1.md`](session-continuity-v1.md) for bounded
  compaction/resume state and replay-safe operation observations;
- [`rtk-termux.md`](rtk-termux.md) for the pinned optional output-filtering
  capability and its accuracy, privacy, and update boundaries.

The continuity implementation is a local consumer application surface.
`qa/project-commands.json` declares executable build, unit, integration,
acceptance, coverage, and security-negative commands. Gauntlet structural and
policy checks continue to run through the same canonical `./qa/verify`
authority.
