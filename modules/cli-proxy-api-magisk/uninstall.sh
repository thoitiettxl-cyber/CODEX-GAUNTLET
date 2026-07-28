#!/system/bin/sh

MODULE_DIR=${0%/*}
CTL=$MODULE_DIR/scripts/cpactl
[ -x "$CTL" ] && "$CTL" stop >/dev/null 2>&1 || true

# Deliberately preserve /data/local/cli-proxy-api. Use cpactl purge-data only
# after explicit confirmation when OAuth and usage history should be erased.
exit 0
