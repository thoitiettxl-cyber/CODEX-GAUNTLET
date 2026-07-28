package sidecar

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/credential"
	credentialstore "github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/store"
)

func TestEncryptedSidecarManagementAndProxyLifecycle(t *testing.T) {
	var upstreamMu sync.Mutex
	var upstreamAuth, upstreamCookie, upstreamManagement, upstreamBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		upstreamMu.Lock()
		upstreamAuth = request.Header.Get("Authorization")
		upstreamCookie = request.Header.Get("Cookie")
		upstreamManagement = request.Header.Get("X-Management-Key")
		raw, _ := io.ReadAll(request.Body)
		upstreamBody = string(raw)
		upstreamMu.Unlock()
		response.Header().Set("Content-Type", "text/event-stream")
		response.Header().Set("Set-Cookie", "must-not-leak=1")
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte("data: encrypted-sidecar-ok\n\n"))
	}))
	t.Cleanup(upstream.Close)

	dataDir := t.TempDir()
	credentialStore, err := credentialstore.New(dataDir, bytes.Repeat([]byte{0x44}, 32))
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{
		ManagementKey:     []byte("lab-management-key"),
		ProjectionBaseURL: "http://127.0.0.1:18319/backend-api/codex",
		UpstreamURL:       upstream.URL + "/backend-api/codex",
		AllowTestUpstream: true,
		Store:             credentialStore,
	})
	if err != nil {
		t.Fatal(err)
	}

	status := performRequest(t, service, http.MethodGet, ManagementPrefix+"/status", "", "")
	if status.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status code=%d", status.Code)
	}

	imported := performRequest(t, service, http.MethodPost, ManagementPrefix+"/credentials/import", `{"token":"at-local-test-token","label":"lab"}`, "lab-management-key")
	if imported.Code != http.StatusCreated {
		t.Fatalf("import code=%d", imported.Code)
	}
	var first projectionResponse
	if err := json.Unmarshal(imported.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if !first.Credential.Disabled || !credential.ValidCredentialID(first.Credential.ID) || !credential.ValidOpaqueKey(first.Projection.AccessToken) {
		t.Fatal("import returned invalid disabled projection")
	}
	assertStoreContainsNoSecret(t, dataDir, "at-local-test-token", first.Projection.AccessToken)

	disabledProxy := performProxy(t, service, first.Projection.AccessToken)
	if disabledProxy.Code != http.StatusForbidden {
		t.Fatalf("disabled proxy code=%d", disabledProxy.Code)
	}

	enabled := performRequest(t, service, http.MethodPost, ManagementPrefix+"/credentials/"+first.Credential.ID+"/actions", `{"action":"enable"}`, "lab-management-key")
	if enabled.Code != http.StatusOK {
		t.Fatalf("enable code=%d", enabled.Code)
	}
	var active projectionResponse
	if err := json.Unmarshal(enabled.Body.Bytes(), &active); err != nil || active.Credential.Disabled || active.Projection.Disabled {
		t.Fatal("enable did not return an active projection")
	}

	proxied := performProxy(t, service, active.Projection.AccessToken)
	if proxied.Code != http.StatusOK || !strings.Contains(proxied.Body.String(), "encrypted-sidecar-ok") || proxied.Header().Get("Set-Cookie") != "" {
		t.Fatalf("proxy response code=%d", proxied.Code)
	}
	upstreamMu.Lock()
	if upstreamAuth != "Bearer at-local-test-token" || upstreamBody != `{"model":"gpt-test"}` || upstreamCookie != "" || upstreamManagement != "" {
		upstreamMu.Unlock()
		t.Fatal("proxy did not enforce the credential/header boundary")
	}
	upstreamMu.Unlock()

	listed := performRequest(t, service, http.MethodGet, ManagementPrefix+"/credentials", "", "lab-management-key")
	if listed.Code != http.StatusOK || strings.Contains(listed.Body.String(), "at-local-test-token") || strings.Contains(listed.Body.String(), active.Projection.AccessToken) {
		t.Fatal("redacted list exposed credential material")
	}

	rotated := performRequest(t, service, http.MethodPost, ManagementPrefix+"/credentials/"+active.Credential.ID+"/actions", `{"action":"rotate"}`, "lab-management-key")
	if rotated.Code != http.StatusOK {
		t.Fatalf("rotate code=%d", rotated.Code)
	}
	var next projectionResponse
	if err := json.Unmarshal(rotated.Body.Bytes(), &next); err != nil || next.Projection.AccessToken == active.Projection.AccessToken {
		t.Fatal("rotation did not replace opaque key")
	}
	if performProxy(t, service, active.Projection.AccessToken).Code != http.StatusForbidden {
		t.Fatal("rotated opaque key remained valid")
	}
	if performProxy(t, service, next.Projection.AccessToken).Code != http.StatusOK {
		t.Fatal("new opaque key did not proxy")
	}

	deleted := performRequest(t, service, http.MethodDelete, ManagementPrefix+"/credentials/"+next.Credential.ID, "", "lab-management-key")
	if deleted.Code != http.StatusNoContent || performProxy(t, service, next.Projection.AccessToken).Code != http.StatusForbidden {
		t.Fatal("deleted credential remained available")
	}
}

