#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREFIX_DIR=${PREFIX:-/data/data/com.termux/files/usr}
CORE=${CPA_PLUGIN_TEST_CORE:-$ROOT/.cache/core-7.2.103/cli-proxy-api}
PLUGIN=${CPA_PLUGIN_TEST_BINARY:-$ROOT/dist/policy-scheduler-v0.3.0.so}
PORT=${CPA_PLUGIN_TEST_PORT:-18317}
MANAGEMENT_KEY=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')

for command in curl grun jq od sed tr; do
	command -v "$command" >/dev/null 2>&1 || {
		echo "missing integration test command: $command" >&2
		exit 1
	}
done
for file in "$CORE" "$PLUGIN" "$ROOT/testdata/config.yaml.in"; do
	[[ -f "$file" ]] || {
		echo "missing integration test input: $file" >&2
		exit 1
	}
done

if curl --silent --show-error --max-time 1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
	echo "integration test port is already in use: $PORT" >&2
	exit 1
fi

lab=$(mktemp -d "$PREFIX_DIR/tmp/cliproxy-plugin-host.XXXXXX")
server_pid=""
cleanup() {
	if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
	rm -rf "$lab"
}
trap cleanup EXIT

mkdir -p "$lab/auth" "$lab/plugins/linux/arm64"
cp -p "$PLUGIN" "$lab/plugins/linux/arm64/policy-scheduler-v0.3.0.so"
sed \
	-e "s|__PORT__|$PORT|g" \
	-e "s|__AUTH_DIR__|$lab/auth|g" \
	-e "s|__PLUGIN_DIR__|$lab/plugins|g" \
	-e "s|__MANAGEMENT_KEY__|$MANAGEMENT_KEY|g" \
	"$ROOT/testdata/config.yaml.in" >"$lab/config.yaml"

grun "$CORE" -config "$lab/config.yaml" >"$lab/server.log" 2>&1 &
server_pid=$!

ready=0
for _ in $(seq 1 100); do
	if curl --silent --max-time 1 -o /dev/null "http://127.0.0.1:$PORT/v0/management/plugins"; then
		ready=1
		break
	fi
	if ! kill -0 "$server_pid" 2>/dev/null; then
		break
	fi
	sleep 0.1
done
if [[ "$ready" != 1 ]]; then
	echo "temporary CLIProxyAPI did not become ready" >&2
	sed -n '1,160p' "$lab/server.log" >&2
	exit 1
fi

curl --silent --show-error --dump-header "$lab/headers" --output /dev/null \
	"http://127.0.0.1:$PORT/v0/management/plugins"
grep -qi '^X-Cpa-Support-Plugin: 1' "$lab/headers"

management_curl=(curl --fail --silent --show-error --max-time 3 -H "X-Management-Key: $MANAGEMENT_KEY")
"${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/plugins" >"$lab/plugins.json"
jq -e '.plugins_enabled == true and any(.plugins[]; .id == "policy-scheduler" and .registered == true and .effective_enabled == true and (.config_fields | length) >= 19)' "$lab/plugins.json" >/dev/null

"${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/policy-scheduler/status" >"$lab/status.json"
jq -e '.plugin == "policy-scheduler" and .version == "0.3.0" and .host_state_available == true and .config.quota_reserve_percent == 10 and .config.session_affinity_enabled == false and .config.session_affinity_ttl_seconds == 3600 and .affinity.active_bindings == 0 and .affinity.key_available == true and (.host_contract_limitations | length) == 3' "$lab/status.json" >/dev/null
if rg -i '"(storage_?json|access[_ -]?token|refresh[_ -]?token|authorization)"[[:space:]]*:|bearer[[:space:]]+[[:graph:]]+' "$lab/status.json" >/dev/null; then
	echo "redacted status contains a forbidden credential field" >&2
	exit 1
fi

curl --fail --silent --show-error --max-time 3 \
	"http://127.0.0.1:$PORT/v0/resource/plugins/policy-scheduler/dashboard" >"$lab/dashboard.html"
rg -q 'same-origin' "$lab/dashboard.html"
! rg -q 'localStorage\.(getItem|setItem)' "$lab/dashboard.html"
curl --fail --silent --show-error --max-time 3 \
	"http://127.0.0.1:$PORT/v0/resource/plugins/policy-scheduler/dashboard.js" >"$lab/dashboard.js"
rg -q 'X-Management-Key' "$lab/dashboard.js"
! rg -q 'innerHTML|eval\(|new Function|localStorage\.' "$lab/dashboard.js"

"${management_curl[@]}" -H 'Content-Type: application/json' -X PATCH \
	-d '{"quota_reserve_percent":25,"session_affinity_enabled":true,"session_affinity_ttl_seconds":600,"session_affinity_max_entries":128}' \
	"http://127.0.0.1:$PORT/v0/management/plugins/policy-scheduler/config" >/dev/null
for _ in $(seq 1 50); do
	if "${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/policy-scheduler/status" 2>/dev/null | jq -e '.config.quota_reserve_percent == 25 and .config.session_affinity_enabled == true and .config.session_affinity_ttl_seconds == 600 and .config.session_affinity_max_entries == 128' >/dev/null; then
		break
	fi
	sleep 0.1
done
"${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/policy-scheduler/status" | jq -e '.config.quota_reserve_percent == 25 and .config.session_affinity_enabled == true and .config.session_affinity_ttl_seconds == 600 and .config.session_affinity_max_entries == 128' >/dev/null

"${management_curl[@]}" -H 'Content-Type: application/json' -X PATCH \
	-d '{"enabled":false}' \
	"http://127.0.0.1:$PORT/v0/management/plugins/policy-scheduler/enabled" >/dev/null
for _ in $(seq 1 50); do
	code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
		"http://127.0.0.1:$PORT/v0/resource/plugins/policy-scheduler/dashboard" || true)
	[[ "$code" == 404 ]] && break
	sleep 0.1
done
[[ "$code" == 404 ]] || {
	echo "resource route remained active after plugin disable (HTTP $code)" >&2
	exit 1
}

"${management_curl[@]}" -H 'Content-Type: application/json' -X PATCH \
	-d '{"enabled":true}' \
	"http://127.0.0.1:$PORT/v0/management/plugins/policy-scheduler/enabled" >/dev/null
for _ in $(seq 1 50); do
	code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
		"http://127.0.0.1:$PORT/v0/resource/plugins/policy-scheduler/dashboard" || true)
	[[ "$code" == 200 ]] && break
	sleep 0.1
done
[[ "$code" == 200 ]] || {
	echo "resource route did not recover after plugin re-enable (HTTP $code)" >&2
	exit 1
}

if rg -i "storagejson|access[_ -]?token|refresh[_ -]?token|$MANAGEMENT_KEY" "$lab/server.log" >/dev/null; then
	echo "temporary host log contains a forbidden secret field/value" >&2
	exit 1
fi

echo "PASS: CLIProxyAPI 7.2.103 loaded, reconfigured, disabled, and re-enabled policy-scheduler"
