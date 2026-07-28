# CLIProxyAPI policy and credential plugin suite contract

## Outcome and current phase

This repository owns source and repeatable build/test tooling for a staged
CLIProxyAPI plugin suite under `modules/cli-proxy-api-plugins/`. Plugin binaries
remain runtime-installed artifacts and are never bundled into the Magisk module
ZIP.

The current source and separately managed live phase include plugin #1,
`policy-scheduler` version `0.3.1`, and plugin #2,
`credential-security` version `0.1.0`. Plugin #1 provides:

- official capability `management_api`, providing read-only observability;
- official capability `scheduler`, implementing `scheduler.pick`;
- optional bounded session affinity inside `scheduler`, disabled by default;
- host callbacks `host.auth.list` and `host.auth.get_runtime` for current state;
- no auth-file read, `host.auth.get`, `host.auth.save`, token logging, network
  execution, model routing, or executor capability.

Plugin #2 is now scoped for a sidecar-owned static bearer/PAT vertical slice;
source version `0.1.0` is implemented and its live disabled-parser canary has
passed. It must not claim transparent encryption or refresh ownership for
built-in OAuth. Plugin #3 and an executor are explicitly omitted because no
target requirement demonstrates cross-provider routing or a new backend.
Strategy-preserving affinity behavior follows
[ADR 0014](../decisions/0014-preserve-policy-scheduler-routing-semantics.md).

## Evidence baseline

Evidence collected on 2026-07-28 UTC:

