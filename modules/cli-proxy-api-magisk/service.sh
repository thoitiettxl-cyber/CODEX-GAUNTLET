#!/system/bin/sh

export PATH="/data/adb/magisk:/data/adb/ksu/bin:/data/adb/ap/bin:$PATH:/system/bin"

MODULE_DIR=${0%/*}
CTL="$MODULE_DIR/scripts/cpactl"

(
  if command -v resetprop >/dev/null 2>&1; then
    while [ "$(getprop sys.boot_completed 2>/dev/null)" != 1 ]; do
      resetprop -w sys.boot_completed 2>/dev/null || sleep 3
    done
  else
    until [ "$(getprop sys.boot_completed 2>/dev/null)" = 1 ]; do sleep 5; done
  fi

  [ -f "$MODULE_DIR/disable" ] && exit 0
  [ -x "$CTL" ] || exit 0
  "$CTL" start --boot >/dev/null 2>&1 || true

  while sleep 30; do
    [ -f "$MODULE_DIR/disable" ] && { "$CTL" stop >/dev/null 2>&1 || true; exit 0; }
    [ -f /data/local/cli-proxy-api/run/enabled ] || continue
    if ! "$CTL" is-running >/dev/null 2>&1; then
      "$CTL" start --watchdog >/dev/null 2>&1 || true
    fi
  done
) &
