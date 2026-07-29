# Retire Pi Router from the active repository surface

Harness story: `TERMUX-015`

## Objective and non-goals

Remove the repository-owned Pi Router product, its shipped Android artifact,
release lane, active product/runbook/provenance contracts, architecture entry,
and canonical QA commands. Retain immutable historical plans, superseded
decisions, and applied Harness changesets so earlier work remains auditable and
the orchestration database remains replayable.

This retirement does not claim feature parity from the CLIProxyAPI plugin
suite. It does not uninstall a deployed Pi Router, mutate Pi CLI/Gauntlet
support, change the live CLIProxyAPI service, touch credentials, or complete
`TERMUX-014`.

## Evidence baseline and confidence

- **Confirmed:** the owner decided on 2026-07-29 to remove Pi Router from this
  repository.
- **Confirmed:** `pi-router/` currently owns source, tests, a bundled web UI,
  and a committed Android AArch64 binary. A dedicated GitHub release workflow,
  product contract, runbook, provenance record, README section, architecture
  section, and six command-matrix entries depend on it.
- **Confirmed:** fresh `./qa/verify --mode targeted` passed before retirement.
  Therefore any later failure is attributable to the retirement diff rather
  than an unverified inherited baseline.
- **Confirmed:** the inherited 45-file Pi Router worktree change was preserved
  before any retirement edit as stash `3471b4d4b48929af817bcb67ee24f08c4ac0f2d6`
  (`pi-router-pre-removal-recovery-20260729`), including its untracked routing
  source, test, ADR draft, and semantic changeset.
- **Confirmed:** Policy Scheduler `0.3.1` passes fresh unit, deterministic build,
  and isolated-host integration proof and its dashboard is observable on live
  CLIProxyAPI `7.2.104`.
- **Confirmed:** Credential Security `0.1.0` passes local and isolated proof,
  but its sidecar is not currently listening on `127.0.0.1:18319`; no real
  credential, automatic CPA projection sync, restart, rotation, or rollback
  proof exists.
- **Decision:** removing Pi Router is a product contraction, not a parity
  migration. The missing Pi provider gateway and management surfaces are
  intentionally retired rather than relabeled as plugin-complete.

## Gap and retirement matrix

| Surface | Current state | Target state | Impact and dependency | Acceptance signal |
|---|---|---|---|---|
| Product source and binary | `pi-router/` contains runtime, UI, tests, dependencies, and a committed SEA | Directory absent | Removes the alternative provider gateway and its recoverable binary; requires the pre-removal stash | No tracked or untracked `pi-router/` path |
| Release lane | `.github/workflows/pi-router-release.yml` publishes `pi-router-v*` | Workflow absent | Prevents releases for a retired product | No Pi Router tag trigger or release asset reference |
| Active contracts | Product doc, runbook, provenance, README, and architecture advertise a supported gateway | Active references removed; retirement ADR retained | Documentation must not promise an absent product | Repository entry surfaces describe only supported products |
| Canonical QA | `qa/project-commands.json` invokes Pi Router in build, unit, integration, acceptance, coverage, and mutation classes | Those six commands removed | Protected Gauntlet target; requires an exact maintenance allowlist | `./qa/verify --mode targeted` and final `./qa/verify` pass without Pi Router |
| Durable history | Completed plans, ADRs, and applied changesets record TERMUX-007 through TERMUX-012 | Retained and explicitly historical/superseded | Deleting them would break audit and changeset replay without removing product behavior | Harness rebuild still matches the logical graph |
| CLIProxyAPI plugins | Partial replacement only | Remains owned by `TERMUX-014` | Retirement must not hide its open production gates | Plugin gaps remain explicit in their active plan |

## Priorities and sequence

1. Preserve the inherited Pi Router diff and record its exact recovery object.
2. Bind this effort to a separate high-risk story and accepted retirement ADR.
3. In a Codex process launched with the exact Gauntlet maintenance allowlist
   for `qa/project-commands.json`, remove the product source/binary, release
   workflow, active contracts, and QA commands as one coherent change.
4. Mark legacy Pi Router ADRs and catalog entries as superseded or historical;
   do not delete applied `.harness/changesets/` or completed plans.
5. Search the final tree for active Pi Router references, run focused command
   matrix proof, run `./qa/verify --mode targeted`, review the full diff, then
   run final `./qa/verify` before completing the story.

## Progress

