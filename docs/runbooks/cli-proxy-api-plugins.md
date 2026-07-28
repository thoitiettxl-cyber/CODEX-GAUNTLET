# Build and operate the CLIProxyAPI plugin suite

## Scope and authority

This runbook covers `modules/cli-proxy-api-plugins/`, its repository control
command, and a future live installation under the existing CLIProxyAPI Magisk
runtime. Product behavior is in
`docs/product/cli-proxy-api-plugin-suite.md`.

Repository build/test work does not authorize root, a live management write,
service restart, plugin copy, config mutation, or credential access. Live paths
under `/data/local/cli-proxy-api` and `/data/adb/modules/cli_proxy_api` remain
root-managed under the CLIProxyAPI Magisk runbook.

## Non-root source workflow

```bash
scripts/termux-control cli-proxy-api-plugins status
scripts/termux-control cli-proxy-api-plugins prepare
scripts/termux-control cli-proxy-api-plugins test
scripts/termux-control cli-proxy-api-plugins build
scripts/termux-control cli-proxy-api-plugins integration
```

`all` runs the sequence. `prepare` installs no package. It downloads the pinned
Termux Go package and signed pacman GCC/glibc packages into the ignored suite
cache, verifies exact SHA-256 values, and extracts them privately. It also
downloads official plugin-capable CLIProxyAPI `7.2.103` with SHA-256
`134097d189c11c882a77bd72eb82b7beecc19545397b622954b4ff79fa8c4b43`.

`build` creates two Linux/glibc ARM64 shared objects and one Android/arm64
sidecar executable. It requires byte equality across two builds, correct ELF
identity, `cliproxy_plugin_init` on each plugin, and an allowed glibc dependency
set. Ignored output is:

```text
modules/cli-proxy-api-plugins/dist/policy-scheduler-v0.3.1.so
modules/cli-proxy-api-plugins/dist/credential-security-v0.1.0.so
modules/cli-proxy-api-plugins/dist/credential-security-sidecar-v0.1.0-android-arm64
```

`integration` starts a temporary loopback CLIProxyAPI on port 18317 with
test-only keys and one disabled synthetic Credential Security projection. It
proves both plugins register, Plugin #2 declines unrelated auth, management
status is redacted, Plugin #2 has no public ResourceRoute, and both plugins
disable/re-enable. It sends no upstream model request and removes its temporary
lab.

## Mandatory target preflight

Query the exact target binary. The support header is exposed even when
management authentication returns 401:

```bash
curl -sS -D - -o /dev/null \
  http://127.0.0.1:8317/v0/management/plugins
```

Continue only with `X-Cpa-Support-Plugin: 1`. A value of `0`, a missing header,
or a `_no-plugin` build blocks deployment. Record version, commit, build date,
OS/architecture, and plugin directory metadata without printing config or
secrets.

The current observed target returned `1` for version `7.2.103`, commit
`cade44b9`. This proves feasibility only; recheck after every core promotion.

## Live deployment gate

A live canary requires explicit authorization for these exact effects:

- copy one reviewed `.so` to
  `/data/local/cli-proxy-api/plugins/linux/arm64/policy-scheduler-v0.3.1.so`;
- for a Plugin #2 canary, copy reviewed
  `credential-security-v0.1.0.so` beside it and leave the Android sidecar
  outside the plugin discovery tree;
- update only `plugins.configs.policy-scheduler` in
  `/data/local/cli-proxy-api/config/config.yaml` through Management API;
- possibly restart only `cli_proxy_api` if the host reports
  `restart_required`.

Before mutation, run authorized module status/doctor checks and `cpactl backup`;
record current plugin filenames and redacted config keys. Never put `.so` in an
immutable release or Magisk ZIP. Only one `policy-scheduler` version may remain
discoverable.

Supply an existing management key through a private environment boundary and
never echo it:

