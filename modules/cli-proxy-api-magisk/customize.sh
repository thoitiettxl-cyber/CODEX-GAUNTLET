#!/system/bin/sh

SKIPUNZIP=1
SKIPMOUNT=false
PROPFILE=true
POSTFSDATA=false
LATESTARTSERVICE=true

DATA_DIR=/data/local/cli-proxy-api
MODULE_ID=cli_proxy_api

say() { ui_print "- $*"; }
fail() { abort "! CLIProxyAPI module: $*"; }

[ "${BOOTMODE:-false}" = true ] || fail "install from Magisk/KernelSU/APatch Manager, not recovery"
case "$(getprop ro.product.cpu.abi 2>/dev/null)" in
  arm64-v8a|aarch64) ;;
  *) fail "this release requires ARM64 Android" ;;
esac

BUSYBOX=/data/adb/magisk/busybox
[ -x "$BUSYBOX" ] || BUSYBOX=/data/adb/ksu/bin/busybox
[ -x "$BUSYBOX" ] || BUSYBOX=/data/adb/ap/bin/busybox
[ -x "$BUSYBOX" ] || BUSYBOX=busybox

old_ctl=/data/adb/modules/${MODULE_ID}/scripts/cpactl
[ ! -x "$old_ctl" ] || "$old_ctl" stop >/dev/null 2>&1 || true

say "extracting module controller"
unzip -o "$ZIPFILE" -x 'META-INF/*' -x 'payload/*' -d "$MODPATH" >&2 || fail "module extraction failed"
[ -f "$MODPATH/payload-manifest.txt" ] || fail "payload manifest is missing"

mkdir -p "$DATA_DIR/releases" "$DATA_DIR/config" "$DATA_DIR/auth" \
  "$DATA_DIR/data" "$DATA_DIR/plugins/linux/arm64" "$DATA_DIR/run" \
  "$DATA_DIR/logs" "$DATA_DIR/backups"

stage="$DATA_DIR/releases/.staging.$$.${RANDOM:-0}"
rm -rf "$stage"
mkdir -p "$stage"
unzip -o "$ZIPFILE" 'payload/*' -d "$stage" >&2 || fail "payload extraction failed"
runtime="$stage/payload"
[ -f "$runtime/runtime.version" ] || fail "runtime version is missing"
[ -f "$runtime/checksums.sha256" ] || fail "runtime checksum manifest is missing"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$runtime" && sha256sum -c checksums.sha256 >/dev/null) || fail "payload checksum mismatch"
elif (cd "$runtime" && "$BUSYBOX" sha256sum -c checksums.sha256 >/dev/null 2>&1); then
  :
else
  fail "sha256sum is unavailable"
fi

release_id=$(sed -n 's/^release_id=//p' "$runtime/runtime.version" | head -1)
case "$release_id" in
  ''|*[!A-Za-z0-9._-]*) fail "runtime release id is unsafe" ;;
esac

release="$DATA_DIR/releases/$release_id"
rm -rf "$release"
mv "$runtime" "$release" || fail "unable to install runtime release"
rm -rf "$stage"

old_plugins="$DATA_DIR/current/plugins"
if [ -d "$old_plugins" ]; then
  cp -a "$old_plugins/." "$DATA_DIR/plugins/" 2>/dev/null || fail "unable to preserve installed plugins"
  say "preserved runtime-installed plugins"
fi

config_file="$DATA_DIR/config/config.yaml"
old_plugin_path="$DATA_DIR/current/plugins"
new_plugin_path="$DATA_DIR/plugins"
if [ -f "$config_file" ] && grep -Fq "$old_plugin_path" "$config_file"; then
  config_backup="$DATA_DIR/backups/config-v1.1.0-pre-plugin-path.yaml"
  cp -p "$config_file" "$config_backup" || fail "unable to back up config before plugin path migration"
  sed -i "s#$old_plugin_path#$new_plugin_path#g" "$config_file"
  chmod 0600 "$config_backup" "$config_file"
  say "migrated plugins.dir to persistent module storage"
fi

ln -s "$release" "$DATA_DIR/current.new.$$"
"$BUSYBOX" mv -fT "$DATA_DIR/current.new.$$" "$DATA_DIR/current" || fail "unable to select runtime release"
[ "$(readlink "$DATA_DIR/current" 2>/dev/null)" = "$release" ] || fail "runtime release selection did not persist"

if [ ! -f "$DATA_DIR/config/config.yaml" ] && [ -f "$MODPATH/config.example.yaml" ]; then
  cp -p "$MODPATH/config.example.yaml" "$DATA_DIR/config/config.yaml.example"
fi

find "$release" -type d -exec chmod 0755 {} \; 2>/dev/null || true
find "$release" -type f -exec chmod 0644 {} \; 2>/dev/null || true
find "$release/bin" -type f -exec chmod 0755 {} \; 2>/dev/null || true
find "$release/lib" -type f -exec chmod 0755 {} \; 2>/dev/null || true

chmod 0711 "$DATA_DIR"
chmod 0700 "$DATA_DIR/config" "$DATA_DIR/auth" "$DATA_DIR/data" \
  "$DATA_DIR/plugins" "$DATA_DIR/run" "$DATA_DIR/logs" "$DATA_DIR/backups"
chown -R 9999:3003 "$DATA_DIR/config" "$DATA_DIR/auth" "$DATA_DIR/data" \
  "$DATA_DIR/plugins" "$DATA_DIR/run" "$DATA_DIR/logs" 2>/dev/null || true
find "$DATA_DIR/config" "$DATA_DIR/auth" "$DATA_DIR/data" "$DATA_DIR/run" \
  "$DATA_DIR/logs" "$DATA_DIR/plugins" -type d -exec chmod 0700 {} \; 2>/dev/null || true
find "$DATA_DIR/config" "$DATA_DIR/auth" "$DATA_DIR/data" "$DATA_DIR/run" \
  "$DATA_DIR/logs" -type f -exec chmod 0600 {} \; 2>/dev/null || true

set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/customize.sh" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/action.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
set_perm "$MODPATH/scripts/cpactl" 0 0 0755
set_perm "$MODPATH/system/bin/cpactl" 0 0 0755

say "runtime release: $release_id"
if [ -f "$DATA_DIR/config/config.yaml" ]; then
  say "config found; reboot or run cpactl start"
else
  say "config not found; copy config.yaml manually before starting"
fi
say "installation complete; persistent data was preserved"
