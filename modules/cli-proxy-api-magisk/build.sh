#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOME_DIR=${HOME:-/data/data/com.termux/files/home}
PREFIX_DIR=${PREFIX:-/data/data/com.termux/files/usr}
CPA_RUNTIME_DIR=${CPA_RUNTIME_DIR:-}
if [ -n "$CPA_RUNTIME_DIR" ]; then
  CPA_BINARY=${CPA_BINARY:-$CPA_RUNTIME_DIR/bin/cli-proxy-api}
  GLIBC_LIB_DIR=${GLIBC_LIB_DIR:-$CPA_RUNTIME_DIR/lib}
  CA_FILE=${CA_FILE:-$CPA_RUNTIME_DIR/ca/cert.pem}
else
  CPA_BINARY=${CPA_BINARY:-$HOME_DIR/CLIProxyAPI/cli-proxy-api}
  GLIBC_LIB_DIR=${GLIBC_LIB_DIR:-$PREFIX_DIR/glibc/lib}
  CA_FILE=${CA_FILE:-$PREFIX_DIR/etc/tls/cert.pem}
fi
OUT_DIR=${CPA_MODULE_OUT_DIR:-$ROOT/dist}

for command in zip unzip sha256sum readelf file grun rg; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing build command: $command" >&2; exit 1; }
done

for file in "$CPA_BINARY" "$GLIBC_LIB_DIR/ld-linux-aarch64.so.1" \
  "$GLIBC_LIB_DIR/libc.so.6" "$GLIBC_LIB_DIR/libdl.so.2" \
  "$GLIBC_LIB_DIR/libresolv.so.2" "$GLIBC_LIB_DIR/libpthread.so.0" "$CA_FILE"; do
  [ -f "$file" ] || { echo "missing payload file: $file" >&2; exit 1; }
done

file "$CPA_BINARY" | grep -q 'ARM aarch64' || { echo "core is not ARM64 ELF" >&2; exit 1; }
readelf -l "$CPA_BINARY" | grep -q '/lib/ld-linux-aarch64.so.1' || { echo "unexpected core interpreter" >&2; exit 1; }

allowed_libs='^(libc\.so\.6|libdl\.so\.2|libresolv\.so\.2|libpthread\.so\.0|ld-linux-aarch64\.so\.1)$'
while IFS= read -r needed; do
  grep -Eq "$allowed_libs" <<<"$needed" || { echo "unbundled core dependency: $needed" >&2; exit 1; }
done < <(readelf -d "$CPA_BINARY" | sed -n 's/.*Shared library: \[\([^]]*\)\].*/\1/p')

version_line=$({ grun "$CPA_BINARY" --version 2>&1 || true; } | sed -n '/^CLIProxyAPI Version:/p' | head -1)
core_version=$(sed -n 's/^CLIProxyAPI Version: \([^,]*\).*/\1/p' <<<"$version_line")
[ -n "$core_version" ] || { echo "unable to read core version" >&2; exit 1; }
module_version=$(sed -n 's/^version=//p' "$ROOT/module.prop")
release_id="module-${module_version#v}-core-$core_version"

stage=$(mktemp -d "${TMPDIR:-$PREFIX_DIR/tmp}/cpa-magisk-build.XXXXXX")
trap 'rm -rf "$stage"' EXIT

for path in module.prop customize.sh service.sh action.sh uninstall.sh \
  config.example.yaml payload-manifest.txt META-INF system scripts; do
  cp -a "$ROOT/$path" "$stage/"
done

mkdir -p "$stage/payload/bin" "$stage/payload/lib" "$stage/payload/ca"
cp -p "$CPA_BINARY" "$stage/payload/bin/cli-proxy-api"
cp -p "$GLIBC_LIB_DIR/ld-linux-aarch64.so.1" "$stage/payload/lib/"
cp -p "$GLIBC_LIB_DIR/libc.so.6" "$stage/payload/lib/"
cp -p "$GLIBC_LIB_DIR/libdl.so.2" "$stage/payload/lib/"
cp -p "$GLIBC_LIB_DIR/libresolv.so.2" "$stage/payload/lib/"
cp -p "$GLIBC_LIB_DIR/libpthread.so.0" "$stage/payload/lib/"
cp -p "$CA_FILE" "$stage/payload/ca/cert.pem"

printf 'release_id=%s\ncore_version=%s\nmodule_version=%s\n' \
  "$release_id" "$core_version" "$module_version" \
  >"$stage/payload/runtime.version"

(
  cd "$stage/payload"
  find . -type f ! -name checksums.sha256 -print | LC_ALL=C sort | while read -r path; do
    sha256sum "${path#./}"
  done >checksums.sha256
  sha256sum -c checksums.sha256 >/dev/null
)

chmod 0755 "$stage/META-INF/com/google/android/update-binary" \
  "$stage/customize.sh" "$stage/service.sh" "$stage/action.sh" \
  "$stage/uninstall.sh" "$stage/scripts/cpactl" "$stage/system/bin/cpactl" \
  "$stage/payload/bin/cli-proxy-api" "$stage/payload/lib/ld-linux-aarch64.so.1"
find "$stage/payload/lib" -type f -exec chmod 0755 {} \;

if find "$stage" -type f \( -name 'config.yaml' -o -name '*.json' \) | grep -q .; then
  echo "refusing to package config or auth JSON" >&2
  exit 1
fi
if rg -l '/data/data/com.termux/files/home/\.cli-proxy-api|CLIPROXYAPI_API_KEY=' "$stage" >/dev/null; then
  echo "refusing to package credential paths or API key assignments" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
archive="$OUT_DIR/CLIProxyAPI_Magisk_${module_version}.zip"
rm -f "$archive" "$archive.sha256"
find "$stage" -exec touch -t 202607150000 {} +
(
  cd "$stage"
  find . -mindepth 1 -print | LC_ALL=C sort | zip -qX "$archive" -@
)
unzip -tq "$archive" >/dev/null
(cd "$OUT_DIR" && sha256sum "$(basename "$archive")" >"$(basename "$archive").sha256")

printf 'Built: %s\n' "$archive"
printf 'Core: %s\n' "$version_line"
printf 'Plugins: installed at runtime under /data/local/cli-proxy-api/plugins\n'
cat "$archive.sha256"