```bash
test -n "${CPA_MANAGEMENT_KEY:-}"
curl -fsS \
  -H "X-Management-Key: ${CPA_MANAGEMENT_KEY:?not set}" \
  http://127.0.0.1:8317/v0/management/plugins >/dev/null
```

Do not enable shell tracing or capture expanded headers in evidence.

## Use Policy Scheduler

Open the local dashboard at:

```text
http://127.0.0.1:8317/v0/resource/plugins/policy-scheduler/dashboard
```

The page keeps the supplied management key in memory only. The equivalent
read-only API is `GET /v0/management/policy-scheduler/status` with the
`X-Management-Key` header. It reports redacted credential projections, active
policy, host limitations, and recent decisions.

Source `0.3.1` additionally reports `observability`: lifecycle generation,
register/reconfigure counts, picks grouped by bounded strategy names, affinity
events, plugin-observed cooldown exclusions, current-generation policy
effectiveness, aggregate state sizes, and up to 100 sorted provider/model state
rows plus an omission count. These counters are process-local and reset on
shutdown; effectiveness returns to `awaiting_scheduler_traffic` after every
generation change. A zero cooldown counter does not prove that no credential
cooled down because the host normally removes those candidates before the
plugin sees them.

The current live policy leaves quota/tenant/plan/weight filters disabled,
uses plugin-owned least-recently-used selection, and keeps the live-proven
Codex session signal:

```json
{
  "quota_reserve_percent": 0,
  "tenant_groups": {},
  "backup_auth_ids": [],
  "balance_strategy": "least-recently-used",
  "delegate_builtin": "round-robin",
  "decision_history_limit": 50,
  "session_affinity_enabled": true,
  "session_affinity_header": "Session_id",
  "session_affinity_metadata_key": "api_key_id",
  "session_affinity_ttl_seconds": 3600,
  "session_affinity_max_entries": 4096
}
```

Apply policy changes with
`PATCH /v0/management/plugins/policy-scheduler/config`; the host persists the
stanza and hot-reconfigures the plugin. Enable or disable it separately with
`PATCH /v0/management/plugins/policy-scheduler/enabled` and an `enabled`
boolean.

Useful policy profiles are:

- quota protection: set `quota_reserve_percent` and ensure candidates contain
  numeric `quota_remaining_percent` attributes;
- plan preference: set ordered `plan_tiers` and ensure candidates contain a
  `plan_type` attribute;
- tenant isolation: map request tenant values in `tenant_groups`, optionally
  set `deny_unknown_tenant`, and ensure candidates contain `tenant_group`;
- same-tier balancing: select `least-recently-used` or `weighted`; weighted
  mode reads a positive integer `weight` attribute;
- bounded fallback: list ordered `backup_auth_ids`, noting the host must still
  include a backup in the scheduler's candidate set.
- client/session affinity: enable `session_affinity_enabled` only after the
  chosen metadata key or request header is confirmed to reach scheduler
  options. Metadata must be a string and takes precedence over the header;
  either source may be blank to disable it, but not both. Raw signal values are
  HMACed and never exposed; bindings are process-local, use a sliding TTL, and
  fail over when the sticky credential is no longer in the eligible set. With
  `balance_strategy: delegate`, new/failover bindings mirror
  `delegate_builtin`; round-robin state and bindings are isolated by provider
  set and model.

The built-in Codex path on live `7.2.103` does not pass the client
`Authorization` value to `scheduler.pick`; do not describe this configuration
as per-API-key affinity. `Session_id` is the verified Codex signal. Keep
`session_affinity_metadata_key: api_key_id` only as an optional higher-priority
source for a future compatible host/provider that supplies a safe opaque ID.

CLIProxyAPI `7.2.103` filters cooldown, disabled, and lower-priority
credentials before calling the plugin. Its built-in auth parsers also do not
promote arbitrary file fields into candidate attributes. Tenant, quota, plan,
and weight policies therefore become active only when a compatible provider
or future official host seam supplies those safe attributes. Keep those
filters disabled until such attributes exist; LRU selection does not require
them and must not invent quota or tenant state.

