# Build the CLIProxyAPI policy and credential plugin suite

Harness story: `TERMUX-014`

## Current context

The live Magisk-managed CLIProxyAPI service on `127.0.0.1:8317` reports
version `7.2.104`, commit `c9417c8a`, and `X-CPA-SUPPORT-PLUGIN: 1`. The
matching upstream tag uses native ABI version 1 and JSON RPC schema version 2.
The repository currently owns the Magisk controller but deliberately keeps
runtime-installed plugin binaries outside the module ZIP. Pi Router retirement
is tracked independently by `TERMUX-015`; this plan does not treat its removal
as plugin completion evidence.

The requested suite is recovery-sensitive and must be staged in host-defined
capability order. The retired Pi Router worktree is preserved by `TERMUX-015`
and must not be reapplied as plugin-suite work. No live config, management
secret, auth payload, or token may enter Git, Harness state, test output, or
documentation.

## Approach

1. Pin the CLIProxyAPI SDK and Linux ARM64 build toolchain inputs used by the
   deployed core; add a repository-owned plugin build/test control surface.
2. Build a first independent vertical slice combining a read-only
   `management_api` dashboard with `scheduler`. Read live state only through
   `host.auth.list` and `host.auth.get_runtime`, and implement the required
   ordered policy chain with deterministic tests.
3. Stabilize and prove that slice before implementing credential-sensitive
   behavior. Keep plugin enable/disable side-effect free.
4. Implement `auth_provider` and only the lightweight request/response
   interceptor seams that can be supported without selecting credentials or
   calling upstream models. Gate encryption design on a proven provider and
   refresh path; do not invent a generic wrapper that breaks built-in OAuth.
5. Keep `model_router` and `executor` out unless concrete cross-provider or new
   backend evidence appears. Record the explicit decision in design docs.
6. Run focused source/unit/build checks, canonical repository verification,
   and separately authorized live plugin checks. Never bundle `.so` files into
   the Magisk module archive.

## Plugin #2 authorized scope

The owner requested implementation and live proof after pointing to
`simplez2/cpa-codex-agent-identity`. Primary-source review at commit
`b282b894626409c7e1524f2daec31dd62a394018` confirms a safe seam that does not
pretend to re-encrypt built-in OAuth: an `auth_provider` recognizes only
sidecar-owned Codex projections, CPA receives an opaque revocable key and
loopback `base_url`, and a separate process owns encrypted originals and the
data plane.

Plugin #2 will implement the smallest independently useful version of that
architecture:

- a `credential-security` native plugin declaring `auth_provider` and a
  redacted authenticated `management_api` status route;
- exact recognition of one versioned `credential_security_sidecar` Codex auth
  projection containing only an opaque `cpcs_` key, loopback endpoint, safe
  credential ID, and disable/prefix metadata;
- a companion Android/arm64 loopback sidecar with AES-256-GCM storage, external
  owner-only key files, authenticated import/list/rotate/delete management,
  and bounded HTTP/SSE forwarding to a fixed upstream;
- an isolated local upstream test plus a live-host canary using only a disabled
  synthetic projection, followed by exact canary cleanup.

This slice deliberately excludes built-in OAuth files, token refresh, Agent
Identity JWT/AgentAssertion, WebSocket forwarding, automatic migration, model
routing, and a plugin executor. Those require separate provider semantics or
credential authority and cannot be inferred from a registration canary.

## Progress

- [x] Verify the exact live core supports dynamic plugins.
- [x] Pin and inspect upstream source at deployed commit `cade44b9`.
- [x] Record high-risk intake `#20` and start `TERMUX-014`.
- [x] Add the Policy-and-Scheduling design, source, dashboard, and tests.
- [x] Build a deterministic Linux/glibc ARM64 `.so` with pinned,
      checksum-verified inputs.
- [x] Prove plugin registration, read-only management routes, policy behavior,
      hot reconfigure, disable, and re-enable on an isolated official host.
- [x] Resolve the Credential-Security provider/refresh boundary from executable
      host evidence: the current host lacks a safe transparent re-encryption
      seam for built-in OAuth providers.
- [x] Install a separately authorized live canary and prove registration,
      redacted status, safe delegate config, disable, and re-enable without a
      restart or service-health regression.
- [x] Observe real cooldown and recovery windows under existing Codex traffic;
      the scheduler excluded a cooling credential, restored it after recovery,
      and continued delegating without a core restart or health regression.
- [x] Implement the scheduler-owned Credential-Security slice as optional,
      bounded HMAC session affinity with TTL, LRU eviction, and immediate
      failover; keep it disabled by default and separate from encryption.
- [x] Hot-promote `policy-scheduler` `0.2.0` to live without restart, enable the
      verified `Session_id` signal, and observe a real affinity new/hit pair on
      the same opaque credential alias over three candidates.
- [x] Obtain a concrete sidecar-owned provider seam from verified primary
      source without weakening the built-in OAuth boundary. The accepted first
      slice is static bearer/PAT only; transparent built-in OAuth encryption
      remains unsupported.
