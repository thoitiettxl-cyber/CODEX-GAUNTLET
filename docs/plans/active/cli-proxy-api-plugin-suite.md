# Build the CLIProxyAPI policy and credential plugin suite

Harness story: `TERMUX-014`

## Current context

The live Magisk-managed CLIProxyAPI service on `127.0.0.1:8317` reports
version `7.2.103`, commit `cade44b9`, and `X-CPA-SUPPORT-PLUGIN: 1`. The
matching upstream tag uses native ABI version 1 and JSON RPC schema version 2.
The repository currently owns the Magisk controller but deliberately keeps
runtime-installed plugin binaries outside the module ZIP.

The requested suite is recovery-sensitive and must be staged in host-defined
capability order. Existing unrelated `pi-router` worktree changes must remain
untouched. No live config, management secret, auth payload, or token may enter
Git, Harness state, test output, or documentation.

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
- [ ] Obtain a concrete plugin-owned provider or new official refresh/storage
      seam before implementing Credential-Security encryption-at-rest.
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
- [x] Run focused proof, `./qa/verify --mode targeted`, and final diff review.
- [ ] Complete the story only after the Credential-Security provider/refresh
      gate above is satisfied, then run final verification.

## Last safe boundary

Plugin #1 source version `0.3.0` now adds strategy-preserving, provider/model
scoped selection and affinity over the bounded `0.2.0` slice. Go vet/unit
proof, deterministic Linux ARM64 build, ABI/dependency checks, and isolated
official-host integration pass for source artifact SHA-256
`786b6f35407706858700cfe6378bc0037e090e662bf0bd90d2678660a72f8759`.
Canonical `./qa/verify --mode targeted` also passes on the complete worktree.
The separately managed live service now runs `0.3.0`; the only discoverable
artifact has exact SHA-256
`786b6f35407706858700cfe6378bc0037e090e662bf0bd90d2678660a72f8759`
and retains
`session_affinity_enabled: true`, `session_affinity_header: Session_id`,
`quota_reserve_percent: 0`, no tenant/plan/backup mapping, and
`balance_strategy: least-recently-used`; `delegate_builtin: round-robin`
remains the explicit fallback setting. Promotion created private backup
`cli-proxy-api-state.20260728T145931Z.tar.gz`; the later policy update created
`cli-proxy-api-state.20260728T152248Z.tar.gz`; reviewed `0.2.0` and `0.1.0`
artifacts remain recoverable as non-discoverable `.rollback` files.

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
Plugin #2 remains gated on a concrete provider or official refresh/storage
seam as described above.

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

Before live deployment, recovery is removing only suite-owned source/docs and
ignored build outputs after exact diff review. For the current live canary,
disable the exact plugin through the Management API first, move only
`policy-scheduler-v0.3.0.so` aside, restore
`policy-scheduler-v0.2.0.so.rollback` to its discoverable `.so` filename, and
re-enable it through a material config change. The private policy backup is
`cli-proxy-api-state.20260728T152248Z.tar.gz`; promotion backup
`cli-proxy-api-state.20260728T145931Z.tar.gz` remains separately available.
Restart the module only if hot
reload cannot recover, using the existing `cpactl` recovery procedure. Never
purge `/data/local/cli-proxy-api`.

## External side effects

Use stable Harness run ID `cliproxyapi-plugin-suite-20260728`. Network reads are
limited to official CLIProxyAPI and Go release sources with pinned checksums.
Live writes, root commands, service lifecycle changes, management API writes,
and upstream model requests require separately stated exact scope and impact.

Actual external reads used official CLIProxyAPI source/tag/release metadata,
official `zhumengling/codex-token-usage` HEAD
`a5221681fbcca071ac9f0dcb1ff37f8edcd97a6d`, the checksum-pinned `7.2.103`
Linux ARM64 archive, the checksum-pinned Termux Go package, and signed pacman
GCC/glibc packages. No package was installed.

The authorized live canary created one private `cpactl` backup, installed the
exact reviewed `.so` under the persistent plugin directory, and persisted only
the safe `plugins.configs.policy-scheduler` stanza through the Management API.
It did not restart the service, mutate auth files, print or persist a
management secret, or deliberately send an upstream model request.

The subsequent authorized controller maintenance backed up only the installed
`scripts/cpactl`, replaced it with the reviewed plugin-neutral implementation,
and did not restart or reconfigure the running core. The backup is
`cpactl.pre-plugin-neutral-20260728` beside the live controller.

The official `v7.2.104` tag was checked after release. Its source adds
validated persisted credential `weight` handling and changes cooldown/selector
internals, but `sdk/pluginabi/types.go`, `sdk/pluginapi/types.go`, and
`internal/pluginhost/auth_provider.go` are unchanged from `v7.2.103`. It
therefore does not provide the provider-owned refresh/storage seam required to
open Credential-Security, and the deployed target remains `v7.2.103`.

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
