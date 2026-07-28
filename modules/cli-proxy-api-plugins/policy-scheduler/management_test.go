package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

func TestDashboardIsSelfContainedAndDoesNotReuseBrowserStorage(t *testing.T) {
	for _, forbidden := range []string{
		"<script src=\"http",
		"localStorage.getItem",
		"localStorage.setItem",
		"https://cdn.",
		"http://",
	} {
		if strings.Contains(dashboardHTML, forbidden) {
			t.Fatalf("dashboard contains forbidden external/storage behavior %q", forbidden)
		}
	}
	if !strings.Contains(dashboardJS, "X-Management-Key") || !strings.Contains(dashboardHTML, "same-origin") || !strings.Contains(dashboardHTML, "src=\"./dashboard.js\"") {
		t.Fatal("dashboard must use an in-memory management key and disclose same-origin risk")
	}
	for _, forbidden := range []string{"innerHTML", "eval(", "new Function", "localStorage."} {
		if strings.Contains(dashboardJS, forbidden) {
			t.Fatalf("dashboard JavaScript contains forbidden sink %q", forbidden)
		}
	}
}

func TestStatusUsesBothHostCallbacksAndRedactsCredentialIdentity(t *testing.T) {
	oldHostCall := hostCall
	t.Cleanup(func() { hostCall = oldHostCall })
	calledList := 0
	calledRuntime := 0
	hostCall = func(method string, payload any) (json.RawMessage, error) {
		switch method {
		case pluginabi.MethodHostAuthList:
			calledList++
			return mustJSON(t, authListResponse{Files: []pluginapi.HostAuthFileEntry{{
				ID:        "raw-auth-id",
				AuthIndex: "raw-auth-index",
				Name:      "secret-account.json",
				Email:     "operator@example.invalid",
				Path:      "/secret/auth/path",
				Provider:  "codex",
			}}}), nil
		case pluginabi.MethodHostAuthGetRuntime:
			calledRuntime++
			return mustJSON(t, pluginapi.HostAuthGetRuntimeResponse{Auth: pluginapi.HostAuthFileEntry{
				ID:             "raw-auth-id",
				AuthIndex:      "raw-auth-index",
				Name:           "secret-account.json",
				Email:          "operator@example.invalid",
				Account:        "raw-account-id",
				Path:           "/secret/auth/path",
				Provider:       "codex",
				Status:         "active",
				Priority:       10,
				NextRetryAfter: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC),
			}}), nil
		default:
			t.Fatalf("unexpected host method %q", method)
			return nil, nil
		}
	}

	status := buildStatusResponse(newPolicyEngine(defaultConfig()))
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, secret := range []string{"raw-auth-id", "raw-auth-index", "secret-account.json", "operator@example.invalid", "raw-account-id", "/secret/auth/path"} {
		if strings.Contains(text, secret) {
			t.Fatalf("status leaked %q: %s", secret, text)
		}
	}
	if calledList != 1 || calledRuntime != 1 || !status.HostStateAvailable {
		t.Fatalf("callback counts list/runtime = %d/%d, available=%v", calledList, calledRuntime, status.HostStateAvailable)
	}
	if len(status.Credentials) != 1 || !strings.HasPrefix(status.Credentials[0].Alias, "credential-") {
		t.Fatalf("credentials = %#v", status.Credentials)
	}
}

func TestRegistrationUsesOfficialCapabilityNamesAndSchema(t *testing.T) {
	registration := pluginRegistration()
	if registration.SchemaVersion != 2 || !registration.Capabilities.Scheduler || !registration.Capabilities.ManagementAPI {
		t.Fatalf("registration = %#v", registration)
	}
	raw, err := json.Marshal(registration)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, required := range []string{`"scheduler":true`, `"management_api":true`, `"Name":"Policy and Scheduling"`} {
		if !strings.Contains(text, required) {
			t.Fatalf("registration missing %s: %s", required, text)
		}
	}
	for _, invented := range []string{"account_manager", "quota_scheduler", "credential_router"} {
		if strings.Contains(text, invented) {
			t.Fatalf("registration contains invented capability %q", invented)
		}
	}
	fields := map[string]bool{}
	for _, field := range registration.Metadata.ConfigFields {
		fields[field.Name] = true
	}
	for _, required := range []string{"session_affinity_enabled", "session_affinity_header", "session_affinity_metadata_key", "session_affinity_ttl_seconds", "session_affinity_max_entries"} {
		if !fields[required] {
			t.Fatalf("registration missing affinity ConfigField %q", required)
		}
	}
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
