# CLIProxyAPI Magisk auxiliary-runtime contract

## Purpose

This repository owns a vendored maintenance copy of the standalone CLIProxyAPI
Magisk module under `modules/cli-proxy-api-magisk/`, together with its focused
tests and non-root control-plane commands. The provenance origin remains
[`thoitiettxl-cyber/repository-harness`](https://github.com/thoitiettxl-cyber/repository-harness)
and was imported from commit
`323b43cdd5789e6a4f7ce63b0d05ade91ebe0989`.

The runtime is an optional local AI-provider gateway. It never becomes Harness
core, a dependency of `codex-gauntlet-termux`, or a repository verification
authority merely because its knowledge and presence are registered here.

The checked-in module source is authoritative for future local maintenance.
Refreshing it from the provenance origin is a reviewed import, never an
automatic overwrite.

## Runtime contract

- The Android root module controller lives under
  `/data/adb/modules/cli_proxy_api`.
- Immutable runtime releases and persistent operator state live under
  `/data/local/cli-proxy-api`.
- The core normally runs as UID `9999`, GID `3003` through the bundled glibc
  loader and does not depend on Termux, `tmux`, or `grun` after installation.
- The controller waits for Android boot completion, restarts the core after an
  unexpected crash, and honors an intentional `cpactl stop` for the remainder
  of the current boot.
- The service listens only on `127.0.0.1:8317`; remote management remains
  disabled.
- Config, OAuth accounts, runtime-installed plugins, plugin data, logs, and
  backups persist outside the replaceable module controller.
- Ordinary uninstall preserves `/data/local/cli-proxy-api`. Destructive purge
  is a separate, confirmed operator action.

The durable filesystem shape is:

```text
/data/adb/modules/cli_proxy_api/
  module.prop
  service.sh
  action.sh
  uninstall.sh
  scripts/cpactl
  system/bin/cpactl

/data/local/cli-proxy-api/
  releases/<release-id>/
  current -> releases/<release-id>
  config/config.yaml
  auth/
  plugins/linux/arm64/
  data/
  run/
  logs/
  backups/
```

## Control surface

The source contract exposes:

```text
cpactl start
cpactl stop
cpactl restart
cpactl status
cpactl log [N]
cpactl doctor
cpactl version
cpactl backup
cpactl update-core
cpactl purge-data --yes
```

`cpactl status`, `doctor`, and `log` are diagnostic surfaces. Lifecycle,
update, uninstall, and purge operations mutate root-managed state and require
an explicitly authorized task. The operational safety procedure is
[`docs/runbooks/cli-proxy-api-magisk.md`](../runbooks/cli-proxy-api-magisk.md).

## Security invariants

- Never store or print API keys, OAuth tokens, management secrets, auth JSON,
  live config bodies, account identifiers, or plugin databases in this
  repository, Harness state, logs, or responses.
- Secret-bearing directories use private permissions and secret-bearing files
  use mode `0600` in the source contract.
- Wildcard listeners, remote management, Termux-owned runtime paths, and
  implicit root-core fallback are invalid configurations.
- A listener on port `8317` may be stopped only when its PID and command line
  match the active module binary. A foreign listener is never killed.
- The module ZIP contains no credentials or optional plugin binary. Plugins
  are installed by CLIProxyAPI Store/runtime under the persistent plugin
  directory.
- TLS verification remains enabled; the runtime carries its own CA bundle.

## Update and recovery invariants

- Module framework, glibc, and CA changes arrive through a separately reviewed
  module release.
- `cpactl update-core` may replace only the core after upstream checksum and
  version verification.
- Promotion uses an atomic `current` symlink, retains a prior working release,
  preserves persistent state, and rolls back the selected release and service
  state when candidate health fails.
- A successful stop proves the module-owned listener released its configured
  port before an update or restart continues.
- Optional plugins and their data survive core promotion and are not covered
  by the immutable runtime checksum manifest.

## Provider boundary

Clients use the local base URL `http://127.0.0.1:8317/v1`. Client API-key auth,
provider OAuth state, and the management secret are separate authorities.
Provider selection or fallback is explicit; this repository does not silently
rewrite global Codex auth or provider configuration.

An authenticated `/v1/models` response proves only the local proxy boundary.
Model routing, upstream auth, plugin health, and client routing require their
own evidence as described in the runbook.

## Knowledge and live-state boundary

The pinned source commit and file hashes are recorded in
[`docs/provenance/cli-proxy-api-magisk-knowledge.json`](../provenance/cli-proxy-api-magisk-knowledge.json).
They prove the identity of the imported knowledge, not current device state or
current upstream releases.

The vendored implementation manifest is
[`docs/provenance/cli-proxy-api-magisk-source.json`](../provenance/cli-proxy-api-magisk-source.json).
Source, tests, and executable modes are durable; generated ZIPs, runtime
payloads, credentials, plugins, config, logs, and backups remain untracked.

The source repository contains historical target-device evidence dated
2026-07-16. Treat it as recovery context only. Before any live action, inspect
the actual module, runtime, listener, and safe metadata. Root/device proof must
be freshly authorized and executed; `./qa/verify` proves only this control
plane.