- [x] Implement and prove source Plugin #2 `credential-security` `0.1.0` plus
      its encrypted loopback sidecar with vet/unit, deterministic plugin and
      Android sidecar builds, exact-host registration, disabled synthetic
      parsing, redacted management status, and disable/re-enable coverage.
- [x] Run the separately authorized disabled synthetic live-auth canary and
      remove that exact canary without touching real credentials; verify live
      Plugin #2 status redaction, no public ResourceRoute, and `200 → 404 →
      200` disable/re-enable lifecycle.
- [x] Add the supported interceptor design, operational documentation, and the
      explicit Model Router/Executor decision.
- [x] Recheck the official `v7.2.104` source after its release: credential
      weighting and cooldown internals changed, but the plugin ABI, plugin API,
      and host auth-provider refresh seam did not.
- [x] Recheck official upstream `origin/main` and Cockpit Tools primary source:
      upstream main still has no provider-owned persistence seam, while Cockpit
      encrypts its application account store and creates separate plaintext
      runtime projections for an embedded CLIProxyAPI sidecar.
- [x] Research official `zhumengling/codex-token-usage` HEAD `a5221681` and
      harden source `policy-scheduler` `0.3.0`: preserve configured built-in
      strategy for new/failover affinity bindings, isolate affinity and
      balancing by provider/model, and leave its usage/SQLite/token-protection
      features outside the scheduler-only contract.
- [x] Review the official CLIProxyAPI Plugins Store at `809039b7`, Quota Router
      at `fe7d617a`, Codex Quota Scheduler at `0eb9ff69`, Agent Identity at
      `b282b894`, Key Policy at `d3bc0f13`, and Account Config Manager at
      `4e920e4a`; accept only patterns that preserve the current capability and
      credential boundaries.
- [x] Hot-promote the reviewed `0.3.0` artifact, prove authenticated live
      metadata/status version `0.3.0`, and observe existing traffic continue
      delegating over three candidates without a PID change or restart.
- [x] Enable live `least-recently-used` selection with quota/tenant/plan/weight
      filters disabled; observe explicit LRU picks across cooldown and recovery
      (`3 → 2 → 3`) without a restart or deliberate model request.
- [x] Explain the post-canary `active_bindings: 0`: live config was persisted at
      `2026-07-28T13:57:07Z`, after the observed new/hit pair, so the documented
      affinity reconfigure reset cleared the process-local cache; PID, artifact,
      and listener remained unchanged and later metadata stayed stable.
- [x] Implement source `policy-scheduler` `0.3.1` operational hardening with
      bounded/redacted lifecycle, strategy, affinity, cooldown, effectiveness,
      and provider/model state-size projections plus config/scheduler/management
      fuzz targets.
- [x] Prove `0.3.1` with vet/unit and fuzz seeds, deterministic Linux/glibc ARM64
      build, ABI/dependency inspection, and isolated official-host registration,
      status, reconfigure, disable, and re-enable. The artifact SHA-256 is
      `76b828080d3d708aed5ca5f492898f00bb0a927ccd02169d44fba167c164aa2e`.
- [ ] Integrate both plugins' platform gates into canonical `./qa/verify`, then
      obtain executable Linux race and coverage-guided fuzz proof. The GitHub
      workflow must continue to call `qa/verify` rather than create a second
      verification authority. Policy Scheduler's three fuzz targets passed
      with the Linux/glibc test binary, but Android's VMA layout still blocks
      ThreadSanitizer execution.
- [x] Under the owner's explicit live-write authorization, hot-promote the
      reviewed `0.3.1` artifact without restart, apply the safe JSON policy,
      and verify registration, redacted status, PID/listener health, artifact
      hash, and `cpactl doctor`.
- [x] Complete the authorized `0.3.1 → 0.3.0 → 0.3.1` rollback rehearsal:
      each direction disabled the exact plugin, verified its route returned
      404, swapped only the versioned artifacts, re-enabled through the
      Management API, and checked the registered version and health.
- [ ] Complete the 24-hour then 72-hour soak and obtain a fresh
      `session_affinity_new → hit → failover/recovery` sequence on natural live
      traffic; if `Session_id` remains absent, disable affinity so config
      reflects reality.
- [x] Run focused proof, `./qa/verify --mode targeted`, and final diff review.
- [ ] Operationalize Credential Security's declared static bearer/PAT slice
      with preview/commit, bounded revisions, serialized mutation, atomic CPA
      projection synchronization, rollback, supervised restart, and authorized
      live recovery proof. Built-in OAuth encryption/refresh remains an
      intentional exclusion until the host exposes an official ownership seam.
- [x] Record the follow-on technical handoff, execution order, decision gates,
      recovery boundaries, and definition of done for later sessions.
- [ ] Complete the story only after the canonical plugin gate, Policy Scheduler
      soak, and Credential Security operational proof below pass, then run final
      verification.

## Last safe boundary

Plugin #1 version `0.3.1` in source and live retains the `0.3.0` strategy-preserving,
provider/model-scoped selection and affinity behavior and adds bounded/redacted
operational projections. Go vet/unit and fuzz seeds, deterministic Linux ARM64
build, ABI/dependency checks, and isolated official-host integration pass for
source artifact SHA-256
`76b828080d3d708aed5ca5f492898f00bb0a927ccd02169d44fba167c164aa2e`.
Coverage-guided Linux/glibc fuzzing passed for all three targets, but native
Android fuzz and ThreadSanitizer execution remain unsupported. The protected
Linux workflow is not yet wired; `make linux-ci` remains the module-owned gate
for an executable race pass.
Canonical `./qa/verify --mode targeted` passes on the complete worktree after
the `0.3.1` changes. The live service now runs `0.3.1`; the only discoverable
artifact has exact SHA-256
`76b828080d3d708aed5ca5f492898f00bb0a927ccd02169d44fba167c164aa2e` and
retains `session_affinity_enabled: true`, `session_affinity_header: Session_id`,
`quota_reserve_percent: 0`, no tenant/plan/backup mapping, and
`balance_strategy: least-recently-used`; `delegate_builtin: round-robin`
remains the explicit fallback setting. Promotion backup
`cli-proxy-api-state.20260728T165717Z.tar.gz` is retained; reviewed `0.3.0`,
`0.2.0`, and `0.1.0` artifacts remain recoverable as non-discoverable
`.rollback` files. The latest post-Plugin #2 lifecycle snapshot retained 50
bounded decisions, 258 process-total LRU picks, zero active affinity bindings,
and a bounded
`configured_but_ineffective` warning because no `Session_id` or metadata
signal was observed after the promotion.

Plugin #2 source `0.1.0` now implements the accepted sidecar-owned static
bearer/PAT slice. Unit proof covers AES-256-GCM persistence, wrong-key failure,
owner-only paths, default-disable, opaque-key rotation, delete, parser
coexistence, header stripping, fixed-upstream enforcement, redacted management,
and local HTTP/SSE forwarding. The sidecar additionally bounds the record store,
rejects proxy path traversal, and refuses cross-origin redirects. CLIProxyAPI
`7.2.103` isolated integration registered both plugins, parsed one disabled
synthetic projection, exposed no public Plugin #2 ResourceRoute, and
disabled/re-enabled cleanly. Deterministic artifact SHA-256 values are
`93579313869e031a266e12e13f2f9fa58dfa3b94131183396294f08770a1cfe8`
for the plugin and
`a473bbf4384ff842729f8d81e94a88be8ade749b07483f697869cf9a38f306f1`
for the Android sidecar. The authorized live host registered both plugins;
the disabled synthetic projection incremented Plugin #2 parsing counters,
remained disabled, was deleted by exact filename, and the plugin lifecycle
returned `200 → 404 → 200` without a PID change. No real credential, sidecar
store/key, or upstream model request entered this proof.

The initial file swap and config mtime touch did not activate `0.3.0` because
CLIProxyAPI `7.2.103` skips reload when the config content hash is unchanged.
Authenticated registry evidence showed the discovered `0.3.0` path paired
with registered metadata/status `0.2.0`, and `/proc/11065/maps` had no `0.3.0`
mapping. A bounded `decision_history_limit` change from 50 to 49 triggered the
material hot reload; restoring it to 50 returned the config to its original
SHA-256
`8307c9fc1e46a737324cdedd8a66a1fb05371b9ff959cfa0e7d8fb7fb38c5c3a`.
Registry metadata and status then reported `0.3.0`, `/proc/11065/maps` showed
the reviewed artifact, and PID `11065`, loopback listener `127.0.0.1:8317`,
dashboard/status routes, and `cpactl doctor` remained healthy without restart.
Existing traffic after reload initially continued delegating to built-in
round-robin over three candidates. The authorized policy update then changed
only `balance_strategy` to `least-recently-used`; status persisted the value,
and existing traffic produced explicit LRU selections over three candidates,
then two during cooldown, then three after recovery. No deliberate upstream
request, credential read, or credential migration was performed.

The earlier `0.2.0` live canary produced `session_affinity_new` then
`session_affinity_hit` with the same opaque alias over three candidates and
also retained two observed cooldown/recovery windows: the
scheduler candidate set fell from three to two and later returned to three at
`2026-07-28T12:38:48Z` and `2026-07-28T12:59:01Z`. Decisions remained
`delegated/no_strong_policy_decision`; no deliberate upstream probe or service
restart was generated by this work, and `cpactl doctor` passed after recovery.
Plugin #2's static sidecar-owned slice is locally implemented; any extension
to built-in OAuth remains gated on an official refresh/storage seam as
described above.

## Follow-on technical handoff — 2026-07-29 UTC

### Binding and start gate

- Continue only `TERMUX-014` with stable Harness run ID
  `cliproxyapi-plugin-suite-20260728`. Do not create a second story or plan.
- The post-retirement Git boundary is established: `91deb8d` contains only
  `TERMUX-015`, and `a12c113` contains the `TERMUX-014` handoff. Begin future
  plugin mutation only from a clean worktree after those commits. Do not reset,
  restore, or apply stash
  `3471b4d4b48929af817bcb67ee24f08c4ac0f2d6` onto plugin work.
- Root commands, management API writes, plugin/config swaps, service lifecycle
  changes, auth-file changes, sidecar keys/stores, and real upstream requests
  require separately stated exact authorization. A handoff or Harness story
  does not grant that authority.
- Keep binaries outside the Magisk ZIP. Keep management secrets, auth payloads,
  tokens, raw `StorageJSON`, and sidecar keys out of Git, Harness, command
  output, test fixtures, and documentation.

### Evidence and confidence at handoff

| Claim | State | Consequence for the next session |
|---|---|---|
| Policy Scheduler source/live `0.3.1` and rollback artifacts | Confirmed by unit, deterministic build, isolated-host, live promotion, and rollback evidence | Preserve behavior; close platform and soak evidence before changing policy semantics |
| Credential Security source `0.1.0` | Confirmed for the narrow static bearer/PAT sidecar slice by unit, deterministic build, isolated host, and disabled synthetic live parser proof | Do not treat parser registration as a working credential data plane |
| Credential sidecar availability | Confirmed absent at handoff: `127.0.0.1:18319` refused a read-only connection | Supervision, restart, projection sync, and real recovery remain unproved |
| Exact deployed core baseline | Conflicting: the plan header records live `7.2.104`/`c9417c8a`, while product, inventory, runbook, isolated host, and older evidence remain pinned to `7.2.103`/`cade44b9` | Re-query exact live metadata without exposing a secret, test against that exact official core, then reconcile every contract before live mutation |
| Canonical repository gate | Confirmed passing, but `qa/project-commands.json` currently runs no Go plugin test/build/integration command | Focused plugin proof is not yet owned by the single verification authority; this blocks story completion |
| Built-in OAuth encrypted refresh | Confirmed unsupported by checked `v7.2.104` and upstream-main plugin seams | Intentional non-goal; do not block the declared static bearer/PAT slice on speculative parity |

### Execution order

#### Work unit 0 — isolate and re-baseline

Objective: establish one uncontested post-retirement Git baseline and one exact
CLIProxyAPI target before changing either plugin.

Deliverables and acceptance evidence:

- preserve the established `91deb8d` retirement and `a12c113` handoff commit
  boundary and require a clean worktree before new `TERMUX-014` work;
- query Harness status and matrix and confirm `TERMUX-014` remains
  `in_progress` with this plan as `contract_doc`;
- recheck exact live core version, commit, plugin-support flag, registered
  plugin versions, artifact hashes, listener/PID health, and sidecar listener
  state through redacted metadata only;
- run both plugin unit/build/isolated-host workflows and
  `./qa/verify --mode targeted` on the established baseline;
- update product contract, inventory, runbook, toolchain pin, and isolated-host
  fixture together if `7.2.104` is the accepted target. Historical `7.2.103`
  evidence must remain labeled as historical rather than silently rewritten.

Recovery: make no live write in this unit. If the source baseline cannot be
separated without discarding work, stop and request owner direction.

#### Work unit 1 — make canonical verification own the plugin suite

Objective: remove the current split between focused plugin commands and the
repository's sole pass/fail authority.

Constraints and deliverables:

- preserve `./qa/verify` as the only CI entrypoint;
- add a repository-owned, non-secret plugin gate selected by the existing
  change classifier/command matrix;
- on Termux, run vet/unit, deterministic Linux/glibc ARM64 builds, ABI and
  dependency inspection, Android sidecar build, and isolated exact-host
  lifecycle proof;
- on a true Linux runner, run executable `go test -race` and coverage-guided
  fuzzing for both modules. Add the Credential Security equivalent of the
  Policy Scheduler `linux-ci` target if one coherent entrypoint is useful;
- pin the Go/core inputs used by CI and avoid treating an Android-compiled race
  binary as executable Linux evidence;
- change protected QA/workflow files only in a new process with an explicit
  exact Gauntlet maintenance allowlist.

Acceptance: a relevant plugin change causes local
`./qa/verify --mode targeted` and CI `./qa/verify --mode ci` to execute the
appropriate plugin gates; true Linux race/fuzz evidence passes; no additional
workflow command becomes a competing verification authority.

Recovery: revert only the scoped QA/workflow integration if it breaks unrelated
gates; the existing focused `scripts/termux-control cli-proxy-api-plugins`
entrypoint remains the diagnostic path, not the definition of pass.

#### Work unit 2 — close Policy Scheduler operational evidence

Objective: prove the existing `0.3.1` policy under natural traffic rather than
add new routing capabilities.

Acceptance evidence:

- Linux race/fuzz proof from work unit 1 passes without a data race or panic;
- collect redacted start, 24-hour, and 72-hour snapshots of lifecycle,
  strategy, affinity, cooldown, effectiveness, provider/model state bounds,
  authenticated status, PID/listener health, `cpactl doctor`, and externally
  mapped plugin generations;
- do not generate an upstream model request solely for the soak;
- if a supported signal naturally appears, observe a fresh
  `session_affinity_new → hit → failover/recovery` sequence without exposing
  the signal or `AuthID`;
- if no supported signal appears through the soak, disable session affinity
  through a separately authorized material config change and prove status and
  traffic health. Do not leave a knowingly ineffective policy enabled.

Recovery: use the already rehearsed exact-plugin disable and
`0.3.1 → 0.3.0` rollback path; never delete the plugin directory or restart
unless hot recovery fails and restart is separately authorized.

#### Work unit 3 — operationalize Credential Security's declared slice

Objective: make the static bearer/PAT sidecar slice safely operable without
claiming built-in OAuth ownership.

Blocking decision: choose who owns CPA projection commits. The recommended
boundary is an operator/controller-mediated commit path so the native plugin
and data-plane sidecar do not acquire the long-lived CPA management key. Giving
the sidecar direct Management API authority expands the security boundary and
requires an explicit owner decision before implementation.

Required source behavior and proof:

- preview is read-only, bounded, redacted, expiring, and revision-bound;
- commit serializes mutations, detects stale revisions, imports disabled by
  default, and atomically coordinates encrypted record plus CPA projection;
- rotate, enable/disable, and delete have explicit ordering, idempotent retry,
  operation status, and tested rollback for every partial-failure point;
- projection filenames and content remain versioned, path-safe, loopback-only,
  opaque, and free of original credentials;
- sidecar supervision defines exact executable, owner-only key/store paths,
  health check, start/restart behavior, logs, and recovery without bundling it
  into the Magisk ZIP;
- local proof covers restart, wrong-key failure, old opaque-key rejection after
  rotation, HTTP/SSE forwarding, store/projection reconciliation, interrupted
  commit, and rollback with no plaintext persistence or output;
- built-in OAuth files, refresh tokens, AgentAssertion, WebSockets, automatic
  migration, model routing, and executor behavior remain out of scope.

Live acceptance requires separate authorization and a disposable non-OAuth
credential: preview, disabled commit, exact projection verification, enable,
bounded HTTP/SSE canary, sidecar restart, opaque-key rotation, disable/delete,
and exact rollback/recovery. Preserve all pre-existing auth files and real
encrypted stores. Registration or a synthetic parser canary alone is not a
pass.

Recovery: disable the exact projection/plugin first, stop only the suite-owned
sidecar, preserve key/store material, restore the pre-canary projection set,
and verify CLIProxyAPI health. Delete only explicitly named disposable canary
artifacts after reconciliation succeeds.

#### Work unit 4 — reconcile contracts and complete the story

Update the product contract, runbook, inventory, versions/hashes, plan progress,
and recovery evidence from executable results. Store publication is not a
completion requirement: the official schema-v1 store cannot describe the
sidecar lifecycle, and split release ownership or a private registry remains a
separate product/distribution decision.

Definition of done:

- no unresolved core-version or contract contradiction;
- canonical Termux and true-Linux plugin gates pass through `qa/verify`;
- Policy Scheduler's soak and affinity enable/disable decision are complete;
- Credential Security's static bearer/PAT lifecycle, supervision, atomic
  projection operations, live canary, and rollback are executable and proven;
- no secret appears in Git, Harness, logs, fixtures, or documentation;
- focused proof and `./qa/verify --mode targeted` pass, the implementation trace
  records exact evidence, and the final scoped diff is reviewed;
- move this plan to `docs/plans/completed/`, update `story.contract_doc`, run
  `story complete TERMUX-014` for fresh proof, review the lifecycle-final diff,
  then run `./qa/verify` once more before claiming completion.

### Blocking and non-blocking decisions

Resolved start boundary:

- `TERMUX-015` retirement is committed separately as `91deb8d`; the initial
  `TERMUX-014` handoff is committed as `a12c113`.

Blocking before mutation or rollout:

- exact deployed CLIProxyAPI version and the accepted SDK/core pin;
- exact protected QA/workflow maintenance allowlist;
- CPA projection commit authority and sidecar supervision owner;
- explicit scope for every root, live, credential, or upstream canary action.

Non-blocking or out of scope for this story:

- official Plugin Store listing and release-repository split;
- transparent encryption/refresh of built-in OAuth until upstream exposes a
  provider-owned persistence seam;
- model router, executor, cross-provider routing, Key Policy RPM/budget, and
  speculative Pi Router parity.

### Next-session start sequence

1. Read `AGENTS.md`, `docs/WORKFLOW.md`, this plan, the product contract,
   ADR 0014, and the plugin runbook.
2. Run `git status --short`; stop before mutation if the worktree is not clean
   or if new changes cannot be attributed unambiguously to `TERMUX-014`.
3. Query `scripts/termux-control orchestrator status` and
   `scripts/termux-control orchestrator query matrix --story TERMUX-014`.
4. Run `scripts/termux-control cli-proxy-api-plugins status` and the read-only
   baseline checks from work unit 0 without reading or printing secrets.
5. Use `HARNESS_RUN_ID=cliproxyapi-plugin-suite-20260728` for every Harness
   state-writing command, keep the story `in_progress`, and begin with work
   unit 0. Do not call `story complete` until every definition-of-done item is
   executable evidence rather than a plan or agent assertion.

## Decisions

- The first plugin binary may declare both `management_api` and `scheduler`
  because they share policy state and observability; capability names and RPC
  methods remain exactly host-defined.
- The dashboard will bundle local static assets and expose only redacted
  runtime/decision projections. It will not return `StorageJSON`, tokens, raw
  auth files, or arbitrary host callback bodies.
- Plugin build artifacts remain ignored deployment inputs under the persistent
  runtime plugin directory, never module ZIP contents.
- The Magisk controller remains plugin-neutral. It reports host plugin support
  and installed artifact count but does not probe a hard-coded dashboard or
  export plugin-specific data/model-price variables.
- A generic encrypted wrapper around built-in OAuth is not yet accepted: the
  current host exposes no callback that delegates plugin-owned refresh back to
  a built-in auth provider. This is a blocking design fact for stage two, not a
  reason to add an executor or model router speculatively.
- Session affinity belongs to `scheduler`, not `auth_provider` or an
  interceptor. Its cache is process-local, stores only an HMAC digest and
  `AuthID`, is bounded by TTL/entry count, and fails over within the host's
  already eligible candidate set.
- Store distribution is not yet a completion signal. The official store expects
  `v<version>` releases, root-level `<id>.so` archives named
  `<id>_<version>_<goos>_<goarch>.zip`, and `checksums.txt`. The two local
  plugins have independent versions in one repository and no store-compatible
  release lane; Credential Security also requires an out-of-band supervised
  sidecar. Choose split release ownership or a pinned schema-v2 private
  registry before listing either plugin.
- Quota Router's cancellable, coalesced, request-triggered refresh worker is a
  useful future quota pattern, but adopting it would add auth reads and fixed
  upstream network calls. Keep that as a separately accepted capability rather
  than silently expanding Policy Scheduler's current no-token/no-network
  boundary.
- Credential Security should adopt Agent Identity and Account Config Manager's
  preview/commit, bounded revision, mutation-lock, atomic projection sync, and
  rollback patterns before any real credential rollout. Key Policy's
  downstream-key/RPM/budget surface is not part of the current plugin contract.

## Risks

- Plugins are trusted in-process native code; a panic, memory error, slow
  callback, or malicious resource page can crash or compromise the service.
- Same-origin resource pages can reuse a management key stored by Management
  Center. Installing and enabling such a plugin grants admin-equivalent trust.
- Linux/glibc ARM64 output is required; Termux's default Android/bionic
  toolchain output is not a valid substitute.
- Scheduler state can misroute real traffic if tenant, quota, cooldown, or
  fallback semantics are inferred incorrectly from candidate fields.
- Encryption-at-rest protects copied/backed-up files only. In-process code
  still accesses plaintext and this design is not an HSM boundary.

## Recovery

Before Plugin #2 live deployment, recovery is removing only suite-owned
source/docs and ignored build outputs after exact diff review. Plugin #1 live
recovery remains: disable `policy-scheduler`, move only
`policy-scheduler-v0.3.1.so` aside, restore
`policy-scheduler-v0.3.0.so.rollback`, and re-enable. Promotion backup
`cli-proxy-api-state.20260728T165717Z.tar.gz` remains available.

Plugin #2 canary recovery is independent: disable `credential-security`,
verify its authenticated route returns 404, delete only the exact disabled
synthetic auth filename, and move only `credential-security-v0.1.0.so` out of
discovery. Preserve any real sidecar data/key directories; none are authorized
for the parser canary. Restart only if hot unload cannot recover, using the
existing `cpactl` procedure. Never purge `/data/local/cli-proxy-api`.

## External side effects

Use stable Harness run ID `cliproxyapi-plugin-suite-20260728`. Network reads are
limited to official CLIProxyAPI and Go release sources with pinned checksums.
Live writes, root commands, service lifecycle changes, management API writes,
and upstream model requests require separately stated exact scope and impact.

Actual external reads used official CLIProxyAPI source/tag/release metadata,
official `zhumengling/codex-token-usage` HEAD
`a5221681fbcca071ac9f0dcb1ff37f8edcd97a6d`,
`simplez2/cpa-codex-agent-identity` HEAD
`b282b894626409c7e1524f2daec31dd62a394018` for the verified sidecar-owned
opaque-projection architecture. Plugin #2 source was implemented locally and
does not copy that repository's Agent Identity/JWT data plane. Build inputs
used the checksum-pinned `7.2.103` Linux ARM64 archive, Termux Go package, and
signed pacman GCC/glibc packages. No package was installed.

The authorized live canary created one private `cpactl` backup, installed the
exact reviewed `.so` under the persistent plugin directory, and persisted only
the safe `plugins.configs.policy-scheduler` stanza through the Management API.
It did not restart the service, mutate auth files, print or persist a
management secret, or deliberately send an upstream model request.

The subsequent authorized controller maintenance backed up only the installed
`scripts/cpactl`, replaced it with the reviewed plugin-neutral implementation,
and did not restart or reconfigure the running core. The backup is
`cpactl.pre-plugin-neutral-20260728` beside the live controller.

The authorized Plugin #2 live canary uploaded one disabled synthetic projection
through `POST /v0/management/auth-files`, verified the exact filename and
disabled state, deleted it through the matching `DELETE`, and toggled only
`credential-security` through the Management API. It did not start the
sidecar, create a data/key directory, read a real auth file, emit a management
key, or send an upstream request. Final live checks retained PID `11065`,
loopback listener `127.0.0.1:8317`, two registered/enabled plugins, status
redaction, and `cpactl doctor` pass.

The official `v7.2.104` tag was checked after release. Its source adds
validated persisted credential `weight` handling and changes cooldown/selector
internals, but `sdk/pluginabi/types.go`, `sdk/pluginapi/types.go`, and
`internal/pluginhost/auth_provider.go` are unchanged from `v7.2.103`. It
therefore does not provide the provider-owned refresh/storage seam required to
open Credential-Security. The isolated validation/toolchain baseline remains
`v7.2.103`; later evidence records live `v7.2.104`, and work unit 0 must
reconcile that split before another live mutation.

Official upstream `origin/main` at
`c9417c8ae9b16fabc0386ca35d36f13bf8b1d678` was also checked and retains the
same limitation. Cockpit Tools primary source at
`923cc6c45b8dbfe743ea2e04be33d2fe4fbf5654` confirms that its AES-256-GCM layer
encrypts application-owned account details, not CLIProxyAPI native-plugin
`StorageJSON`; it writes separate plaintext `0600` OAuth projections for its
embedded sidecar. That architecture cannot be claimed as a transparent plugin
port on this host.

## Validation

Required evidence includes policy unit tests (including all-candidates-fail),
ABI/export inspection, deterministic Linux ARM64 builds, no-secret scans,
registration and read-only route proof, disable/rollback proof, and the
repository's canonical `./qa/verify` gates. Real quota/cooldown stability must
be reported separately from deterministic tests and cannot be inferred from
Harness metadata.

Focused proof completed:

- Version `0.3.1`: `scripts/termux-control cli-proxy-api-plugins test`, `build`,
  and `integration` passed Go formatting/vet/unit/fuzz seeds, deterministic
  Linux ARM64 build, ABI/dependency checks, redacted observability assertions,
  and isolated official-host registration/reconfigure/disable/re-enable. The
  source artifact SHA-256 is
  `76b828080d3d708aed5ca5f492898f00bb0a927ccd02169d44fba167c164aa2e`.
  Direct Android fuzz execution was attempted and rejected by the Go tool with
  `-fuzz flag is not supported on android/arm64`; all three fuzz targets later
  passed with the Linux/glibc test binary, while executable Linux race proof
  remains open.
- Version `0.3.0`: `scripts/termux-control cli-proxy-api-plugins all` passed Go
  formatting, vet/unit tests for strategy-preserving affinity and route-scoped
  rotation/LRU/weighted state, deterministic Linux ARM64 build,
  ABI/dependency checks, no-secret status checks, and isolated official-host
  registration/reconfigure/disable/re-enable. The source artifact SHA-256 is
  `786b6f35407706858700cfe6378bc0037e090e662bf0bd90d2678660a72f8759`.
- Version `0.2.0`: `scripts/termux-control cli-proxy-api-plugins all` passed Go
  formatting, vet/unit coverage, deterministic build, ABI/dependency checks,
  no-secret status checks, hot affinity reconfiguration, and isolated official
  host registration/disable/re-enable. The artifact SHA-256 is
  `a25d0c4f08c5a3aaa687770921a7554c47eeb371a21ebd786ad7b62ea0659af0`.
- The earlier live version `0.1.0` artifact SHA-256 is
  `f411ab7caa7a178e54577d70b024ba4a2ce7a3d6310f63a39f2d3b73f61fa312`.
- Live feasibility probe returned `X-Cpa-Support-Plugin: 1` for `7.2.103` /
  `cade44b9`. The subsequent authorized canary registered version `0.1.0`,
  exposed 14 config fields, saw three active redacted credential projections,
  cleanly disabled and re-enabled, and kept `cpactl doctor` passing without a
  PID change or restart.
- Live `0.2.0` promotion preserved PID `11065`, installed the exact isolated
  artifact hash, registered 19 fields, left one discoverable `.so`, and passed
  `cpactl doctor`. With `Session_id`, live decisions recorded one new binding
  and one hit on the same opaque credential alias over three candidates. With
  `Authorization`, decisions continued safely but created no binding, proving
  that built-in client auth is not exposed to the scheduler on this path.
- Live `0.3.0` promotion installed the exact source artifact SHA-256, retained
  `0.2.0` as a non-discoverable rollback, and kept one discoverable `.so`.
  Config mtime alone was correctly diagnosed as insufficient because the core
  hash-checks bytes; a bounded material config reload activated metadata and
  status version `0.3.0`, after which the original config SHA-256, PID `11065`,
  loopback listener, authenticated routes, and `cpactl doctor` all matched the
  pre-reload boundary. Existing traffic continued delegating over three
  candidates without a deliberate upstream probe.
- The live policy update persisted only `balance_strategy:
  least-recently-used`; normalized status retained session affinity, quota
  reserve `0`, round-robin fallback, TTL `3600`, and max entries `4096`.
  Existing traffic produced explicit LRU selections with candidate counts
  `3 → 2 → 3`, proving cooldown exclusion and recovery without restart.
- The later zero-binding snapshot was correlated with the live config mtime
  `2026-07-28T13:57:07Z`, after the new/hit timestamps. This matches the
  documented cache reset on affinity reconfigure and is not a premature TTL
  expiry. Subsequent read-only checks found unchanged config, artifact, and PID
  inode/size/mtime metadata and kept management status HTTP 200.
- Existing Codex traffic produced real cooldown and recovery evidence. At
  `12:57:45Z` the plugin received two candidates while one credential had a
  future `next_retry_after`; at `12:59:01Z` it again received three candidates
  and continued delegating. An earlier `12:32:28Z` to `12:38:48Z` window showed
  the same two-to-three recovery. The authenticated status route stayed HTTP
  200 and `cpactl doctor` passed after the later recovery.
- Live status and logs contained no forbidden credential fields or management
  secret. The plugin-specific dashboard returned HTTP 200 with a same-origin
  warning, self-hosted JavaScript, no browser storage access, and no unsafe DOM
  sink. The controller source no longer probes a plugin-specific dashboard;
  plugin health is verified through the plugin's own registered routes.
- The focused Magisk module suite passed after removing plugin-specific data,
  environment, and dashboard assumptions. The live `cpactl status` now reports
  plugin support `1` and one installed `.so` without naming a plugin; PID,
  loopback listener, and `cpactl doctor` remained unchanged and healthy.
- Go security hardening moved dashboard JavaScript to a self-hosted exact
  resource under `script-src 'self'`, removed browser storage access, generated
  lab management keys from `/dev/urandom`, bounded diagnostic tag strings, and
  kept the required C ABI in one audited file.
- Native `go test -race` is unsupported on `android/arm64`. A Linux/ARM64 race
  binary compiled successfully but ThreadSanitizer cannot execute under the
  Android 39-bit VMA layout (`unsupported VMA range`). Concurrency therefore has
  locking and stress coverage but no executable race-detector pass on this
  device; this remains explicit missing evidence.
- After the `0.2.0` affinity change, `./qa/verify --mode targeted` passed all
  canonical Harness, policy, build, unit, integration, acceptance, coverage,
  and mutation gates on the complete worktree.
- After the `0.3.0` strategy hardening, `./qa/verify --mode targeted` again
  passed all canonical Harness, policy, build, unit, integration, acceptance,
  coverage, and mutation gates on the complete worktree.
- After the `0.3.1` operational hardening, `./qa/verify --mode targeted` passed
  the same canonical gates on the complete worktree. This does not replace the
  still-pending executable Linux race gate.
- Live promotion and rollback rehearsal on 2026-07-28/29 UTC used the reviewed
  `0.3.1` hash above, preserved PID `11065` and listener `127.0.0.1:8317`,
  kept exactly one discoverable `.so`, and passed `cpactl status`/`cpactl doctor`
  at the final boundary. No auth file, management secret, or deliberate
  upstream model request was accessed or emitted.
- Detailed partial implementation trace `#26` records the repository proof and
  the protected-workflow, Linux race/fuzz, live affinity, soak, and rollback
  gaps under stable run ID `cliproxyapi-plugin-suite-20260728`.
