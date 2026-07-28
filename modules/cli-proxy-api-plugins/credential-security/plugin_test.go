package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
	"github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/credential"
)

const testOpaque = "cpcs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestRegistrationDeclaresBoundedCapabilities(t *testing.T) {
	resetPluginForTest(t)
	raw, err := handleMethod(pluginabi.MethodPluginRegister, lifecyclePayload(t, "sidecar_port: 18319"))
	if err != nil {
		t.Fatal(err)
	}
	var got registration
	decodeResult(t, raw, &got)
	if got.Metadata.Version != pluginVersion || !got.Capabilities.AuthProvider || !got.Capabilities.ManagementAPI || len(got.Metadata.ConfigFields) != 1 {
		t.Fatalf("unexpected registration: %#v", got)
	}
	if got.Metadata.ConfigFields[0].Name != "sidecar_port" {
		t.Fatalf("unexpected config fields: %#v", got.Metadata.ConfigFields)
	}
}

func TestAuthProviderHandlesOnlySidecarProjection(t *testing.T) {
	resetPluginForTest(t)
	projection := credential.Projection{Type: "codex", AuthMode: credential.AuthMode, AccessToken: testOpaque, BaseURL: "http://127.0.0.1:18319/backend-api/codex", CredentialID: "cs-0123456789abcdef01234567", Disabled: true}
	projectionRaw, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	requestRaw, err := json.Marshal(pluginapi.AuthParseRequest{Provider: "codex", FileName: "credential-security-cs-0123456789abcdef01234567.json", RawJSON: projectionRaw})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := handleMethod(pluginabi.MethodAuthParse, requestRaw)
	if err != nil {
		t.Fatal(err)
	}
	var response pluginapi.AuthParseResponse
	decodeResult(t, raw, &response)
	if !response.Handled || response.Auth.Provider != "codex" || !response.Auth.Disabled || response.Auth.Attributes["api_key"] != testOpaque {
		t.Fatalf("unexpected auth parse response: %#v", response)
	}
	if _, exposed := response.Auth.Metadata["access_token"]; exposed {
		t.Fatal("opaque key exposed through metadata")
	}

	ordinaryRaw, _ := json.Marshal(pluginapi.AuthParseRequest{Provider: "codex", FileName: "ordinary.json", RawJSON: []byte(`{"type":"codex","access_token":"ordinary"}`)})
	raw, err = handleMethod(pluginabi.MethodAuthParse, ordinaryRaw)
	if err != nil {
		t.Fatal(err)
	}
	decodeResult(t, raw, &response)
	if response.Handled {
		t.Fatal("ordinary built-in credential was intercepted")
	}
}

func TestManagementStatusIsAuthenticatedRouteOnlyAndRedacted(t *testing.T) {
	resetPluginForTest(t)
	raw, err := handleMethod(pluginabi.MethodManagementRegister, nil)
	if err != nil {
		t.Fatal(err)
	}
	var registration managementRegistration
	decodeResult(t, raw, &registration)
	if len(registration.Routes) != 1 || registration.Routes[0].Path != managementStatusPath || strings.Contains(string(raw), "resources") || strings.Contains(string(raw), "Menu") {
		t.Fatalf("unsafe management registration: %s", raw)
	}
	request, _ := json.Marshal(managementRequest{Method: http.MethodGet, Path: "/v0/management" + managementStatusPath})
	raw, err = handleMethod(pluginabi.MethodManagementHandle, request)
	if err != nil {
		t.Fatal(err)
	}
	var response managementResponse
	decodeResult(t, raw, &response)
	if response.StatusCode != http.StatusOK || response.Headers.Get("Cache-Control") != "no-store" || response.Headers.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("unexpected management response: %#v", response)
	}
	body := string(response.Body)
	for _, forbidden := range []string{testOpaque, "access_token", "refresh_token", "StorageJSON"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("status exposed forbidden field %q", forbidden)
		}
	}
}

func TestInvalidConfigIsRejected(t *testing.T) {
	resetPluginForTest(t)
	for _, value := range []string{"sidecar_port: 80", "sidecar_port: 70000", "sidecar_port: nope"} {
		raw, err := handleMethod(pluginabi.MethodPluginReconfigure, lifecyclePayload(t, value))
		if err != nil {
			t.Fatal(err)
		}
		var response envelope
		if err := json.Unmarshal(raw, &response); err != nil || response.OK || response.Error == nil || response.Error.Code != "invalid_config" {
			t.Fatalf("config %q was accepted: %s", value, raw)
		}
	}
}

func resetPluginForTest(t *testing.T) {
	t.Helper()
	globalState.mu.Lock()
	globalState.config = pluginConfig{SidecarPort: defaultPort}
	globalState.mu.Unlock()
	globalCounters.registerTotal.Store(0)
	globalCounters.reconfigureTotal.Store(0)
	globalCounters.parseTotal.Store(0)
	globalCounters.parseHandled.Store(0)
	globalCounters.parseRejected.Store(0)
	globalCounters.refreshTotal.Store(0)
}

func lifecyclePayload(t *testing.T, yamlConfig string) []byte {
	t.Helper()
	raw, err := json.Marshal(lifecycleRequest{ConfigYAML: []byte(yamlConfig)})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func decodeResult(t *testing.T, raw []byte, target any) {
	t.Helper()
	var response envelope
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Error != nil {
		t.Fatalf("plugin response failed: %#v", response.Error)
	}
	if err := json.Unmarshal(response.Result, target); err != nil {
		t.Fatal(err)
	}
}
