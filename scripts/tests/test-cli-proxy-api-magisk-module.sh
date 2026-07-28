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
MODULE=$ROOT/modules/cli-proxy-api-magisk
MODULE_VERSION=$(sed -n 's/^version=//p' "$MODULE/module.prop")
RUNTIME_FIXTURE=
if [[ -z ${CPA_RUNTIME_DIR:-} && ! -f ${HOME:-/data/data/com.termux/files/home}/CLIProxyAPI/cli-proxy-api ]]; then
  packaged="$MODULE/dist/CLIProxyAPI_Magisk_${MODULE_VERSION}.zip"
  [[ -f "$packaged" ]] || {
    echo "missing packaged runtime fixture: $packaged" >&2
    exit 1
  }
  RUNTIME_FIXTURE=$(mktemp -d "${TMPDIR:-/data/data/com.termux/files/usr/tmp}/cpa-runtime-fixture.XXXXXX")
  unzip -q "$packaged" 'payload/*' -d "$RUNTIME_FIXTURE"
  export CPA_RUNTIME_DIR="$RUNTIME_FIXTURE/payload"
  echo "Using packaged runtime fixture: $packaged"
fi
BUILD_OUT=$(mktemp -d "${TMPDIR:-/data/data/com.termux/files/usr/tmp}/cpa-module-build.XXXXXX")
ARCHIVE=$BUILD_OUT/CLIProxyAPI_Magisk_${MODULE_VERSION}.zip
REQUIRE_LIVE=0

if [[ ${1:-} == --require-live ]]; then
  REQUIRE_LIVE=1
elif [[ -n ${1:-} ]]; then
  echo "usage: $0 [--require-live]" >&2
  exit 2
fi

for file in "$MODULE/customize.sh" "$MODULE/service.sh" "$MODULE/action.sh" \
  "$MODULE/uninstall.sh" "$MODULE/system/bin/cpactl" "$MODULE/scripts/cpactl"; do
  sh -n "$file"
done
bash -n "$MODULE/build.sh"
bash -n "$ROOT/scripts/tests/test-cli-proxy-api-magisk-feasibility.sh"
if grep -Eq 'codex-token-usage|CPA_TOKEN_USAGE_DIR|CPA_MODEL_PRICE_FILE' \
    "$MODULE/scripts/cpactl"; then
  echo "controller contains plugin-specific runtime policy" >&2
  exit 1
fi
echo "PASS shell syntax"

CPA_MODULE_OUT_DIR="$BUILD_OUT" "$MODULE/build.sh" >/dev/null
unzip -tq "$ARCHIVE" >/dev/null
(cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null)
echo "PASS archive integrity"

required=(
  module.prop customize.sh service.sh action.sh uninstall.sh
  META-INF/com/google/android/update-binary
  META-INF/com/google/android/updater-script
  system/bin/cpactl scripts/cpactl payload/runtime.version
  payload/checksums.sha256 payload/bin/cli-proxy-api
  payload/lib/ld-linux-aarch64.so.1 payload/lib/libc.so.6
  payload/ca/cert.pem
)
listing=$(unzip -Z1 "$ARCHIVE")
for entry in "${required[@]}"; do
  grep -Fxq "$entry" <<<"$listing" || { echo "missing archive entry: $entry" >&2; exit 1; }
done
if grep -E '^payload/plugins/' <<<"$listing"; then
  echo "archive unexpectedly bundles plugins" >&2
  exit 1
fi
if grep -E '(^|/)(config\.yaml|auth/|\.cli-proxy-api/|.*\.json)$' <<<"$listing"; then
  echo "archive contains forbidden config/auth data" >&2
  exit 1
fi
echo "PASS archive layout and secret-path exclusion"

