# Add a project-local Pi Gauntlet adapter

Harness story: `TERMUX-005`

## Current context

The repository is optimized for Codex today:

- `AGENTS.md`, product contracts, architecture, and `./qa/verify` are
  runtime-neutral repository truth;
- `.agents/skills/**/SKILL.md` already satisfies Pi's Agent Skills discovery
  contract and must not be copied into `.pi/skills`;
- `.codex/` owns Codex sandbox, approval, policy, lifecycle, and Stop hooks;
- Pi is registered only as an optional `auxiliary-agent-runtime` and never as
  a verification authority;
- the installed and upstream-current Pi version is `0.82.1`, release commit
  `b4f2936`;
- the project has no `.pi/` directory;
- `~/.pi/agent/APPEND_SYSTEM.md` is a mode-`0600` byte match for
  `config/rtk/RTK.md`, and the prohibited automatic rewrite extension
  `~/.pi/agent/extensions/rtk.ts` is absent.

Pi already loads the repository `AGENTS.md` independently of project trust and
discovers project `.agents/skills` after trust. Pi project extensions can
block `tool_call`, inspect `tool_result`, append turn-specific instructions in
`before_agent_start`, and observe `agent_settled`. Pi project trust is only an
input-loading guard: Pi has no built-in sandbox, and extensions run with the
same user permissions as the Pi process.

Relevant upstream contracts:

- <https://pi.dev/docs/latest/usage>
- <https://pi.dev/docs/latest/settings>
- <https://pi.dev/docs/latest/skills>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/security>
- <https://github.com/earendil-works/pi/blob/b4f2936/packages/coding-agent/src/core/resource-loader.ts#L983-L994>

## Outcome

Add a small, dependency-free project-local Pi adapter that gives a trusted,
monitored Pi session the same repository workflow and executable verification
expectations as Codex wherever Pi exposes an equivalent primitive, without
claiming sandbox parity or weakening the Codex path.

Acceptance requires:

- Pi keeps using the existing root `AGENTS.md` and `.agents/skills`; no
  runtime-specific copies are introduced.