| Claim | State | Evidence |
|---|---|---|
| Live target supports native plugins | Confirmed | The active loopback service returned `X-Cpa-Support-Plugin: 1`, version `7.2.103`, commit `cade44b9`; an authenticated canary subsequently registered the plugin. |
| ABI and method taxonomy | Confirmed | Official `router-for-me/CLIProxyAPI` tag `v7.2.103` at `cade44b9`: native ABI 1, JSON schema 2. |
| Linux ARM64 plugin loads | Confirmed in isolated host | Checksum-pinned official `CLIProxyAPI_7.2.103_linux_aarch64.tar.gz` loaded the built `.so`, registered both capabilities, served routes, hot-reconfigured, disabled, and re-enabled it. |
| Source version `0.2.0` affinity slice | Confirmed in isolated host | Go vet/unit tests cover HMAC signal isolation, sticky hits, TTL expiry, failover, reconfigure reset, input/cache bounds, and key failure. The deterministic Linux ARM64 artifact loaded in the official host, registered 19 config fields, hot-enabled affinity config, then disabled/re-enabled without an upstream request. |
| `codex-token-usage` scheduler reference | Confirmed from official repository | `zhumengling/codex-token-usage` HEAD `a5221681fbcca071ac9f0dcb1ff37f8edcd97a6d` on 2026-07-28 keeps rotation state per provider/model and, when affinity or filtering requires an explicit `AuthID`, mirrors CPA `fill-first` or `round-robin`. Its token-window concurrency protection depends on the separate `usage` capability, SQLite history, auth identity reads, and request reservations, so that portion is not portable into this scheduler-only boundary. |
| Source version `0.3.0` strategy hardening | Confirmed in isolated host | Affinity keys and balancing state are provider/model scoped. New and failover bindings use explicit weighted/LRU policy when configured; otherwise they mirror `delegate_builtin`. Balance-strategy reconfigure clears local selection state. Vet/unit, deterministic Linux ARM64 build, ABI/dependency checks, and official-host integration passed for artifact SHA-256 `786b6f35407706858700cfe6378bc0037e090e662bf0bd90d2678660a72f8759`. No `usage` capability, auth read, SQLite store, token logging, or probe request was added. |
| Source version `0.3.1` operational projection | Confirmed in repository/unit/isolated-host proof; executable race proof pending | Read-only status now includes process generation/reconfigure counts, strategy counters, affinity lifecycle counters, observed cooldown exclusions, configured-but-ineffective policy fields, bounded provider/model state sizes, and an explicit external mapped-library check warning. It stores no raw signal or `AuthID` in these projections. All three coverage-guided fuzz targets passed with the Linux/glibc test binary; the race binary compiled, but Android's 39-bit VMA layout prevents ThreadSanitizer execution, so true Linux race CI remains required. |
| Source Plugin #2 `0.1.0` | Confirmed in unit, isolated-host, and live disabled-parser canary proof | The native AuthProvider recognizes only versioned sidecar projections, declines ordinary Codex files, exposes only a redacted authenticated status route, and registers no public ResourceRoute. The companion Android/arm64 sidecar encrypts static bearer/PAT values with AES-256-GCM, keeps the key in a separate owner-only file, returns disabled projections by default, rotates opaque keys, enforces a bounded record store and fixed proxy path/redirect boundary, and forwards bounded HTTP/SSE requests to a fixed upstream. Deterministic artifact SHA-256 values are `93579313869e031a266e12e13f2f9fa58dfa3b94131183396294f08770a1cfe8` for the plugin and `a473bbf4384ff842729f8d81e94a88be8ade749b07483f697869cf9a38f306f1` for the Android sidecar. |
| Live module plugins are installed | Confirmed | SHA-256-identical `policy-scheduler-v0.3.1.so` and `credential-security-v0.1.0.so` are the two discoverable plugins below the persistent plugin directory. Authenticated status reports versions `0.3.1` and `0.1.0`; the disabled synthetic Plugin #2 parser canary was removed by exact filename and live disable/re-enable returned `200 → 404 → 200`. PID `11065`, loopback listener, and `cpactl doctor` remained healthy without restart. Reviewed scheduler `v0.3.0`, `v0.2.0`, and `v0.1.0` artifacts remain recoverable as non-discoverable `.rollback` files. |
| Live session-affinity baseline | Confirmed on `0.2.0`; fresh `0.3.1` proof pending | Earlier Codex traffic produced `session_affinity_new` followed by `session_affinity_hit` with the same opaque credential alias over three eligible candidates. Live evidence also showed that client `Authorization` is not present in scheduler options on this path; the operational signal is `Session_id`, while `api_key_id` metadata remains available for a compatible future host/provider seam. The final `0.3.1` snapshot retained this configuration but reported zero bindings and `session_affinity` as configured but ineffective because no signal had been observed in current-generation traffic. |
| Live cooldown/recovery baseline | Confirmed on `0.2.0`; LRU transition confirmed on `0.3.0` | Existing Codex traffic on `0.2.0` produced two real cooldown/recovery windows. After the `0.3.0` LRU update, live traffic produced `3 → 2 → 3` candidates and explicit `least_recently_used` selections while the authenticated status route and `cpactl doctor` stayed healthy without restart or deliberate probe. |
| Official upstream refresh/storage seam | Not confirmed | The released `v7.2.104` source and official `origin/main` at `c9417c8ae9b16fabc0386ca35d36f13bf8b1d678` leave `sdk/pluginabi/types.go`, `sdk/pluginapi/types.go`, and `internal/pluginhost/auth_provider.go` unchanged from `v7.2.103`; no callback persists refreshed built-in OAuth data through plugin-owned encryption. |
| Cockpit Tools encryption boundary | Confirmed, not directly portable | Official `jlcodes99/cockpit-tools` source at `923cc6c45b8dbfe743ea2e04be33d2fe4fbf5654` encrypts application-owned account detail files with AES-256-GCM, then materializes separate plaintext `0600` OAuth JSON files for its embedded CLIProxyAPI sidecar and registers runtime auth with `WithSkipPersist`. It does not implement encryption through the native CLIProxyAPI plugin ABI. |
| Sidecar-owned Plugin #2 seam | Architecture confirmed from primary source; local exact-host and live parser proof passed | `simplez2/cpa-codex-agent-identity` HEAD `b282b894626409c7e1524f2daec31dd62a394018` keeps original JWT/PAT values in an AES-256-GCM sidecar store, exposes only an opaque sidecar key plus fixed `base_url` through CPA auth files, and registers an AuthProvider without a public ResourceRoute. Its release baseline is CPA `v7.2.95`; the local implementation supports the narrower static bearer/PAT slice on `7.2.103`. |

The exact deployed binary, not this document, remains authoritative. Every
deployment must recheck `X-CPA-SUPPORT-PLUGIN: 1` before installation.

## Plugin #1 — Policy and Scheduling

### Capability and routes

The binary declares only host-defined taxonomy:

- `scheduler` → `scheduler.pick`;
- `management_api` → `management.register` and `management.handle`;
- read-only host callbacks → `host.auth.list` and
  `host.auth.get_runtime`.

It registers authenticated
`GET /v0/management/policy-scheduler/status` and the unauthenticated static
resource shell
`GET /v0/resource/plugins/policy-scheduler/dashboard`. The shell contains no
credential state and loads no third-party script. The operator-supplied
management key remains in page memory; the page does not read or write
`localStorage`.

### Policy chain

`scheduler.pick` applies this order to host-supplied `Candidates`:

1. Recheck `Status` and remove `disabled`, `cooldown`, and `unavailable`.
2. Resolve tenant from `tenant_header` or `tenant_metadata_key`; when mapped,
   keep the matching `tenant_group_attribute`.
3. Remove candidates whose known `quota_remaining_attribute` is below
   `quota_reserve_percent`. Unknown quota is not treated as exhausted.
