# Operate CLIProxyAPI Magisk on Android

Use this runbook when a request concerns the `cli_proxy_api` Magisk/KernelSU/
APatch module, `cpactl`, local port `8317`, CLIProxyAPI provider routing,
runtime-installed plugins, or recovery of `/data/local/cli-proxy-api`.

## Authority and scope

- Product contract: `docs/product/cli-proxy-api-magisk.md`.
- Durable inventory: `docs/inventory/cli-proxy-api-magisk.json`.
- Imported source identity:
  `docs/provenance/cli-proxy-api-magisk-knowledge.json`.
- Vendored implementation: `modules/cli-proxy-api-magisk/`, pinned by
  `docs/provenance/cli-proxy-api-magisk-source.json`.
- Harness registry: optional capability and observed TCP presence only.
- Executable repository pass/fail: `./qa/verify` only.

The live filesystem wins over this imported baseline. Never infer installed
version, module manager, symlink target, listener ownership, provider catalog,
plugin set, or service health from historical source evidence.

The module and persistent runtime are root-managed. Repository work does not
authorize `su`, module installation, lifecycle changes, update, uninstall,
purge, reboot, or writes below `/data/adb` or `/data/local`. Obtain explicit
authorization for the exact target and action before invoking them.

## Repository maintenance tools

The non-root control surface is:

```bash
scripts/termux-control cli-proxy-api-magisk status
scripts/termux-control cli-proxy-api-magisk source-check
scripts/termux-control cli-proxy-api-magisk syntax
CPA_RUNTIME_DIR=/absolute/reviewed/runtime \
  scripts/termux-control cli-proxy-api-magisk test
CPA_RUNTIME_DIR=/absolute/reviewed/runtime \
  scripts/termux-control cli-proxy-api-magisk build
```

`status`, `source-check`, and `syntax` do not use root or credentials. `test`
executes the fixture suite and deliberately rejects `--require-live` through
the control entrypoint. `build` writes only the ignored module `dist/` output
unless `CPA_MODULE_OUT_DIR` selects another explicit directory.

A runtime build input must contain `bin/cli-proxy-api`, the required minimal
glibc libraries under `lib/`, and `ca/cert.pem`. Pin and verify its upstream
archive checksum before use. A user-level process may see the live runtime
path but still be unable to open its root-owned payload; do not infer
readability from `test -r` alone and do not escalate to root implicitly.

`scripts/bin/cpa-token-usage-status` is an imported bounded live-status helper.
It does not print secret values, but it invokes `su` for module and filename
metadata and may perform authenticated HTTP checks when the client key already
exists in the environment. Run it only in a separately authorized live
diagnostic task; never enable shell tracing or capture its expanded environment.

The focused source layers are:

- `scripts/tests/test-cli-proxy-api-magisk-module.sh`: non-root archive,
  lifecycle fixture, update, port ownership, unsafe-config, checksum, purge
  confirmation, and secret-exclusion proof;
- `scripts/tests/test-cli-proxy-api-magisk-feasibility.sh`: destructive root
  lab under `/data/local/cpa-magisk-feasibility`; explicit authorization only;
- `scripts/tests/test-cli-proxy-api-magisk-staging-live.sh`: destructive live
  staging lifecycle; never run against operator state without exact review and
  authorization.

## Knowledge lookup

Query the registered capability without touching root state:

```bash
scripts/termux-control orchestrator query tools \
  --capability provider-gateway-runtime --json
```

The registry's HTTP check means only that a TCP endpoint answered on
`127.0.0.1:8317`. It does not prove authentication, model routing, upstream
credentials, plugins, process ownership, checksum integrity, or update safety.

## Supported topology

```text
/data/adb/modules/cli_proxy_api
  -> root module controller and systemless cpactl shim

/data/local/cli-proxy-api/current
  -> releases/<active-release>

/data/local/cli-proxy-api/{config,auth,plugins,data,run,logs,backups}
  -> persistent operator and runtime state

client
  -> http://127.0.0.1:8317/v1
  -> CLIProxyAPI provider routing
  -> configured upstream provider
```

Do not reintroduce the retired Termux-native `cli-proxy-api`, `tmux`, or
`grun` service on port `8317` while the module is active. Do not copy optional
plugin `.so` files into an immutable release or module ZIP. Store/runtime owns
plugins under `/data/local/cli-proxy-api/plugins`.

## Read-only inspection ladder

When root inspection has been explicitly authorized, run narrow commands as
separate operations. Start with:

```sh
su -c 'cpactl status'
su -c 'cpactl doctor'
```

Do not combine either command with a mutation. Do not print the live config,
environment, auth files, management secret, or token values.

Interpret evidence in layers:

1. **Controller and process:** `cpactl status` identifies the selected release,
   PID, UID/GID, listener, and bounded health without credential values.
2. **Integrity and policy:** `cpactl doctor` checks runtime checksums, private
   paths, loopback binding, remote-management policy, and Termux-path drift.
3. **Listener:** confirm only `127.0.0.1:8317`; a wildcard or non-loopback
   listener is a security failure.
4. **Local auth:** an authenticated `/v1/models` request returning HTTP `200`
   proves the proxy auth boundary. A `401` means the client key/header is wrong.
5. **Model routing:** confirm the requested model appears, then use sanitized
   `cpactl log` output to inspect request status.
