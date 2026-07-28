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
SELF=$ROOT/scripts/tests/test-cli-proxy-api-magisk-staging-live.sh

if [[ $(id -u) != 0 ]]; then
  exec su -c "/data/data/com.termux/files/usr/bin/bash '$SELF' --as-root"
fi
[[ ${1:-} == --as-root ]] || { echo "usage: $0 --as-root" >&2; exit 2; }

DATA=/data/local/cli-proxy-api
MOD=/data/adb/modules/cli_proxy_api
[[ -x $MOD/scripts/cpactl ]] || MOD=/data/adb/modules_update/cli_proxy_api
CTL=$MOD/scripts/cpactl
BB=/data/adb/ksu/bin/busybox
[[ -x $BB ]] || BB=/data/adb/magisk/busybox
[[ -x $BB ]] || BB=/data/adb/ap/bin/busybox
[[ -x $CTL && -x $BB ]] || { echo "installed module staging not found" >&2; exit 1; }
[[ ! -f $DATA/config/config.yaml ]] || { echo "refusing to replace an operator config" >&2; exit 1; }
ORIGINAL_RELEASE=$(readlink "$DATA/current")

cleanup() {
  CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" stop >/dev/null 2>&1 || true
  for proc in /proc/[0-9]*/cmdline; do
    [[ -r $proc ]] || continue
    cmd=$(tr '\000' ' ' <"$proc" 2>/dev/null || true)
    case "$cmd" in
      *"$DATA/current/bin/cli-proxy-api"*)
        pid=${proc#/proc/}; pid=${pid%/cmdline}
        kill -15 "$pid" 2>/dev/null || true
        ;;
    esac
  done
  if [[ -n ${ORIGINAL_RELEASE:-} && -d $ORIGINAL_RELEASE ]]; then
    rm -f "$DATA/current.restore.$$"
    ln -s "$ORIGINAL_RELEASE" "$DATA/current.restore.$$"
    "$BB" mv -fT "$DATA/current.restore.$$" "$DATA/current"
  fi
  for candidate in "$DATA/releases"/core-*; do
    [[ -e $candidate && $candidate != "$ORIGINAL_RELEASE" ]] || continue
    rm -rf "$candidate"
  done
  find "$DATA/config" -mindepth 1 ! -name config.yaml.example -exec rm -rf {} +
  rm -rf "$DATA/auth/"* "$DATA/data/"* "$DATA/plugins/"* "$DATA/run/"* "$DATA/logs/"* "$DATA/backups/"*
  chown -R 9999:3003 "$DATA/config" "$DATA/auth" "$DATA/data" "$DATA/plugins" "$DATA/run" "$DATA/logs"
  chmod 0711 "$DATA"
  find "$DATA/config" "$DATA/auth" "$DATA/data" "$DATA/plugins" "$DATA/run" "$DATA/logs" -type d -exec chmod 0700 {} \;
  find "$DATA/config" "$DATA/auth" "$DATA/data" "$DATA/plugins" "$DATA/run" "$DATA/logs" -type f -exec chmod 0600 {} \;
}
trap cleanup EXIT HUP INT TERM

printf '%s\n' \
  'host: "127.0.0.1"' \
  'port: 18317' \
  'remote-management:' \
  '  allow-remote: false' \
  '  secret-key: "lab-management-key"' \
  'api-keys:' \
  '  - "lab-api-key"' \
  "auth-dir: \"$DATA/auth\"" \
  'logging-to-file: false' \
  'plugins:' \
  '  enabled: true' \
  "  dir: \"$DATA/plugins\"" \
  '  configs:' \
  '    codex-token-usage:' \
  '      enabled: true' \
  >"$DATA/config/config.yaml"
chown 9999:3003 "$DATA/config/config.yaml"
chmod 0600 "$DATA/config/config.yaml"

CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" start
CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" doctor
pid1=$(cat "$DATA/run/cpa.pid")
uid1=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid1/status")
gid1=$(awk '/^Gid:/{print $2; exit}' "/proc/$pid1/status")
[[ $uid1:$gid1 == 9999:3003 ]]
echo "PASS installed controller start: pid=$pid1 uid:gid=$uid1:$gid1"

CPA_PORT=18317 "$MOD/action.sh" >/dev/null
[[ ! -f $DATA/run/cpa.pid ]]
CPA_PORT=18317 "$MOD/action.sh" >/dev/null
pid_action=$(cat "$DATA/run/cpa.pid")
[[ $pid_action != "$pid1" ]]
echo "PASS Manager Action toggle"
pid1=$pid_action

kill -9 "$pid1"
for _ in {1..10}; do kill -0 "$pid1" 2>/dev/null || break; sleep 1; done
[[ -f $DATA/run/enabled ]]
CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" start --watchdog
pid2=$(cat "$DATA/run/cpa.pid")
[[ $pid2 != "$pid1" ]]
uid2=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid2/status")
gid2=$(awk '/^Gid:/{print $2; exit}' "/proc/$pid2/status")
[[ $uid2:$gid2 == 9999:3003 ]]
echo "PASS crash recovery: old=$pid1 new=$pid2"

CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" update-core
UPDATED_RELEASE=$(readlink "$DATA/current")
[[ $UPDATED_RELEASE == "$DATA/releases/core-7.2.77" ]]
[[ $UPDATED_RELEASE != "$ORIGINAL_RELEASE" ]]
CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" doctor
pid3=$(cat "$DATA/run/cpa.pid")
uid3=$(awk '/^Uid:/{print $2; exit}' "/proc/$pid3/status")
gid3=$(awk '/^Gid:/{print $2; exit}' "/proc/$pid3/status")
[[ $uid3:$gid3 == 9999:3003 ]]
echo "PASS live update-core promotion and plugin restart: $UPDATED_RELEASE"

CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" backup >/dev/null
backup=$(find "$DATA/backups" -maxdepth 1 -type f -name 'cli-proxy-api-state.*.tar.gz' | head -1)
[[ -f $backup && $(stat -c %a "$backup") == 600 ]]
echo "PASS secure backup"

CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" status
CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" stop
[[ ! -f $DATA/run/enabled && ! -f $DATA/run/cpa.pid ]]
[[ $(CPA_MODULE_DIR=$MOD CPA_PORT=18317 "$CTL" status 2>/dev/null | awk '/listener:/{print $2; exit}') == none ]]
echo "PASS intentional stop state"

touch "$DATA/data/preserve-sentinel"
"$MOD/uninstall.sh"
[[ -f $DATA/data/preserve-sentinel ]]
echo "PASS uninstall preserves persistent data"
echo "PASS CLIProxyAPI installed staging live lifecycle"
