package main

import (
	"testing"

	"github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/credential"
)

func FuzzCredentialProjection(f *testing.F) {
	f.Add([]byte(`{"type":"codex","auth_mode":"credential_security_sidecar","access_token":"cpcs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","base_url":"http://127.0.0.1:18319/backend-api/codex","credential_id":"cs-0123456789abcdef01234567","disabled":true,"websockets":false}`))
	f.Add([]byte(`{"type":"codex","access_token":"ordinary"}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		_, _, _ = credential.Parse("codex", "credential-security-cs-0123456789abcdef01234567.json", raw, 18319)
	})
}

func FuzzManagementEnvelope(f *testing.F) {
	f.Add([]byte(`{"Method":"GET","Path":"/v0/management/credential-security/status"}`))
	f.Add([]byte(`{`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		_, _ = handleManagement(raw)
	})
}