## Canary order

1. Start with `quota_reserve_percent: 0`, no tenant mapping, and either
   `balance_strategy: least-recently-used` for explicit plugin selection or
   `delegate` when preserving built-in selection is the goal.
2. Verify resource page and authenticated status response contain opaque aliases
   only—no names, paths, email, account IDs, `StorageJSON`, tokens, or headers.
3. Add synthetic safe candidate attributes and test policy without upstream
   traffic where possible.
4. Enable one policy dimension at a time. Real quota-trigger probes send
   upstream requests and require separate budget/side-effect authorization.
5. Observe at least one real cooldown and recovery window before calling the
   scheduler stable. Registration and unit tests are not stability evidence.
6. Disable through `PATCH /plugins/policy-scheduler/enabled`; verify routes and
   scheduler effects disappear before re-enabling.

## Use Credential Security Plugin #2

Plugin #2 implements one narrow sidecar-owned static bearer/PAT boundary. The
native plugin recognizes only `auth_mode: credential_security_sidecar`, an
opaque `cpcs_` key, a versioned `cs-` credential ID, and the exact loopback
endpoint configured by `sidecar_port`. It declines ordinary Codex OAuth files.
Its authenticated read-only status route is:

```text
GET /v0/management/credential-security/status
```

There is intentionally no `/v0/resource/plugins/credential-security/...`
route. The companion sidecar listens on `127.0.0.1:18319` by default and
requires three owner-only inputs:

- an encrypted data directory with mode `0700`;
- a separate 32-byte encryption key file with mode `0600`;
- a sidecar management-key file with mode `0600` and at least eight bytes.

Start it only under an explicit process supervisor or a bounded canary:

```bash
modules/cli-proxy-api-plugins/dist/credential-security-sidecar-v0.1.0-android-arm64 \
  -listen 127.0.0.1:18319 \
  -data-dir /explicit/owner-only/data \
  -key-file /explicit/owner-only/encryption-key \
  -management-key-file /explicit/owner-only/management-key
```

Do not put either key in argv, environment variables, plugin config, auth
files, logs, or Git. Import is disabled by default and returns one projection
containing the opaque key; the caller must persist that projection through the
CPA auth-file Management API and must update it after enable/disable/rotation.
The sidecar list/status routes never return the original or opaque key.

The initial production boundary supports HTTP/SSE forwarding to the fixed
`https://chatgpt.com/backend-api/codex` origin. `--allow-test-upstream` permits
only a loopback HTTP upstream and is for isolated tests. Built-in OAuth login,
refresh, Agent Identity JWT/AgentAssertion, WebSockets, automatic auth-file
synchronization, and real-token migration are not implemented.

The sidecar rejects `.`/`..` proxy path segments, does not follow upstream
redirects, and refuses imports after the bounded 4096-record store limit. These
checks preserve the fixed-upstream and bounded-state contract; a redirect is
returned to the caller instead of receiving the decrypted bearer.

For a live parser canary, upload only a disabled synthetic projection with a
unique exact filename, verify the Plugin #2 parse counter increments and the
auth remains disabled, then delete that exact file. Never reuse a real token,
opaque key, credential ID, or auth filename for this test. Registration and a
synthetic parse canary do not prove real upstream authentication.

## Same-origin and encryption warnings

The resource page is unauthenticated static HTML on Management Center's origin.
It currently does not access `localStorage` and keeps its supplied management
key in memory. This does not weaken the trust boundary: any enabled resource
page plugin can read a key stored by Management Center and act with current
admin authority.

Credential Security `0.1.0` implements encryption-at-rest only for credentials
created inside its companion sidecar. It does not encrypt existing CPA OAuth
files. Encryption protects copied/backed-up ciphertext; the sidecar decrypts
while forwarding and is not an HSM. It cannot protect against a compromised
service process, stolen encryption key, or malicious administrator.