4. Keep maximum `Priority`, then the first matching configured `plan_tiers`
   value from `plan_tier_attribute`.
5. When session affinity is enabled and a configured signal is present, reuse
   its still-eligible binding or fail over immediately to another eligible
   candidate. New/failover bindings use weighted or LRU selection when that
   policy is explicit; in delegate mode they mirror the configured built-in
   `round-robin` or `fill-first` strategy. Rotation and affinity are scoped by
   normalized provider set and model.
6. Without an affinity decision, apply `least-recently-used` or smooth
   `weighted` balancing when explicitly configured.
7. When filtering empties the set, choose the first configured backup that is
   still active and present in host `Candidates`.
8. With no strong policy decision and `balance_strategy: delegate`, return
   `DelegateBuiltin: round-robin` or `fill-first`.

If no valid candidate or eligible backup remains, the plugin returns
`scheduler_no_eligible_candidate`, HTTP status intent 503, and `retryable:
true`. It never chooses a known failing candidate merely to produce an
`AuthID`.

### Configuration fields

All fields live under `plugins.configs.policy-scheduler`; only `enabled` and
`priority` belong to the host.

| Field | Purpose |
|---|---|
| `tenant_header`, `tenant_metadata_key` | Request tenant signal. |
| `tenant_group_attribute`, `tenant_groups`, `deny_unknown_tenant` | Candidate partition policy. |
| `quota_reserve_percent`, `quota_remaining_attribute` | Configurable reserve gate; never hardcoded. |
| `plan_tier_attribute`, `plan_tiers` | Plan-tier order after numeric priority. |
| `balance_strategy`, `weight_attribute` | Delegate, LRU, or weighted same-tier behavior. |
| `backup_auth_ids` | Ordered backups, limited to host-supplied candidates. |
| `delegate_builtin` | `round-robin` or `fill-first`. |
| `decision_history_limit` | Bounded in-process redacted history, maximum 200. |
| `session_affinity_enabled` | Enable process-local sticky credential selection; default `false`. |
| `session_affinity_header`, `session_affinity_metadata_key` | Header fallback and preferred string metadata identity source; either may be blank, but not both while enabled. |
| `session_affinity_ttl_seconds` | Sliding TTL, 60-86400 seconds; default 3600. |
| `session_affinity_max_entries` | Bounded cache size, 1-10000; default 4096 with LRU eviction. |

Config hot reload replaces policy atomically. Affinity-field changes clear the
affinity cache; balance strategy, weight attribute, or delegated built-in
changes clear local selection state. Disable removes scheduler and management
routes through the host; shutdown resets all process-local state. The plugin
writes no separate account database.

The read-only status projection also exposes bounded operational observability.
Generation and reconfigure counters identify hot-reload epochs; strategy and
affinity counters are process-local; effectiveness evidence resets for each
generation. Provider/model state sizes are capped to the first 100 sorted
scopes, with an omission count. Configured tenant/quota/plan/weight/backup or
affinity inputs are reported as ineffective only after scheduler traffic has
been observed without the corresponding safe signal/attribute. Cooldown
counts include only statuses present in the plugin's `Candidates`; the host
may have filtered cooldown credentials before `scheduler.pick`. Older mapped
shared objects cannot be enumerated through the current ABI, so status emits an
operator warning requiring an external `/proc/<pid>/maps` check after reload.

Affinity values are never stored or returned. The plugin HMACs provider set,
model, tenant, source kind, and signal with a process-random 256-bit key, then
retains only the digest-to-`AuthID` binding in memory. The binding is accepted
only after status, tenant, quota, priority, and plan filtering. If the bound
credential is absent, cooling, disabled, or otherwise filtered, the plugin
rebinds to an eligible candidate instead of trapping the client. Reconfigure
of any affinity field clears the cache; shutdown/restart clears the cache and
key. This is request-routing privacy, not credential encryption-at-rest.

On the deployed built-in Codex path, live evidence confirms `Authorization`
is consumed before `scheduler.pick`, so API-key affinity cannot be claimed from
that header. The live policy uses `Session_id`, which produced a real sticky
hit on the earlier `0.2.0` generation but has not appeared in current `0.3.1`
traffic. Per-API-key affinity requires the host or a compatible provider to supply
an opaque string identity in configured scheduler metadata; the plugin does
not read auth files or invent that identity.

### Host limitations at 7.2.103

These are confirmed constraints, not missing plugin code:

1. Core calls `availableAuthsForRouteModel` before `scheduler.pick`, removing
   blocked credentials and every lower `Priority` tier.
2. Host accepts only an `AuthID` present in `Candidates`; a plugin cannot select
   a lower-tier backup omitted by step 1.
