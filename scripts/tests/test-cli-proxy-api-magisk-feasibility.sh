#!/bin/sh
# Portable shebang for Linux/macOS/Android Termux (no /usr/bin/env required).
# Re-exec with bash when started by /bin/sh. Use BASH_VERSION (not a custom
# env flag) so nested scripts still re-exec correctly when inherited.
if [ -z "${BASH_VERSION:-}" ]; then
  if ! command -v bash >/dev/null 2>&1; then
    printf 'error: bash is required on PATH\n' >&2
    exit 1
  fi
  exec bash "$0" "$@"
fi

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HOME_DIR=${TERMUX_HOME:-/data/data/com.termux/files/home}
PREFIX_DIR=${TERMUX_PREFIX:-/data/data/com.termux/files/usr}
SELF=$ROOT/scripts/tests/test-cli-proxy-api-magisk-feasibility.sh

if [[ $(id -u) != 0 ]]; then
  exec su -c "/data/data/com.termux/files/usr/bin/bash '$SELF' --as-root"
fi

[[ ${1:-} == --as-root ]] || { echo "usage: $0 --as-root" >&2; exit 2; }

BB=/data/adb/ksu/bin/busybox
[[ -x $BB ]] || BB=/data/adb/magisk/busybox
[[ -x $BB ]] || BB=/data/adb/ap/bin/busybox
[[ -x $BB ]] || { echo "root-manager busybox not found" >&2; exit 1; }

LAB=/data/local/cpa-magisk-feasibility
CORE=$HOME_DIR/CLIProxyAPI/cli-proxy-api
PLUGIN=$(find "$HOME_DIR/CLIProxyAPI/plugins/linux/arm64" -maxdepth 1 -type f -name 'codex-token-usage-v*.so' | head -1)
GLIBC=$PREFIX_DIR/glibc/lib
CA=$PREFIX_DIR/etc/tls/cert.pem
PID=

cleanup() {
  if [[ -n ${PID:-} ]] && kill -0 "$PID" 2>/dev/null; then
    kill -15 "$PID" 2>/dev/null || true
    sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -rf "$LAB"
}
trap cleanup EXIT HUP INT TERM

rm -rf "$LAB"
mkdir -p "$LAB/current/bin" "$LAB/current/lib" "$LAB/plugins/linux/arm64" \
  "$LAB/current/ca" "$LAB/config" "$LAB/auth" "$LAB/data/codex-token-usage" \
  "$LAB/run/tmp" "$LAB/logs"
cp -p "$CORE" "$LAB/current/bin/cli-proxy-api"
cp -p "$PLUGIN" "$LAB/plugins/linux/arm64/"
for lib in ld-linux-aarch64.so.1 libc.so.6 libdl.so.2 libresolv.so.2 libpthread.so.0; do
  cp -p "$GLIBC/$lib" "$LAB/current/lib/$lib"
done
cp -p "$CA" "$LAB/current/ca/cert.pem"

printf '%s\n' \
  'host: "127.0.0.1"' \
  'port: 18317' \
  'remote-management:' \
  '  allow-remote: false' \
  '  secret-key: "lab-management-key"' \
  'api-keys:' \
  '  - "lab-api-key"' \
  "auth-dir: \"$LAB/auth\"" \
  'logging-to-file: false' \
  'plugins:' \
  '  enabled: true' \
  "  dir: \"$LAB/plugins\"" \
  '  configs:' \
  '    codex-token-usage:' \
  '      enabled: true' \
  >"$LAB/config/config.yaml"

