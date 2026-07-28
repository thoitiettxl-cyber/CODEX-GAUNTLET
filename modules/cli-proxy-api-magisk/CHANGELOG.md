# CLIProxyAPI Magisk Module Changelog

## v1.1.0 — 2026-07-16

- Stop bundling CLIProxyAPI plugins in the module ZIP.
- Create persistent `/data/local/cli-proxy-api/plugins/linux/arm64` paths owned
  by the core UID so CLIProxyAPI Store/runtime can install plugins there.
- Allow zero or multiple runtime-installed plugins; the module no longer
  requires `codex-token-usage` or a plugin dashboard to start.
- Preserve the persistent plugin directory across core updates and backups.
- Migrate an existing release-local plugin directory and `plugins.dir` during
  module installation, with a config backup before the path change.
- Package the current module core baseline CLIProxyAPI `7.2.80` without a
  plugin payload.

## v1.0.1 — 2026-07-16

- Release the module fixes as a distinguishable patch version.
- Make `cpactl stop` release the module-owned listener before reporting
  success; `restart` and `update-core` now stop before starting again.
- Keep foreign listeners untouched and fail closed when the configured port is
  still occupied by another process.
- Remove the fixed checksum entry for plugin `.so` files while retaining core,
  glibc, CA, runtime metadata, plugin-count, and dashboard health checks.
- Build this release from the module runtime baseline CLIProxyAPI `7.2.80`
  with `codex-token-usage` `0.1.30`.
