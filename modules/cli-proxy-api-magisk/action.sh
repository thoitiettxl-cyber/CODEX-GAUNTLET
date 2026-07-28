#!/system/bin/sh

export PATH="/data/adb/magisk:/data/adb/ksu/bin:/data/adb/ap/bin:$PATH:/system/bin"
MODULE_DIR=${0%/*}
CTL=$MODULE_DIR/scripts/cpactl

if "$CTL" is-running >/dev/null 2>&1; then
  echo "Stopping CLIProxyAPI..."
  "$CTL" stop || true
else
  echo "Starting CLIProxyAPI..."
  "$CTL" start || true
fi

echo
echo "=== Status ==="
"$CTL" status || true
echo
echo "=== Last log lines ==="
"$CTL" log 10 || true
