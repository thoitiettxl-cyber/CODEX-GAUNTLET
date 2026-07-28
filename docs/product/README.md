# Product truth

This repository is the Termux operating control plane. Its current contracts
are:

- [`termux-control-plane.md`](termux-control-plane.md) for the control-plane
  boundary and entrypoints;
- [`session-continuity-v1.md`](session-continuity-v1.md) for bounded,
  runtime-neutral Codex/Pi compaction/resume state and replay-safe operation
  observations;
- [`rtk-termux.md`](rtk-termux.md) for the pinned optional output-filtering
  capability and its accuracy, privacy, and update boundaries;
- [`pi-gauntlet.md`](pi-gauntlet.md) for the trusted project-local Pi policy
  and mutation-settlement adapter;
- [`pi-router.md`](pi-router.md) for the optional loopback provider gateway
  that exposes Pi providers through an OpenAI Responses-compatible API.
- [`cli-proxy-api-magisk.md`](cli-proxy-api-magisk.md) for the imported,
  source-pinned operating contract of the optional root-managed CLIProxyAPI
  provider gateway.

The continuity implementation is a local consumer application surface.
`qa/project-commands.json` declares executable build, unit, integration,
acceptance, coverage, and security-negative commands. Gauntlet structural and
policy checks continue to run through the same canonical `./qa/verify`
authority.