- `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, and unnecessary project settings or
  package installs remain absent.
- Pi-specific prompt guidance is added by the trusted extension without
  replacing Pi's default prompt or shadowing the global RTK append policy.
- A runtime-neutral policy core owns destructive-command, protected-path, and
  maintenance decisions; Codex and Pi adapters translate their native events
  into that core.
- Existing Codex decisions and tests remain unchanged in behavior.
- Pi blocks prohibited known built-in `bash`, `edit`, and `write` calls before
  execution. Non-interactive execution fails closed whenever a decision would
  otherwise need UI approval.
- Pi reports policy-sensitive successful mutations after tool execution.
- After a mutation epoch settles, Pi runs `./qa/verify --mode stop`. A failed
  result creates one bounded follow-up for repair, with state/signature guards
  that prevent an infinite verification loop.
- The adapter explicitly states that it is defense in depth, not a sandbox or
  approval boundary.
- `qa/compatibility.json`, change classification, policy audit, self-tests,
  architecture, product contract, and the Pi runbook describe and verify the
  supported Pi surface.
- Static and synthetic tests run cross-platform. Termux additionally exercises
  the installed Pi runtime with an offline, no-session, no-provider-request
  probe before final completion.
- `./qa/verify --mode targeted` and the final mandatory `./qa/verify` pass.

## Non-goals

- Do not give Pi verification authority or make it a Harness dependency.
- Do not claim or emulate OS-level filesystem, network, credential, or process
  isolation inside a TypeScript extension.
- Do not add Docker, QEMU, Gondolin, OpenShell, root access, Android package
  mutation, or a generic Linux runtime.
- Do not install a third-party Pi package or add production dependencies.
- Do not add Pi session continuity in this story. Generalizing the
  Codex-specific continuity protocol is a separate follow-up after the policy
  and Stop adapter are proven.
- Do not change Pi global auth, credentials, sessions, trust decisions,
  launchers, release symlinks, or RTK materialized state.
- Do not create a project `APPEND_SYSTEM.md`: Pi selects the trusted project
  file before the global file, which would shadow the existing RTK policy.

## Approach

### Checkpoint 0 — select and freeze scope

1. Re-read this plan, `docs/WORKFLOW.md`, relevant product contracts,
   `docs/ARCHITECTURE.md`, `docs/quality/CODEX-GAUNTLET.md`, and the current Pi
   upstream docs for the installed version.
2. Query the Harness work graph and confirm `TERMUX-005` is `planned` and
   runnable.
3. Transition it with compare-and-set:

   ```bash
   HARNESS_RUN_ID=<stable-run-id> \
     scripts/termux-control orchestrator story update \
     --id TERMUX-005 \
     --status in_progress \
     --expected-status planned \
     --require-runnable \
     --json
   ```

4. Inspect live Pi/RTK metadata and checksums only. Do not read auth or session
   bodies.
5. Record the exact protected targets before requesting or using Gauntlet
   maintenance authorization.

### Checkpoint 1 — define the shared decision contract

1. Add failing focused tests for normalized tool events and decisions before
   changing runtime behavior.
2. Define a runtime-neutral, pure decision result such as `allow`, `deny`, or
   `requires_human`, with a bounded reason and normalized repository-relative
   targets.
3. Cover absolute paths, traversal, shell mutations, direct edit/write
   targets, destructive Git/filesystem commands, maintenance allowlists, and
   protected Gauntlet/Harness/QA paths.
4. Keep user approval and runtime execution outside the pure policy core.

Safe boundary: tests describe current Codex behavior and the desired Pi
translation, but no active runtime adapter has changed.

### Checkpoint 2 — extract without changing Codex behavior

1. Move only reusable decision logic out of Codex-specific hook handlers.
2. Keep `.codex/hooks/*.py` as Codex schema/output adapters.
3. Preserve `PermissionRequest` semantics: maintenance scope never becomes an
   automatic approval.
4. Run the existing Gauntlet self-tests plus the new focused policy tests
   before continuing.

Changing `.codex/**` is protected maintenance. Do not attempt it unless the
session was launched or resumed with:

```text
CODEX_GAUNTLET_MAINTENANCE=1
CODEX_GAUNTLET_MAINTENANCE_TARGETS=<reviewed exact comma-separated targets>
```

The allowlist must be resolved after inspection. Shell mutation does not enter
the maintenance lane, and managed `.agents/skills/**` remains hard protected.

Safe boundary: Codex behavior and all existing Codex tests pass against the
shared policy core.

### Checkpoint 3 — add the minimal Pi adapter

Use an auto-discovered, dependency-free layout:

```text
.pi/
└── extensions/
    └── gauntlet/
        ├── index.ts
        ├── policy.ts
        └── verification.ts
```

Responsibilities:

- `index.ts` wires lifecycle events and injects a short Pi-specific
  `before_agent_start` appendix without replacing the existing prompt.
- `policy.ts` translates Pi built-in `bash`, `edit`, and `write` inputs into
  the shared decision contract and blocks denied calls. It treats unknown
  mutating extension tools as unsupported rather than silently protected.
- `verification.ts` tracks successful mutation epochs, runs the canonical Stop
  mode at `agent_settled`, bounds captured output, and uses a worktree/failure
  signature plus an in-flight guard to prevent recursion.

Do not add `settings.json`, `SYSTEM.md`, `APPEND_SYSTEM.md`, copied skills,
prompt templates, npm metadata, or generated `.pi/npm` content unless later
evidence proves a concrete need and this plan is explicitly updated.

Safe boundary: the Pi adapter passes synthetic event tests and cannot weaken
the working Codex path.

### Checkpoint 4 — integrate repository contracts and QA

1. Add a concise Pi Gauntlet product contract and link it from architecture and
   the existing Pi Termux runbook.
2. Keep `AGENTS.md` generic; it must not accumulate Pi-specific operating
   details.
3. Add `.pi/**` to Gauntlet ownership and protect the active adapter from
   ordinary mutation.
4. Add a `pi` compatibility entry pinned to the exercised version/features.
5. Add a Pi change class and the narrowest required verification matrix.
6. Extend policy audit and self-tests to check:
   - no project `SYSTEM.md` or `APPEND_SYSTEM.md`;
   - no project Pi packages or generated dependency tree;
   - dependency-free trusted extension layout;
   - shared-policy parity;
   - Stop verification and recursion guard;
   - explicit no-sandbox language;
   - Pi remains auxiliary-only.

Safe boundary: repository contracts and executable static proof agree on the
supported surface.

### Checkpoint 5 — runtime proof and completion

1. Inspect the exact installed Pi version and project trust state without
   printing credentials or session data.
2. Review the committed project extension before trusting it.
3. Use a temporary trust override (`--approve`) for the first probe rather than
   changing global `defaultProjectTrust`.
4. Run an offline, no-session probe that proves resource discovery, policy
   blocking, prompt composition, and verification wiring without sending a
   provider request. Do not start with a live model call.
5. Prove the global RTK policy still matches its canonical checksum and the
   prohibited automatic rewrite extension remains absent.
6. Run focused tests, `./qa/verify --mode targeted`, and raw final Git review.
7. Record validation in this plan, move it to `docs/plans/completed/`, update
   the story contract path, and run:

   ```bash
   HARNESS_RUN_ID=<stable-run-id> \
     scripts/termux-control orchestrator story complete TERMUX-005 --json
   ```

8. Run final `./qa/verify` again after lifecycle completion.

## Progress

- [x] Researched Pi `0.82.1` context, skill, trust, prompt, extension,
  lifecycle, package, and security contracts.
- [x] Verified the current Pi registry/inventory, installed release target,
  global RTK policy checksum, prohibited extension absence, and repository
  `.pi` absence without reading secrets.
- [x] Selected a dependency-free extension adapter instead of copied Codex
  configuration.
- [x] Excluded project system-prompt files, duplicated skills, package installs,
  isolation claims, and continuity work from phase 1.
- [x] Created the multi-session handoff plan and `TERMUX-005`.
- [x] Transitioned `TERMUX-005` from `planned` to `in_progress` under stable
  run ID `20260726-termux005-pi-gauntlet-implementation`.
- [x] Added failing focused policy/adapter tests, then implemented and proved
  the unprotected shared policy core and project Pi adapter.
- [x] Added the product contract, architecture/runbook/inventory integration,
  Pi change classification, configured consumer commands, and self-test
  expectations that do not require the protected maintenance lane.
- [x] Loaded the project extension through Pi `0.82.1` with temporary
  `--approve`, `--no-session`, and the offline guarded probe; no provider turn
  or persistent trust update occurred.
- [x] Resumed with the recorded exact protected allowlist, migrated the Codex
  adapters without behavior change, and updated protected QA authority files.
- [x] Completed the remaining verification, lifecycle, and final-review work
  in checkpoints 2, 4, and 5.

## Last safe boundary

Implementation, validation, and Harness lifecycle completion are complete.
The shared policy core, Codex adapters, Pi adapter, repository contracts, and
QA authority agree; focused tests, all 65 structural self-tests, policy audit,
the offline installed-Pi probe, RTK drift checks, and the atomic
`story complete` proof pass. `TERMUX-005` is `implemented`, and the independent
final `./qa/verify` also passes on the completed repository state.

## Decisions

- Reuse repository truth, not runtime-specific copies.
- Keep Pi auxiliary-only and `./qa/verify` the sole pass/fail authority.
- Preserve Pi's default prompt and the existing global RTK append policy.
- Use a project extension because it is Pi's documented workflow extension
  point, while explicitly treating it as defense in depth rather than
  isolation.
- Share pure policy decisions across runtimes but retain native adapters and
  output schemas.
- Fail closed in non-interactive mode when an action requires human authority.
- Implement policy and Stop parity before considering continuity parity.
- Prefer several independently verified checkpoints over one large port.

## Risks

- Pi extensions execute with full user permissions; a bug in the adapter is
  not contained by project trust.
- Pi has no equivalent to Codex's sandbox or `PermissionRequest`, so an
  in-process gate cannot provide identical containment or approval semantics.
- A project `APPEND_SYSTEM.md` would shadow the global RTK policy.
- Extracting Codex policy can regress the working Codex path if tests do not
  freeze decisions first.
- Path and shell parsing can create false negatives; unknown mutating tools
  must never be described as protected.
- `agent_settled` follow-ups can loop if mutation epochs and failure signatures
  are not guarded.
- Automatically running verification after every settled read-only turn would
  waste time; verification must be mutation-aware without allowing a changed
  worktree to bypass the final mandatory gate.
- Cross-platform CI cannot execute the Android Pi binary; static/synthetic
  proof and Termux runtime proof must remain distinct.

## Recovery

- Before implementation, capture raw `git status --short`, the work-graph
  revision, and metadata/checksums for affected user-global Pi targets.
- Each checkpoint must leave focused tests passing before the next begins.
- If shared-policy extraction regresses Codex, revert only the current
  uncommitted checkpoint edits; do not reset or restore unrelated user work.
- If the Pi adapter fails before trust, remove only the newly added `.pi`
  project files from the current change after reviewing the diff.
- If the adapter fails after temporary `--approve`, remove or fix the project
  resources and rerun with `--no-approve`; do not edit global `trust.json`.
- Never modify or remove Pi auth, sessions, global RTK policy, release
  symlinks, or credentials as recovery for a project adapter failure.
- Harness recovery uses the semantic changeset and story queries; never copy a
  live `harness.db`.

## External side effects

Changes are limited to repository files and generated local Harness database
state. The runtime probe used temporary `--approve` and `--no-session`, was
handled locally before any provider turn, and did not persist a trust decision,
create a Pi session, install a package, or mutate user-global Pi/RTK state.

## Validation

Handoff validation must include:

```bash
scripts/termux-control orchestrator query contract --json
scripts/termux-control orchestrator query work-graph --json
scripts/termux-control orchestrator query intakes
scripts/termux-control orchestrator db changeset status \
  .harness/changesets/20260726-pi-project-gauntlet-handoff.changeset.jsonl \
  --json
./qa/verify --mode targeted
git status --short
git diff
```

Handoff evidence recorded on 2026-07-26 UTC:

- protocol discovery reports protocol `1`, CLI `0.1.23`, schema `14`, current
  database state, and every read/write/changeset capability used by this
  handoff;
- work-graph revision
  `eddcf3fa5b71d21ffc79db8d8695892eb8e218d8d23327abdc3042f94676aedd`
  contains `TERMUX-005` as `planned`, `high_risk`, runnable, linked to this
  plan, with `./qa/verify --mode targeted` as its verify command;
- intake `#9` records the future-session authorization, high-risk policy lane,
  affected documents, and protected-maintenance constraint;
- changeset
  `20260726-pi-project-gauntlet-handoff` contains two semantic operations and
  has content SHA-256
  `f72fbb71d5133f1699f268f0a182959cfc4b88a3f85263977ed2f3fe2ab1d919`;
  its file status is `applied: false` because the live mutations were captured
  directly under the stable run ID, so it must not be applied again to the
  current live database;
- `git diff --check` passed;
- `./qa/verify --mode targeted` passed 57/57 structural checks, policy audit,
  build, 10 unit tests, 18 integration tests, 2 acceptance tests, and both
  coverage consumers;
- the repository still has no `.pi` directory and no implementation path was
  changed.

Interim implementation evidence on 2026-07-26 UTC:

- shared-policy and Pi adapter focused proof passed 14/14 selected tests;
- the installed Pi `0.82.1` offline no-session probe loaded the project
  resource, denied destructive and protected-write synthetic calls, preserved
  the prompt prefix, appended Gauntlet guidance, and exposed bounded Stop
  wiring before any provider turn;
- the first Stop attempt passed Harness integrity and 62/65 self-tests;
- the only remaining self-test failures are the deliberately pending
  protected changes: `.pi/**` ownership (`G42`), the Pi verification class
  (`G43`), and auxiliary/no-sandbox compatibility metadata (`H22`);
- the resumed process still reported both
  `CODEX_GAUNTLET_MAINTENANCE` and
  `CODEX_GAUNTLET_MAINTENANCE_TARGETS` unset, so no protected mutation was
  attempted.

Final implementation evidence on 2026-07-26 UTC:

- the resumed maintenance process exposed the reviewed exact allowlist before
  any protected mutation;
- the shared-policy and Pi adapter focused proof passed all 17 selected tests;
- `python3 qa/selftest/run.py --group all` passed 65/65 checks, including Pi
  ownership, verification classification, and auxiliary/no-sandbox authority;
- `python3 qa/policy_audit.py` passed;
- an offline installed-Pi `0.82.1` probe loaded the adapter, denied destructive
  and protected-write events outside maintenance, preserved the default prompt
  prefix, appended Gauntlet guidance, and confirmed bounded Stop wiring without
  a provider request or session;
- global RTK materialized-policy checksums remained canonical, the prohibited
  automatic rewrite extension remained absent, `pi list --no-approve` reported
  no packages, and `scripts/termux-control rtk status --json` passed;
- `./qa/verify --mode targeted` passed Harness integrity, all 65 self-tests,
  policy audit, build, unit, integration, acceptance, and coverage consumers in
  17.4 seconds;
- `git diff --check` passed and raw tracked/untracked review found no unrelated
  mutation or product-contract conflict;
- Harness trace `#10` records the implementation decisions, actions, friction,
  and validation outcome under stable run ID
  `20260726-termux005-pi-gauntlet-implementation`.

Lifecycle evidence:

- `story update` linked `TERMUX-005` to
  `docs/plans/completed/pi-project-gauntlet.md`;
- `story complete TERMUX-005 --json` ran a fresh
  `./qa/verify --mode targeted`, passed every configured consumer, and
  atomically transitioned the story from `in_progress` to `implemented`.

The independent final `./qa/verify` passed again after lifecycle completion
and this last plan update.