3. `schedulerAuthCandidates` does not populate `Metadata`; tenant, quota,
   weight, and plan data must arrive as non-sensitive `Attributes`.
4. Built-in credential parsers do not promote arbitrary auth-file JSON keys
   into `Attributes`. A compatible provider or another official host seam must
   supply these tags before live tenant/quota policy can be claimed.

The later official `v7.2.104` tag adds validated persisted `weight` handling and
reworks cooldown/weighted selection, but does not change the plugin ABI or
provider refresh/storage ownership. Those changes are not active on the live
`v7.2.103` target and do not satisfy the Credential-Security gate.

The plugin rechecks the requested chain for defense in depth and exposes the
limitations in its dashboard. It does not claim cross-tier fallback or
automatic live quota measurement on this host version.

## Plugin #2 — Credential Security sidecar slice

The intended capability boundary is:

- `auth_provider` (**Credential Provider**): `auth.identifier`, `auth.parse`,
  `auth.login.start`, `auth.login.poll`, and `auth.refresh`;
- `management_api`: rotation policy, key policy, affinity TTL, revoke/disable,
  and redacted audit status;
- optional `request_interceptor`: `request.intercept_before` for tenant header
  normalization and `request.intercept_after` for credential-context rewrites;
- optional `response_interceptor`: `response.intercept_after`, non-streaming
  only;
- optional `response_stream_interceptor`:
  `response.intercept_stream_chunk`, including `ChunkIndex = -1` header init,
  with bounded constant-time chunk handling.

Credential selection or rejection remains exclusively in `scheduler`. The
first Plugin #2 slice owns only sidecar-managed static bearer/PAT credentials:
the sidecar encrypts the original at rest, returns an opaque `cpcs_` key for a
disabled-or-enabled CPA projection, and forwards HTTP/SSE requests through a
fixed loopback-to-upstream path. The plugin never reads auth files directly,
and no interceptor may log `StorageJSON`, an access token, a refresh token,
cookie, management key, or raw credential.

This does not make a generic “encrypt every existing OAuth file” plugin safe or
functional. On host `7.2.103`, native refresh of a built-in provider does not
call plugin `auth.refresh`, and later token-store persistence can write
decrypted JSON. Therefore Plugin #2 does not recognize ordinary built-in
Codex auth files and does not provide automatic login/refresh for them.

Cockpit Tools does not remove this gate. Its encrypted account-detail store is
owned by the surrounding Rust application, while the embedded API sidecar gets
separate plaintext runtime projections. Reproducing that boundary here would
require a new owning process/runtime-auth seam, not an `auth_provider` wrapper
around the three live built-in `codex` files.

The sidecar store is versioned, uses authenticated AES-256-GCM with external
key material, uses atomic record replacement plus directory sync for imports,
state changes, and opaque-key rotation, and keeps key material out of
ciphertext directories and plugin `ConfigFields`. Its first slice is complete
only for static bearer/PAT credentials and bounded HTTP/SSE forwarding;
Agent Identity JWT validation, AgentAssertion, WebSocket forwarding, and
built-in OAuth refresh remain explicit follow-up capabilities.

## Plugin #3 and Executor decisions

No `model_router` is implemented. Current evidence concerns partitioning
credentials inside one built-in provider, which belongs in `scheduler`.
`model.route` becomes relevant only when a concrete model must select among
`self`, another plugin `executor`, or a built-in `provider` before auth
selection. No such requirement exists.

No `executor` is implemented. CLIProxyAPI already owns the target provider
paths and no new backend/protocol was identified. `executor.execute`,
`executor.execute_stream`, `executor.count_tokens`, and
`executor.http_request` would expand credential/network risk without a proven
gap.

## Security boundary

Plugins are trusted native libraries in the CLIProxyAPI process. They are not a
sandbox: a bug or malicious plugin can crash the service, read process memory,
or leak credentials.

Any resource page is same-origin with Management Center and can read browser
`localStorage` or reuse a stored management key. Installing and enabling it is
an admin-equivalent trust decision even when the current page promises not to
access browser storage.

Encryption-at-rest, when implemented, can reduce accidental disclosure from a
copied backup or file. It does not create an HSM, prevent in-process plaintext
access, protect a compromised service, or reduce the same-origin UI boundary.

## Definition of done

The initiative is done only when:

1. plugin #1 passes deterministic tests and a separately authorized live
   canary over real quota/cooldown transitions;
2. plugin #2 provider/refresh ownership is resolved and encrypted storage
   survives login, refresh, restart, rotation, rollback, disable, and failure
   without plaintext persistence;
3. Model Router/Executor remain explicitly omitted or gain concrete acceptance
   cases before implementation;
4. focused proof and the repository's `./qa/verify` authority pass.