6. **Upstream auth:** inspect credential metadata only; never print token or
   account bodies.
7. **Plugins:** inspect only plugin filenames/metadata and bounded health.
   Zero or multiple plugins are valid. Plugin-specific health is not generic
   core health.

An authenticated probe uses an already supplied secret without printing it:

```sh
test -n "${CLIPROXYAPI_API_KEY:-}"
curl -fsS -o /dev/null \
  -H "Authorization: Bearer ${CLIPROXYAPI_API_KEY:?not set}" \
  http://127.0.0.1:8317/v1/models
```

Never enable shell tracing around this command and never copy the expanded
header into logs or Harness evidence.

## Configuration invariants

Validate keys without displaying secret values:

```yaml
host: "127.0.0.1"
port: 8317
auth-dir: "/data/local/cli-proxy-api/auth"
plugins:
  dir: "/data/local/cli-proxy-api/plugins"
remote-management:
  allow-remote: false
```

Client provider settings use `http://127.0.0.1:8317/v1`, an environment-key
boundary, and the protocol expected by that client. Provider configuration,
client API-key auth, upstream OAuth, and the CLIProxyAPI management secret are
independent. Do not implement silent provider failover or copy auth state as
part of routine diagnosis.

## Plugin and management diagnostics

The source records these durable distinctions:

- Runtime plugins belong below
  `/data/local/cli-proxy-api/plugins/linux/arm64`. Multiple plugin types are
  valid, but do not leave two versions of the same plugin for the host to load.
- A plugin endpoint returning `404` means the plugin is not registered. A
  transient `502` immediately after restart can be a startup race; recheck
  after the service settles before diagnosing corruption.
- Plugin dashboards and usage data do not prove core, provider, or OAuth
  health. Test each boundary separately.
- Quota-trigger probes can send a real upstream request. Keep them disabled
  unless that side effect is explicitly requested and budgeted.
- Account-protection scheduling applies to eligible Codex/ChatGPT OAuth
  accounts; it does not take ownership of unrelated provider scheduling.
- Management APIs use the CLIProxyAPI management secret, not merely the client
  API key. The runtime may persist a replacement as a hash after restart; do
  not store plaintext or hash values in Git, Harness, screenshots, or chat.

A management-secret reset is a root-managed config mutation. Back up first,
replace only the exact secret key, restart through `cpactl`, and verify bounded
local management health without displaying either old or new secret. This
requires a separately authorized task.

## Lifecycle changes

`start`, `stop`, and `restart` mutate root-managed service state. Before an
authorized lifecycle change, state the exact module target, expected listener
impact, why root is required, and recovery command. Then invoke only the one
requested action:

```sh
su -c 'cpactl start'
su -c 'cpactl stop'
su -c 'cpactl restart'
```

Afterward, run `status`, `doctor`, and the minimum authenticated client probe
needed for the requested outcome. `stop` must release only a listener owned by
the active module binary and must fail rather than kill a foreign process.

## Backup, update, and rollback

Before an authorized config edit or core update:

1. inspect current status, doctor output, active symlink metadata, and free
   space without printing state bodies;
2. run `cpactl backup` and confirm the resulting archive has private mode;
3. preserve the current release as the recovery candidate;
4. apply only the exact requested change;
5. prove loopback binding, service identity, authenticated local health, and
   requested provider/plugin behavior.

`cpactl update-core` is not a routine diagnostic. It downloads a candidate,
verifies upstream checksum and exact version identity, fully releases the old
listener, atomically promotes `current`, and must restore both the prior
symlink and prior running/stopped intent on failed health. Do not update merely
because a newer version exists.

Module framework, glibc, or CA changes require a new reviewed module artifact;
`update-core` does not own them. This repository owns the vendored build and
test commands, while root/device proof remains a separate authorized layer.

## Uninstall and destructive purge

Ordinary uninstall stops the module but preserves
`/data/local/cli-proxy-api`. The recovery path is reinstalling the reviewed
module and selecting the preserved release/state.

`cpactl purge-data --yes` is destructive and may erase config, OAuth accounts,
plugins, logs, backups, and runtime releases. Never run it unless the user
explicitly names `/data/local/cli-proxy-api` and authorizes permanent purge in
the current task. Before purge, resolve that exact path, create and verify an
operator-approved private backup, explain recovery limits, and invoke the purge
as a separate root command.

Never uninstall another module, change Android system partitions, disable
SELinux, reboot, or weaken localhost/remote-management policy as part of this
runbook.

## Evidence and completion

For repository-memory changes, verify JSON syntax, provenance hashes against
the pinned source checkout, documentation links, Harness registry lookup, and
`./qa/verify --mode targeted` followed by the final mandatory gate.

For live-runtime claims, repository verification is insufficient. Fresh proof
must include explicitly authorized root `status`/`doctor`, loopback listener,
authenticated local API, relevant route/plugin behavior, and recovery state.
Report historical source evidence separately from evidence collected in the
current task.

For vendored implementation changes, additionally run `source-check`, `syntax`,
the default non-root module suite with a checksum-verified temporary runtime,
and two deterministic builds. Root feasibility and staging tests are required
only when the requested outcome changes live/device behavior and explicitly
authorizes their exact destructive targets.