## Linux race/fuzz gate

The Android/Termux target cannot natively execute Go ThreadSanitizer or fuzzing.
Run the Linux-only proof from both plugin modules before declaring the release
evidence complete:

```bash
cd modules/cli-proxy-api-plugins/policy-scheduler
make linux-ci
cd ../credential-security
make test-race
make fuzz
```

The Policy Scheduler's three coverage-guided fuzz targets have passed with a
Linux/glibc test binary. Credential Security adds projection and management
fuzz targets; their seed corpora run in the Termux suite, while coverage-guided
execution and `go test -race` require a true Linux runner. The Policy Scheduler
race binary compiled, but ThreadSanitizer cannot run under Android's 39-bit VMA
layout. Termux unit execution does not substitute for either race proof.

## Soak and rollback rehearsal

After a separately authorized promotion, collect redacted status snapshots at
start, 24 hours, and 72 hours. Check generation/reconfigure counts, strategy
distribution, affinity `new/hit/failover/expiry/eviction`, observed cooldown
exclusions, ineffective-policy fields, state sizes, status HTTP 200, PID and
listener health, and `cpactl doctor`. Do not send a deliberate upstream model
request solely for this rehearsal. Check `/proc/<pid>/maps` externally for old
`policy-scheduler` shared objects after each hot reload.

Rehearse `0.3.1 → 0.3.0 → 0.3.1` only inside an authorized maintenance window:
disable the exact plugin, verify its routes return 404, preserve the current
artifact, restore one prior discoverable version, re-enable with a material
config change, and repeat in the opposite direction. Verify the same redacted
status/health invariants after each transition. Never delete the whole plugin
directory or mutate auth files.

If Credential Security is promoted beyond a parser-only canary, separately
soak the sidecar store/restart path, opaque-key rotation, projection update,
HTTP/SSE forwarding, and exact disable/delete recovery. Do not infer these
properties from the native plugin's registration status.

## Rollback and recovery

First set `plugins.configs.policy-scheduler.enabled` to false and verify the
resource route returns 404. If the host cannot unload it, preserve service
intent and use the existing `cpactl` restart procedure only after explicit
authorization.

Remove only the exact versioned plugin file after confirming it is disabled.
Restore the prior redacted config stanza or backup. Never delete the complete
plugins directory or purge `/data/local/cli-proxy-api`. Verify `cpactl doctor`,
loopback listener ownership, management header, plugin list, and client/provider
boundaries after recovery.

For Plugin #2, disable only `credential-security`, confirm its authenticated
status route returns 404, remove the exact synthetic canary auth file if one
was created, then move only `credential-security-v0.1.0.so` out of discovery.
Stop a sidecar canary before removing its explicitly named temporary data and
key paths. Never delete a real encrypted store or key during plugin rollback;
preserve both until every projection has been disabled or removed.

The current live `0.3.1` recovery inputs are promotion backup
`cli-proxy-api-state.20260728T165717Z.tar.gz` and non-discoverable files
`policy-scheduler-v0.3.0.so.rollback`,
`policy-scheduler-v0.2.0.so.rollback`, and
`policy-scheduler-v0.1.0.so.rollback`. To roll back without deleting an
artifact, disable the plugin, move `v0.3.1.so` aside, restore the `v0.3.0`
rollback filename to `policy-scheduler-v0.3.0.so`, then re-enable the plugin.
The live `0.3.1 → 0.3.0 → 0.3.1` rehearsal completed without a restart while
preserving PID `11065`, loopback health, and the safe LRU/affinity policy.
CLIProxyAPI `7.2.103` hash-checks config contents, so touching the config or
saving the same value does not trigger reload; use an actual Management API
config change and restore it after registration is confirmed. Restart only if
the host reports that hot unload/reload cannot complete.

Promotion, config writes, artifact copies, service lifecycle changes, and
rollback remain separately authorized live operations; the source workflow
performs none of them.