tmp=$(mktemp -d "${TMPDIR:-/data/data/com.termux/files/usr/tmp}/cpa-module-test.XXXXXX")
conflict_pid=
cleanup() {
  if [[ -n ${conflict_pid:-} ]] && kill -0 "$conflict_pid" 2>/dev/null; then
    kill "$conflict_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp" "$BUILD_OUT"
  [[ -z ${RUNTIME_FIXTURE:-} ]] || rm -rf "$RUNTIME_FIXTURE"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$tmp/data/releases/release" "$tmp/module"
unzip -q "$ARCHIVE" 'payload/*' -d "$tmp/extracted"
cp -a "$tmp/extracted/payload/." "$tmp/data/releases/release/"
ln -s "$tmp/data/releases/release" "$tmp/data/current"
cp "$MODULE/module.prop" "$tmp/module/module.prop"
mkdir -p "$tmp/data/config"
printf '%s\n' \
  'host: "127.0.0.1"' \
  'port: 18318' \
  'remote-management:' \
  '  allow-remote: false' \
  'api-keys: []' \
  'auth-dir: "/data/local/cli-proxy-api/auth"' \
  'plugins:' \
  '  enabled: true' \
  "  dir: \"$tmp/data/plugins\"" \
  >"$tmp/data/config/config.yaml"

(
  cd "$tmp/data/releases/release"
  sha256sum -c checksums.sha256 >/dev/null
)
CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
  CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
  "$MODULE/scripts/cpactl" doctor >/dev/null
[[ -d "$tmp/data/data" && ! -e "$tmp/data/data/codex-token-usage" ]]
mkdir -p "$tmp/data/plugins/linux/arm64"
printf 'store-installed plugin fixture\n' >"$tmp/data/plugins/linux/arm64/store-plugin.so"
CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
  CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
  "$MODULE/scripts/cpactl" doctor >/dev/null
status_output=$(CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
  CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
  "$MODULE/scripts/cpactl" status 2>/dev/null || true)
grep -Fq 'plugins: 1 .so' <<<"$status_output"
grep -Fq 'plugin support: unknown' <<<"$status_output"
! grep -Fq 'dashboard' <<<"$status_output"
echo "PASS persistent plugin directory with zero and installed plugins"

cp "$tmp/data/config/config.yaml" "$tmp/safe.yaml"
sed -i 's/127\.0\.0\.1/0.0.0.0/' "$tmp/data/config/config.yaml"
if CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
    "$MODULE/scripts/cpactl" doctor >/dev/null 2>&1; then
  echo "wildcard config unexpectedly passed" >&2
  exit 1
fi
cp "$tmp/safe.yaml" "$tmp/data/config/config.yaml"
sed -i 's#auth-dir:.*#auth-dir: "/data/data/com.termux/files/home/.cli-proxy-api"#' "$tmp/data/config/config.yaml"
if CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
    "$MODULE/scripts/cpactl" doctor >/dev/null 2>&1; then
  echo "Termux config path unexpectedly passed" >&2
  exit 1
fi
cp "$tmp/safe.yaml" "$tmp/data/config/config.yaml"
sed -i 's/allow-remote: false/allow-remote: true/' "$tmp/data/config/config.yaml"
if CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
    "$MODULE/scripts/cpactl" doctor >/dev/null 2>&1; then
  echo "remote management unexpectedly passed" >&2
  exit 1
fi
cp "$tmp/safe.yaml" "$tmp/data/config/config.yaml"
echo "PASS unsafe config rejection"

cp "$tmp/safe.yaml" "$tmp/data/config/config.yaml"
sed -i 's/port: 18318/port: 18321/' "$tmp/data/config/config.yaml"
python3 -m http.server 18321 --bind 127.0.0.1 >"$tmp/conflict.log" 2>&1 &
conflict_pid=$!
sleep 1
if CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18321 \
    "$MODULE/scripts/cpactl" start >/dev/null 2>&1; then
  kill "$conflict_pid" 2>/dev/null || true
  echo "port conflict unexpectedly passed" >&2
  exit 1
fi
kill -0 "$conflict_pid"
kill "$conflict_pid"
wait "$conflict_pid" 2>/dev/null || true
conflict_pid=
cp "$tmp/safe.yaml" "$tmp/data/config/config.yaml"
echo "PASS foreign port conflict preservation"

fixture=$tmp/update-fixture
update_data=$tmp/update-data
mkdir -p "$fixture/archive" "$update_data/releases/base" "$update_data/config" "$tmp/update-module"
cp "$tmp/data/releases/release/bin/cli-proxy-api" "$fixture/archive/cli-proxy-api"
tar -czf "$fixture/core.tar.gz" -C "$fixture/archive" cli-proxy-api
fixture_version=$(sed -n 's/^core_version=//p' "$tmp/data/releases/release/runtime.version")
[[ "$fixture_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "invalid fixture core version: $fixture_version" >&2
  exit 1
}
asset=CLIProxyAPI_${fixture_version}_linux_aarch64.tar.gz
hash=$(sha256sum "$fixture/core.tar.gz" | awk '{print $1}')
printf '%s  %s\n' "$hash" "$asset" >"$fixture/checksums.good"
printf '%064d  %s\n' 0 "$asset" >"$fixture/checksums.bad"
printf '{"tag_name":"v%s","assets":[{"name":"checksums.txt","browser_download_url":"https://fixture/checksums"},{"name":"%s","browser_download_url":"https://fixture/archive"}]}\n' "$fixture_version" "$asset" >"$fixture/release.json"
printf '%s\n' \
  '#!/system/bin/sh' \
  'out=' \
  'url=' \
  'while [ "$#" -gt 0 ]; do' \
  '  case "$1" in' \
  '    -o) out=$2; shift 2 ;;' \
  '    --proto|--connect-timeout|--max-time|--cacert|-H) shift 2 ;;' \
  '    -*) shift ;;' \
  '    *) url=$1; shift ;;' \
  '  esac' \
  'done' \
  'case "$url" in' \
  '  https://fixture/release/latest) cp "$CPA_CURL_FIXTURE_DIR/release.json" "$out" ;;' \
  '  https://fixture/archive) cp "$CPA_CURL_FIXTURE_DIR/core.tar.gz" "$out" ;;' \
  '  https://fixture/checksums) cp "$CPA_CURL_FIXTURE_DIR/checksums.${CPA_CURL_FIXTURE_MODE:-good}" "$out" ;;' \
  '  *) exit 22 ;;' \
  'esac' \
  >"$fixture/fake-curl"
chmod 0755 "$fixture/fake-curl"
cp -a "$tmp/data/releases/release/." "$update_data/releases/base/"
ln -s "$update_data/releases/base" "$update_data/current"
sed "s#$tmp/data/plugins#$update_data/plugins#g" "$tmp/safe.yaml" >"$update_data/config/config.yaml"
sed -i 's/port: 18318/port: 18320/' "$update_data/config/config.yaml"
cp "$MODULE/module.prop" "$tmp/update-module/module.prop"
mkdir -p "$update_data/plugins/linux/arm64"
printf 'persistent plugin state\n' >"$update_data/plugins/linux/arm64/store-plugin.so"

if CPA_TEST_MODE=1 CPA_DATA_DIR="$update_data" CPA_MODULE_DIR="$tmp/update-module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_CURL="$fixture/fake-curl" \
    CPA_CURL_FIXTURE_DIR="$fixture" CPA_CURL_FIXTURE_MODE=bad \
    CPA_RELEASE_API_URL=https://fixture/release/latest CPA_PORT=18320 \
    "$MODULE/scripts/cpactl" update-core >/dev/null 2>&1; then
  echo "bad checksum update unexpectedly passed" >&2
  exit 1
fi
[[ $(readlink "$update_data/current") == "$update_data/releases/base" ]] || {
  echo "checksum failure changed current release" >&2; exit 1;
}

CPA_TEST_MODE=1 CPA_DATA_DIR="$update_data" CPA_MODULE_DIR="$tmp/update-module" \
  CPA_BUSYBOX="$(command -v busybox)" CPA_CURL="$fixture/fake-curl" \
  CPA_CURL_FIXTURE_DIR="$fixture" CPA_CURL_FIXTURE_MODE=good \
  CPA_RELEASE_API_URL=https://fixture/release/latest CPA_PORT=18320 \
  "$MODULE/scripts/cpactl" update-core >/dev/null
[[ $(readlink "$update_data/current") == "$update_data/releases/core-$fixture_version" ]] || {
  echo "valid update did not promote candidate" >&2; exit 1;
}
(cd "$update_data/current" && sha256sum -c checksums.sha256 >/dev/null)
[[ -f "$update_data/plugins/linux/arm64/store-plugin.so" ]] || {
  echo "update removed persistent plugin state" >&2; exit 1;
}
echo "PASS update checksum and promotion fixtures"

printf 'corrupt' >>"$tmp/data/releases/release/ca/cert.pem"
if CPA_TEST_MODE=1 CPA_DATA_DIR="$tmp/data" CPA_MODULE_DIR="$tmp/module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
    "$MODULE/scripts/cpactl" doctor >/dev/null 2>&1; then
  echo "corrupt runtime unexpectedly passed" >&2
  exit 1
fi
echo "PASS runtime checksum rejection"

purge_dir=${TMPDIR:-/data/data/com.termux/files/usr/tmp}/cpa-test-module-purge-$$
mkdir -p "$purge_dir/data"
printf 'preserve-until-confirmed\n' >"$purge_dir/data/sentinel"
if CPA_TEST_MODE=1 CPA_DATA_DIR="$purge_dir" CPA_MODULE_DIR="$tmp/module" \
    CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
    "$MODULE/scripts/cpactl" purge-data >/dev/null 2>&1; then
  echo "purge-data without confirmation unexpectedly passed" >&2
  exit 1
fi
[[ -f $purge_dir/data/sentinel ]]
CPA_TEST_MODE=1 CPA_DATA_DIR="$purge_dir" CPA_MODULE_DIR="$tmp/module" \
  CPA_BUSYBOX="$(command -v busybox)" CPA_PORT=18318 \
  "$MODULE/scripts/cpactl" purge-data --yes >/dev/null
[[ ! -e $purge_dir ]]
echo "PASS destructive purge confirmation boundary"

if rg -a -n 'CLIPROXYAPI_API_KEY=|Bearer [A-Za-z0-9_-]{12,}|/data/data/com\.termux/files/home/\.cli-proxy-api' "$ARCHIVE"; then
  echo "archive secret scan failed" >&2
  exit 1
fi
echo "PASS archive secret scan"

if [[ $REQUIRE_LIVE == 1 ]]; then
  su -c 'test -d /data/adb/modules/cli_proxy_api'
  su -c '/data/adb/modules/cli_proxy_api/scripts/cpactl doctor'
  su -c '/data/adb/modules/cli_proxy_api/scripts/cpactl status'
  echo "PASS installed module live proof"
fi

echo "PASS CLIProxyAPI Magisk module"
