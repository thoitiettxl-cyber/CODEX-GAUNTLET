# Repository Harness integration

Repository Harness owns repository legibility: the compact entry map, workflow documentation, durable plans, onboarding skills, provenance, and the maintenance lane.

Codex Gauntlet owns execution constraints: `.codex/`, verification, policy audit, Gauntlet skills, and CI enforcement.

Harness never defines application pass/fail. All paths converge on `./qa/verify`.

## Active orchestration

The Core Plus CLI is the machine-readable task control plane for complex work.
Its work graph owns lifecycle, readiness, dependencies, hierarchy, and runnable
selection. Each complex story links to one Git execution plan that owns intent,
progress, decisions, recovery, and validation context.

Use `scripts/termux-control orchestrator` so repository and database paths are
explicit. State-changing runs require a stable `HARNESS_RUN_ID` and emit
semantic changesets under `.harness/changesets/`. The generated `harness.db`
remains ignored and reproducible from those reviewed changesets.

Intake, trace, intervention, audit, backlog, and proposal records improve
inspection and control. They remain metadata and cannot replace executable
proof or the canonical gate.

The 23-file upstream CLI payload remains checksum-locked for provenance, so
some compatibility documents describe the earlier opt-in default. For this
repository, the local authority order in `docs/WORKFLOW.md`, this document, ADR
0003, and `docs/runbooks/orchestration-state.md` supersedes those historical
default-workflow notes without rewriting the pinned payload.

## Installed provenance

The compatibility baseline pins upstream tag `harness-v0.1.7` at commit
`d43b70254308b0e10efed2efbcbe595f1e771f63`. The repository contains native
Android `aarch64` builds of `harness 0.1.7` and `harness-cli 0.1.23`. Their
checksums, build identity, patch set, and schema bundle are recorded in
`docs/provenance/termux-harness-build.json`.

The installed profile is Core Plus CLI. It contains the exact 19-file embedded
core, the 23-file static CLI compatibility payload declared by upstream, both
native binaries, and all 14 schema migrations. `qa/check_harness.py` validates
the complete core path set and checksum-locks the compatibility payload,
Android patch, binaries, and schemas.

The native `harness` owns only the paths listed in
`.harness-core/manifest.json`; it does not own `.codex/`, `qa/`, or the
Gauntlet CI workflow. `qa/check_harness.py` fails closed if those ownership
boundaries overlap.

## Local customization status

`scripts/bin/harness status` compares live Harness-managed files with the
upstream baseline stored in `.harness-core/base/`. A `modified` count therefore
means the repository has intentional local customizations relative to upstream;
it does not mean the Git worktree is dirty. Use `git status` to determine
whether local work is uncommitted.

This repository currently customizes managed entrypoint, workflow,
documentation, template, and skill files for its Termux control-plane role.
Before a Harness update, inspect the per-file JSON status and review every
upstream/local difference. Do not erase local customizations merely to make the
Harness status count zero.

## Maintenance lane

```text
clean git status
→ scripts/bin/harness status
→ scripts/bin/harness doctor
→ scripts/bin/harness update --dry-run
→ review candidate
→ explicit human authorization
→ official upstream update
→ harness doctor
→ G + H self-tests
→ ./qa/verify --mode stop
→ final diff review
→ CI
```

Never auto-update at session start, before a task, from a Stop hook, or in CI. Never resolve semantic merge conflicts without human direction.

Native Termux rebuilds use `scripts/termux-control rebuild-harness`, not the
upstream self-update path. Follow `docs/runbooks/harness-rebuild.md` for
prerequisites, recovery, focused proof, and the canonical verification gate.