- Partial trace `#27` records the separately authorized live `0.3.1` promotion,
  safe policy application, rollback rehearsal, final health boundary, and the
  remaining affinity/soak/race evidence under the same stable run ID.
- Partial trace `#28` records Plugin #2 primary-source verification, the local
  sidecar-owned implementation, focused proof, deterministic artifact hashes,
  and the remaining Linux/live-canary evidence under the same stable run ID.
- Credential Security `scripts/termux-control cli-proxy-api-plugins test`,
  `build`, and `integration` passed vet/unit, deterministic Linux/glibc plugin
  and Android sidecar builds, ABI inspection, exact-host `7.2.103` parsing
  coexistence, redacted status, public
  ResourceRoute rejection, and disable/re-enable. The focused hardening added
  bounded store capacity and fixed-upstream path/redirect tests; the
  deterministic sidecar hash is
  `a473bbf4384ff842729f8d81e94a88be8ade749b07483f697869cf9a38f306f1`.
  A Linux race attempt compiled the non-root packages but execution hit
  Android's 39-bit VMA limitation; the root cgo test additionally hit the local
  glibc stack-guard link limitation.
- The authorized live Plugin #2 canary passed with `parse_total=8` before the
  final lifecycle check, `parse_handled=3`, `parse_rejected=0`, exact canary
  deletion, status redaction, public resource `404`, and `200 → 404 → 200`
  disable/re-enable. `cpactl status`/`doctor` remained healthy with PID `11065`;
  `/proc/11065/maps` still shows older scheduler generations as the documented
  hot-reload warning.
- After Plugin #2 sidecar hardening, live parser/lifecycle proof, and final
  documentation updates, `./qa/verify --mode targeted` passed the canonical
  Harness, policy, build, unit, integration, acceptance, coverage, and mutation
  gates on the complete worktree.
