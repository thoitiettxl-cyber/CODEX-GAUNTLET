# CLIProxyAPI Standalone Module

This directory builds a complete Magisk-format ZIP for ARM64 Android. The ZIP
bundles CLIProxyAPI, minimal glibc libraries, and a CA bundle. Plugins are
installed later by CLIProxyAPI Store/runtime into the persistent
`/data/local/cli-proxy-api/plugins` directory; no plugin `.so` is bundled in
the ZIP. The runtime checksum manifest protects only the core, glibc, CA, and
metadata files. The ZIP does not contain `config.yaml`, API keys, OAuth account
files, or plugin databases.

Current release: `v1.1.0` — see [CHANGELOG.md](CHANGELOG.md).

Build on this Termux device:

```sh
modules/cli-proxy-api-magisk/build.sh
```

To package the currently installed module runtime, set
`CPA_RUNTIME_DIR=/data/local/cli-proxy-api/current` and run the builder as
root; without that override, the builder uses the declared Termux build inputs
for a clean development environment.

Generated files are placed under `dist/` and ignored by Git.

After installing and rebooting, manually copy and edit state so the resulting
paths are:

```text
/data/local/cli-proxy-api/config/config.yaml
/data/local/cli-proxy-api/auth/
/data/local/cli-proxy-api/plugins/
/data/local/cli-proxy-api/data/
```

Required config replacements:

```yaml
host: "127.0.0.1"
port: 8317
auth-dir: "/data/local/cli-proxy-api/auth"
plugins:
  enabled: true
  dir: "/data/local/cli-proxy-api/plugins"
remote-management:
  allow-remote: false
```

Then run as root:

```sh
cpactl doctor
cpactl start
cpactl status
```

`cpactl stop` waits for the module-owned listener to leave port `8317` and
force-kills only matching module core processes. It never kills a foreign
Termux/service listener. When `update-core` finds the service running, it
performs this stop, promotes the candidate, and starts it again; failures
roll back to the previous release.

The controller is plugin-neutral. `cpactl status` reports the host plugin
support header and installed `.so` count, but does not assume a plugin ID,
dashboard route, data layout, or plugin-specific environment variables. Use
each plugin's Management API/resource routes for its own health and policy.

Ordinary uninstall preserves `/data/local/cli-proxy-api`. Destructive cleanup
requires `cpactl purge-data --yes`.
