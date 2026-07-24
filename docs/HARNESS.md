# Repository Harness integration

Repository Harness owns repository legibility: the compact entry map, workflow documentation, durable plans, onboarding skills, provenance, and the maintenance lane.

Codex Gauntlet owns execution constraints: `.codex/`, verification, policy audit, Gauntlet skills, and CI enforcement.

Harness never defines application pass/fail. All paths converge on `./qa/verify`.

## Installed provenance

The compatibility baseline pins upstream tag `harness-cli-v0.1.10`. The generated repository contains a local fail-closed adapter rather than the upstream Rust executable. The adapter cannot update managed files and therefore cannot silently alter `.codex/` or `qa/`.

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