func TestConfigurationRejectsRemoteOrCredentialBearingEndpoints(t *testing.T) {
	credentialStore, err := credentialstore.New(t.TempDir(), bytes.Repeat([]byte{0x55}, 32))
	if err != nil {
		t.Fatal(err)
	}
	base := Config{ManagementKey: []byte("lab-management-key"), ProjectionBaseURL: "http://127.0.0.1:18319/backend-api/codex", UpstreamURL: "https://chatgpt.com/backend-api/codex", Store: credentialStore}
	if _, err := New(base); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Config){
		"remote projection": func(value *Config) { value.ProjectionBaseURL = "http://example.com:18319/backend-api/codex" },
		"credential URL":    func(value *Config) { value.UpstreamURL = "https://user:pass@chatgpt.com/backend-api/codex" },
		"remote test URL": func(value *Config) {
			value.UpstreamURL = "http://example.com:18319/backend-api/codex"
			value.AllowTestUpstream = true
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidate := base
			mutate(&candidate)
			if _, err := New(candidate); err == nil {
				t.Fatal("unsafe sidecar configuration accepted")
			}
		})
	}
}

func TestProxyRejectsPathTraversalAndCrossOriginRedirect(t *testing.T) {
	redirectedRequests := 0
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectedRequests++
	}))
	t.Cleanup(redirectTarget.Close)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Location", redirectedRequestsURL(redirectTarget.URL))
		response.WriteHeader(http.StatusTemporaryRedirect)
	}))
	t.Cleanup(upstream.Close)

	credentialStore, err := credentialstore.New(t.TempDir(), bytes.Repeat([]byte{0x77}, 32))
	if err != nil {
		t.Fatal(err)
	}
	imported, err := credentialStore.Import("static-test-token", "lab", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = credentialStore.SetDisabled(imported.ID, false, time.Now()); err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{
		ManagementKey:     []byte("lab-management-key"),
		ProjectionBaseURL: "http://127.0.0.1:18319/backend-api/codex",
		UpstreamURL:       upstream.URL + credential.URLPath,
		AllowTestUpstream: true,
		Store:             credentialStore,
	})
	if err != nil {
		t.Fatal(err)
	}

	traversal := performProxyPath(t, service, imported.OpaqueKey, credential.URLPath+"/../admin")
	if traversal.Code != http.StatusBadRequest {
		t.Fatalf("path traversal code=%d", traversal.Code)
	}
	redirect := performProxyPath(t, service, imported.OpaqueKey, credential.URLPath+"/responses")
	if redirect.Code != http.StatusTemporaryRedirect || redirectedRequests != 0 {
		t.Fatalf("redirect code=%d redirected_requests=%d", redirect.Code, redirectedRequests)
	}
}

func redirectedRequestsURL(base string) string {
	return base + "/capture"
}

func performRequest(t *testing.T, handler http.Handler, method, path, body, managementKey string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if managementKey != "" {
		request.Header.Set("X-Management-Key", managementKey)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func performProxy(t *testing.T, handler http.Handler, opaque string) *httptest.ResponseRecorder {
	t.Helper()
	return performProxyPath(t, handler, opaque, credential.URLPath+"/responses")
}

func performProxyPath(t *testing.T, handler http.Handler, opaque, path string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"model":"gpt-test"}`))
	request.Header.Set("Authorization", "Bearer "+opaque)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cookie", "must-not-forward=1")
	request.Header.Set("X-Management-Key", "must-not-forward")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertStoreContainsNoSecret(t *testing.T, dir string, forbidden ...string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, value := range forbidden {
			if strings.Contains(string(raw), value) {
				t.Fatal("encrypted store contains forbidden credential material")
			}
		}
	}
}