- [x] Establish repository, Harness, upstream Plugin Store, and live runtime
      evidence.
- [x] Preserve the inherited Pi Router worktree in a named, hash-addressable
      Git stash.
- [x] Run fresh plugin proof and the pre-retirement canonical targeted gate.
- [x] Record high-risk intake `#23`, add `TERMUX-015`, register decision `0015`,
      and link this plan.
- [x] Start a maintenance-scoped Codex process with only
      `qa/project-commands.json` allowlisted.
- [x] Remove the active Pi Router product, release, contract, provenance, and
      command-matrix surfaces while retaining historical evidence.
- [x] Run absence/reference/JSON proof, targeted verification, scoped diff
      review, and the canonical verification command.
- [x] Move this plan to `completed/` and complete `TERMUX-015` atomically.

## Last safe boundary

The active Pi Router source/binary directory, release workflow, product
contract, runbook, provenance record, top-level advertisement, architecture
boundary, QA commands, and unaccepted ADR/changeset drafts are absent.
Historical plans, applied changesets, and ADR bodies remain; ADRs 0005-0010
are marked superseded. The inherited worktree remains recoverable as stash
`3471b4d4b48929af817bcb67ee24f08c4ac0f2d6`.

Focused absence/reference/JSON checks, `git diff --check`,
`./qa/verify --mode targeted`, and `./qa/verify` pass. The plan is now under
`completed/`; Harness trace `#32` meets the high-risk detail tier, and
`story complete TERMUX-015` passed fresh targeted proof and atomically moved
the story to `implemented`. The exact final action is raw status/diff review
and one more `./qa/verify` on the lifecycle-final tree.

## Decisions and constraints

- Retain completed plans, applied Harness changesets, and legacy ADR bodies as
  history; retirement removes supported surfaces, not audit evidence.
- Keep Pi CLI, the Pi Gauntlet adapter, and Pi session-continuity support. They
  are separate products from Pi Router.
- Do not call Policy Scheduler or Credential Security a complete replacement.
- Do not touch live `/data/local/cli-proxy-api`, root-managed services, keys,
  auth files, or an external Pi Router deployment.
- Do not create a placeholder `pi-router` package merely to satisfy stale QA;
  update the single command authority instead.

## Risks

- A broad name-based deletion could remove unrelated Pi runtime/Gauntlet
  support.
- Deleting completed changesets or plans would destroy replayable history.
- Applying the recovery stash directly onto the retirement branch would mix
  mutually exclusive states; restore it only on a recovery branch.
- The protected QA edit cannot be made in the current process. Partial deletion
  would leave canonical verification broken and is therefore prohibited.

## Recovery

Inspect the saved work with:

```bash
git stash show --stat --include-untracked 3471b4d4b48929af817bcb67ee24f08c4ac0f2d6
```

Recover it on a separate branch with:

```bash
git stash branch recover-pi-router-work 3471b4d4b48929af817bcb67ee24f08c4ac0f2d6
```

Do not drop the stash until retirement is verified and the owner explicitly no
longer needs the unfinished routing work. If retirement verification fails,
restore only the retirement diff; do not overwrite unrelated user work.

## External side effects

Use stable Harness run ID `remove-pi-router-20260729`. Upstream reads were
limited to public primary sources. Repository retirement authorizes no root,
runtime, credential, release, push, or deployment action.

## Validation

Pre-retirement evidence:

- `scripts/termux-control cli-proxy-api-plugins all` — pass;
- pinned Go `test -count=1 ./...` in both plugin modules — pass;
- live unauthenticated metadata — CLIProxyAPI `7.2.104`, commit `c9417c8a`,
  plugin support `1`, Policy Scheduler dashboard HTTP `200`;
- Credential Security sidecar probe on `127.0.0.1:18319` — not listening;
- `./qa/verify --mode targeted` — pass.

Retirement evidence:

- active source, binary, release, product, runbook, provenance, draft ADR, and
  draft changeset absence checks — pass;
- `python3 -m json.tool qa/project-commands.json` — pass;
- active-surface `rg` audit — no Pi Router references;
- `git diff --check` and scoped raw diff review — pass;
- `./qa/verify --mode targeted` — pass;
- `./qa/verify` — pass.
- `story verify TERMUX-015` and `story complete TERMUX-015` — fresh targeted
  proof passed; story status is `implemented`.

Raw final status/diff review and one post-lifecycle `./qa/verify` remain the
last handoff gate.
