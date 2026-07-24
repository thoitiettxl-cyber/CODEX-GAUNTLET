# Operate Harness orchestration state on Termux

Use this runbook for intake, story, dependency, hierarchy, trace, audit,
backlog, proposal, tool-registry, intervention, snapshot, and replay operations.
The wrapper pins `HARNESS_REPO_ROOT` and defaults `HARNESS_DB_PATH` to the
ignored root `harness.db`.

## Authority boundaries

- Harness work graph: lifecycle, readiness, dependencies, hierarchy, runnable
  selection.
- Linked Git execution plan: intent, approach, progress, decisions, risks,
  recovery, validation context.
- `./qa/verify`: sole executable definition-of-pass.
- Semantic changesets: reviewed replay input for reconstructing SQLite state.

Never put secrets, credentials, unredacted tool payloads, or sensitive
transcripts into Harness fields or changesets.

## Initialize or materialize

```bash
scripts/termux-control orchestrator init
scripts/termux-control orchestrator status
```

If the database is absent and semantic changesets exist, `init` rebuilds from
them. With no changesets, it initializes the pinned schema. If the database
already exists, it validates the pinned CLI and migrates a supported older
schema.

Discovery and all query commands are read-only:

```bash
scripts/termux-control orchestrator query contract --json
scripts/termux-control orchestrator query work-graph --json
scripts/termux-control orchestrator query matrix --active --summary
scripts/termux-control orchestrator query intakes
scripts/termux-control orchestrator query traces
scripts/termux-control orchestrator query decisions
scripts/termux-control orchestrator query backlog --open
scripts/termux-control orchestrator query interventions
scripts/termux-control orchestrator query improvement-health
```

## Start complex work

Choose one stable run ID and reuse it for every state-changing command in the
same logical run:

```bash
export HARNESS_RUN_ID=20260724-example-change
scripts/termux-control orchestrator intake \
  --type change_request \
  --summary "Implement the accepted example change" \
  --lane normal \
  --story EXAMPLE-001
scripts/termux-control orchestrator story add \
  --id EXAMPLE-001 \
  --title "Implement the accepted example change" \
  --lane normal \
  --contract docs/plans/active/example-change.md \
  --verify "./qa/verify --mode targeted" \
  --json
scripts/termux-control orchestrator story update \
  --id EXAMPLE-001 \
  --status in_progress \
  --expected-status planned \
  --require-runnable \
  --json
```

Prefer environment assignment on individual commands in automation so a run ID
does not leak into unrelated terminal work.

Use dependency and hierarchy edges only when they express real scheduling or
ownership:

```bash
scripts/termux-control orchestrator story dependency add \
  --blocker EXAMPLE-001 --blocked EXAMPLE-002 --json
scripts/termux-control orchestrator story hierarchy add \
  --parent EXAMPLE-000 --child EXAMPLE-001 --json
```

All state-changing wrapper calls fail unless `HARNESS_RUN_ID` is present.
Protocol mutations use `--json`, compare-and-set preconditions, and the
server-provided `runnable` value. Do not reproduce runnable SQL in an agent.

## Complete work

After implementation and focused proof:

1. Update the execution plan with exact evidence and recovery state.
2. Record the appropriate trace tier from `docs/TRACE_SPEC.md`.
3. Move the plan to `docs/plans/completed/` and update the story contract path.
4. Run `story complete`; it executes fresh configured proof before changing
   lifecycle state.
5. Run `./qa/verify --mode targeted` again because trace, plan, story, and
   semantic changeset writes changed the final repository state.

Example:

```bash
scripts/termux-control orchestrator trace \
  --summary "Implemented and validated the example change" \
  --intake 1 \
  --story EXAMPLE-001 \
  --agent codex \
  --outcome completed \
  --actions "implemented change,ran focused proof,reviewed diff" \
  --read "docs/WORKFLOW.md,docs/product/example.md" \
  --changed "src/example.py,tests/test_example.py" \
  --friction "none"
scripts/termux-control orchestrator story complete EXAMPLE-001 --json
./qa/verify --mode targeted
```

Harness completion records proof; it does not supersede the final repository
gate.

## Snapshot and recovery

Never copy a live SQLite file directly. Create a WAL-safe snapshot at a new
explicit path:

```bash
scripts/termux-control orchestrator db snapshot \
  --output /data/data/com.termux/files/usr/tmp/harness-state.snapshot.db \
  --json
```

To recover, first move the existing database to a specific backup path outside
this command. The wrapper refuses to overwrite it:

```bash
scripts/termux-control orchestrator rebuild
scripts/termux-control orchestrator status
```

For a rehearsal, select an isolated database without changing the repository
default:

```bash
HARNESS_DB_PATH=/data/data/com.termux/files/usr/tmp/harness-rehearsal.db \
  scripts/termux-control orchestrator rebuild
HARNESS_DB_PATH=/data/data/com.termux/files/usr/tmp/harness-rehearsal.db \
  scripts/termux-control orchestrator query work-graph --json
```

Compare logical work-graph content, not raw SQLite file bytes. Stop on a schema,
revision, or replay conflict; never force or manually merge semantic operations.

## Audit and improvement

Read-only inspection is safe at any time:

```bash
scripts/termux-control orchestrator audit
scripts/termux-control orchestrator propose
scripts/termux-control orchestrator query improvement-health
```

Persist audit evidence or accept/reject exactly one proposal only with explicit
human intent and a stable run ID. A proposal is evidence for a decision, never
self-authorization.
