#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREFIX_DIR=${PREFIX:-/data/data/com.termux/files/usr}
CORE=${CPA_PLUGIN_TEST_CORE:-$ROOT/.cache/core-7.2.103/cli-proxy-api}
PLUGIN=${CPA_PLUGIN_TEST_BINARY:-$ROOT/dist/policy-scheduler-v0.3.1.so}
CREDENTIAL_PLUGIN=${CPA_CREDENTIAL_PLUGIN_TEST_BINARY:-$ROOT/dist/credential-security-v0.1.0.so}
PORT=${CPA_PLUGIN_TEST_PORT:-18317}
MANAGEMENT_KEY=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')

for command in curl grun jq od sed tr; do
	command -v "$command" >/dev/null 2>&1 || {
		echo "missing integration test command: $command" >&2
		exit 1
	}
done
for file in "$CORE" "$PLUGIN" "$CREDENTIAL_PLUGIN" "$ROOT/testdata/config.yaml.in"; do
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
cp -p "$PLUGIN" "$lab/plugins/linux/arm64/policy-scheduler-v0.3.1.so"
cp -p "$CREDENTIAL_PLUGIN" "$lab/plugins/linux/arm64/credential-security-v0.1.0.so"
printf '%s\n' '{"type":"codex","auth_mode":"credential_security_sidecar","access_token":"cpcs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","base_url":"http://127.0.0.1:18319/backend-api/codex","credential_id":"cs-0123456789abcdef01234567","disabled":true,"websockets":false}' \
	>"$lab/auth/credential-security-cs-0123456789abcdef01234567.json"
chmod 0600 "$lab/auth/credential-security-cs-0123456789abcdef01234567.json"
printf '%s\n' '{"type":"codex","access_token":"synthetic-ordinary-disabled","disabled":true}' \
	>"$lab/auth/ordinary-codex-disabled.json"
chmod 0600 "$lab/auth/ordinary-codex-disabled.json"
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
jq -e '.plugins_enabled == true and any(.plugins[]; .id == "policy-scheduler" and .registered == true and .effective_enabled == true and (.config_fields | length) >= 19) and any(.plugins[]; .id == "credential-security" and .registered == true and .effective_enabled == true and (.config_fields | length) == 1)' "$lab/plugins.json" >/dev/null

"${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/policy-scheduler/status" >"$lab/status.json"
jq -e '.plugin == "policy-scheduler" and .version == "0.3.1" and .host_state_available == true and .config.quota_reserve_percent == 10 and .config.session_affinity_enabled == false and .config.session_affinity_ttl_seconds == 3600 and .affinity.active_bindings == 0 and .affinity.key_available == true and (.host_contract_limitations | length) == 3 and (.operational_warnings | length) >= 1 and .observability.generation >= 1 and .observability.register_count >= 1 and .observability.effectiveness_evaluation == "awaiting_scheduler_traffic" and (.observability.picks_by_strategy | type) == "object" and (.observability.state_by_provider_model | type) == "array"' "$lab/status.json" >/dev/null
if rg -i '"(storage_?json|access[_ -]?token|refresh[_ -]?token|authorization)"[[:space:]]*:|bearer[[:space:]]+[[:graph:]]+' "$lab/status.json" >/dev/null; then
	echo "redacted status contains a forbidden credential field" >&2
	exit 1
fi

"${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/credential-security/status" >"$lab/credential-status.json"
jq -e '.plugin == "credential-security" and .version == "0.1.0" and .provider == "codex" and .auth_mode == "credential_security_sidecar" and .counters.register_total >= 1 and .counters.parse_total >= 2 and .counters.parse_handled >= 1 and .counters.parse_total > .counters.parse_handled and .counters.parse_rejected == 0 and (.security_boundary | length) >= 3 and (.operational_warnings | length) >= 2' "$lab/credential-status.json" >/dev/null
if rg -i '"(storage_?json|access[_ -]?token|refresh[_ -]?token|authorization)"[[:space:]]*:|bearer[[:space:]]+[[:graph:]]+|cpcs_[a-f0-9]+' "$lab/credential-status.json" >/dev/null; then
	echo "credential-security status contains a forbidden credential field" >&2
	exit 1
fi
credential_resource_code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
	"http://127.0.0.1:$PORT/v0/resource/plugins/credential-security/status" || true)
[[ "$credential_resource_code" == 404 ]]

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
"${management_curl[@]}" "http://127.0.0.1:$PORT/v0/management/policy-scheduler/status" | jq -e '.config.quota_reserve_percent == 25 and .config.session_affinity_enabled == true and .config.session_affinity_ttl_seconds == 600 and .config.session_affinity_max_entries == 128 and .observability.generation >= 2 and .observability.reconfigure_count >= 1 and .observability.effectiveness_evaluation == "awaiting_scheduler_traffic"' >/dev/null

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

"${management_curl[@]}" -H 'Content-Type: application/json' -X PATCH \
	-d '{"enabled":false}' \
	"http://127.0.0.1:$PORT/v0/management/plugins/credential-security/enabled" >/dev/null
for _ in $(seq 1 50); do
	credential_code=$("${management_curl[@]}" --output /dev/null --write-out '%{http_code}' \
		"http://127.0.0.1:$PORT/v0/management/credential-security/status" 2>/dev/null || true)
	[[ "$credential_code" == 404 ]] && break
	sleep 0.1
done
[[ "$credential_code" == 404 ]]

"${management_curl[@]}" -H 'Content-Type: application/json' -X PATCH \
	-d '{"enabled":true}' \
	"http://127.0.0.1:$PORT/v0/management/plugins/credential-security/enabled" >/dev/null
for _ in $(seq 1 50); do
	credential_code=$("${management_curl[@]}" --output /dev/null --write-out '%{http_code}' \
		"http://127.0.0.1:$PORT/v0/management/credential-security/status" 2>/dev/null || true)
	[[ "$credential_code" == 200 ]] && break
	sleep 0.1
done
[[ "$credential_code" == 200 ]]

if rg -i "storagejson|access[_ -]?token|refresh[_ -]?token|$MANAGEMENT_KEY" "$lab/server.log" >/dev/null; then
	echo "temporary host log contains a forbidden secret field/value" >&2
	exit 1
fi

echo "PASS: CLIProxyAPI 7.2.103 loaded and exercised policy-scheduler plus credential-security"