chown -R 0:0 "$LAB/current"
find "$LAB/current" -type d -exec chmod 0755 {} \;
find "$LAB/current" -type f -exec chmod 0644 {} \;
chmod 0755 "$LAB/current/bin/cli-proxy-api" "$LAB/current/lib/"*.so.1 "$LAB/current/lib/"*.so.2 "$LAB/current/lib/"*.so.0
chown -R 9999:3003 "$LAB/config" "$LAB/auth" "$LAB/data" "$LAB/plugins" "$LAB/run" "$LAB/logs"
find "$LAB/config" "$LAB/auth" "$LAB/data" "$LAB/plugins" "$LAB/run" "$LAB/logs" -type d -exec chmod 0700 {} \;
find "$LAB/config" "$LAB/auth" "$LAB/data" "$LAB/plugins" "$LAB/run" "$LAB/logs" -type f -exec chmod 0600 {} \;

LOADER=$LAB/current/lib/ld-linux-aarch64.so.1
LIBDIR=$LAB/current/lib
BINARY=$LAB/current/bin/cli-proxy-api
LOG=$LAB/logs/core.log

version=$({ "$LOADER" --library-path "$LIBDIR" "$BINARY" --version 2>&1 || true; } | sed -n '/^CLIProxyAPI Version:/p' | head -1)
[[ $version == CLIProxyAPI\ Version:* ]] || { echo "direct loader version failed" >&2; exit 1; }
echo "PASS direct-loader: $version"

$BB setuidgid 9999:3003 /system/bin/curl -fsS --connect-timeout 10 --max-time 20 \
  --cacert "$LAB/current/ca/cert.pem" -o /dev/null https://api.github.com/
echo "PASS dropped-uid outbound HTTPS"

export HOME=$LAB
export TMPDIR=$LAB/run/tmp
export SSL_CERT_FILE=$LAB/current/ca/cert.pem
export SSL_CERT_DIR=$LAB/current/ca
export CPA_CONFIG_PATH=$LAB/config/config.yaml
export CPA_AUTH_DIR=$LAB/auth
export CPA_TOKEN_USAGE_DIR=$LAB/data/codex-token-usage
export CPA_MODEL_PRICE_FILE=$LAB/data/codex-token-usage/model_prices.json

cd "$LAB/current"
$BB nohup $BB setuidgid 9999:3003 "$LOADER" --library-path "$LIBDIR" \
  "$BINARY" -local-model -config "$LAB/config/config.yaml" >"$LOG" 2>&1 </dev/null &
PID=$!
cd /

ready=0
for _ in $(seq 1 30); do
  kill -0 "$PID" 2>/dev/null || { tail -50 "$LOG" >&2; exit 1; }
  if $BB wget -q -T 3 --header='Authorization: Bearer lab-api-key' \
      -O /dev/null http://127.0.0.1:18317/v1/models 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
[[ $ready == 1 ]] || { tail -80 "$LOG" >&2; echo "core readiness failed" >&2; exit 1; }

uid=$(awk '/^Uid:/{print $2; exit}' "/proc/$PID/status")
gid=$(awk '/^Gid:/{print $2; exit}' "/proc/$PID/status")
[[ $uid == 9999 && $gid == 3003 ]] || { echo "unexpected identity $uid:$gid" >&2; exit 1; }
echo "PASS process identity: $uid:$gid"

hex=$(printf '%04X' 18317)
awk -v port="$hex" 'NR > 1 && toupper($2) ~ (":" port "$") {split(toupper($2),a,":"); if (a[1] != "0100007F") exit 1; found=1} END {exit found?0:1}' \
  /proc/net/tcp /proc/net/tcp6
echo "PASS localhost-only listener"

$BB wget -q -T 5 -O /dev/null http://127.0.0.1:18317/v0/resource/plugins/codex-token-usage/dashboard
echo "PASS runtime-installed plugin dashboard"

if grep -Eiq 'mkdir /root|permission denied|plugin.*(fail|error)' "$LOG"; then
  tail -80 "$LOG" >&2
  echo "plugin runtime reported a path or load failure" >&2
  exit 1
fi
echo "PASS runtime-installed plugin writable paths"

echo "PASS CLIProxyAPI Magisk feasibility"
