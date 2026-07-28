# CLIProxyAPI policy and credential plugin suite contract

## Outcome and current phase

This repository owns source and repeatable build/test tooling for a staged
CLIProxyAPI plugin suite under `modules/cli-proxy-api-plugins/`. Plugin binaries
remain runtime-installed artifacts and are never bundled into the Magisk module
ZIP.

The current source and separately managed live phase are plugin #1,
`policy-scheduler` version `0.3.1`:

- official capability `management_api`, providing read-only observability;
- official capability `scheduler`, implementing `scheduler.pick`;
- optional bounded session affinity inside `scheduler`, disabled by default;
- host callbacks `host.auth.list` and `host.auth.get_runtime` for current state;
- no auth-file read, `host.auth.get`, `host.auth.save`, token logging, network
  execution, model routing, or executor capability.

Plugin #2 is designed but intentionally not implemented until its provider and
refresh ownership can be proven. Plugin #3 and an executor are explicitly
omitted because no target requirement demonstrates cross-provider routing or a
new backend. Strategy-preserving affinity behavior follows
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
| Live module plugin is installed | Confirmed | The reviewed SHA-256-identical `policy-scheduler-v0.3.1.so` is the only discoverable plugin below the persistent plugin directory. Authenticated status reports version `0.3.1` with `least-recently-used`; PID `11065`, loopback listener, and `cpactl doctor` remained healthy through promotion and the `0.3.1 → 0.3.0 → 0.3.1` rollback rehearsal without restart. Reviewed `v0.3.0`, `v0.2.0`, and `v0.1.0` artifacts remain recoverable as non-discoverable `.rollback` files. |
| Live session-affinity baseline | Confirmed on `0.2.0`; fresh `0.3.1` proof pending | Earlier Codex traffic produced `session_affinity_new` followed by `session_affinity_hit` with the same opaque credential alias over three eligible candidates. Live evidence also showed that client `Authorization` is not present in scheduler options on this path; the operational signal is `Session_id`, while `api_key_id` metadata remains available for a compatible future host/provider seam. The final `0.3.1` snapshot retained this configuration but reported zero bindings and `session_affinity` as configured but ineffective because no signal had been observed in current-generation traffic. |
| Live cooldown/recovery baseline | Confirmed on `0.2.0`; LRU transition confirmed on `0.3.0` | Existing Codex traffic on `0.2.0` produced two real cooldown/recovery windows. After the `0.3.0` LRU update, live traffic produced `3 → 2 → 3` candidates and explicit `least_recently_used` selections while the authenticated status route and `cpactl doctor` stayed healthy without restart or deliberate probe. |
| Official upstream refresh/storage seam | Not confirmed | The released `v7.2.104` source and official `origin/main` at `c9417c8ae9b16fabc0386ca35d36f13bf8b1d678` leave `sdk/pluginabi/types.go`, `sdk/pluginapi/types.go`, and `internal/pluginhost/auth_provider.go` unchanged from `v7.2.103`; no callback persists refreshed built-in OAuth data through plugin-owned encryption. |
| Cockpit Tools encryption boundary | Confirmed, not directly portable | Official `jlcodes99/cockpit-tools` source at `923cc6c45b8dbfe743ea2e04be33d2fe4fbf5654` encrypts application-owned account detail files with AES-256-GCM, then materializes separate plaintext `0600` OAuth JSON files for its embedded CLIProxyAPI sidecar and registers runtime auth with `WithSkipPersist`. It does not implement encryption through the native CLIProxyAPI plugin ABI. |

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

## Plugin #2 — Credential Security design gate

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
bounded session-affinity portion is implemented in live version `0.3.1`; it
does not make `auth_provider` ownership safer
or satisfy the encryption gate. No interceptor may call an upstream model or
log `StorageJSON`, an access token, a refresh token, cookie, management key, or
raw credential.

Implementation is blocked on a concrete provider decision. On host `7.2.103`,
an `auth_provider` owns one provider identifier. Returning decrypted
`StorageJSON` for a built-in provider lets its native executor run, but native
refresh does not call plugin `auth.refresh`; later token-store persistence can
write decrypted JSON. Giving the plugin its own provider requires a matching
executor/model path, forbidden here without a genuinely new backend. Shadowing
a built-in provider also means duplicating real login and refresh behavior.

A generic “encrypt every existing OAuth file” plugin would therefore be unsafe
or non-functional. Stage 2 starts only after one of these is confirmed:

- a provider fully owned by the plugin, including real login/poll/refresh and a
  supported execution path; or
- a new official host callback/storage seam that re-encrypts after native
  refresh without forking core.

Cockpit Tools does not remove this gate. Its encrypted account-detail store is
owned by the surrounding Rust application, while the embedded API sidecar gets
separate plaintext runtime projections. Reproducing that boundary here would
require a new owning process/runtime-auth seam, not an `auth_provider` wrapper
around the three live built-in `codex` files.

When the gate is met, persisted storage must be versioned, use authenticated
encryption and an external key identifier, preserve rollback/migration
semantics, and coexist with the scheduler's sticky TTL/failover contract. Key
material must not be stored beside ciphertext or rendered through
ConfigFields.

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
