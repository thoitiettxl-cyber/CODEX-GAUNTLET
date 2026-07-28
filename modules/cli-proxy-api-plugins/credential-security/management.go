package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

const managementStatusPath = "/credential-security/status"

type managementRegistration struct {
	Routes []managementRoute `json:"routes,omitempty"`
}

type managementRoute struct {
	Method      string `json:"Method"`
	Path        string `json:"Path"`
	Description string `json:"Description,omitempty"`
}

type managementRequest struct {
	Method string `json:"Method"`
	Path   string `json:"Path"`
}

type managementResponse struct {
	StatusCode int         `json:"StatusCode"`
	Headers    http.Header `json:"Headers,omitempty"`
	Body       []byte      `json:"Body,omitempty"`
}

type statusView struct {
	Plugin              string            `json:"plugin"`
	Version             string            `json:"version"`
	Provider            string            `json:"provider"`
	AuthMode            string            `json:"auth_mode"`
	SidecarEndpoint     string            `json:"sidecar_endpoint"`
	Capabilities        []string          `json:"capabilities"`
	Counters            map[string]uint64 `json:"counters"`
	SecurityBoundary    []string          `json:"security_boundary"`
	OperationalWarnings []string          `json:"operational_warnings"`
}

func registerManagement() managementRegistration {
	return managementRegistration{Routes: []managementRoute{{Method: http.MethodGet, Path: managementStatusPath, Description: "Read-only redacted Credential Security status."}}}
}

func handleManagement(raw []byte) ([]byte, error) {
	var request managementRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		return nil, fmt.Errorf("decode management request")
	}
	if request.Path != "/v0/management"+managementStatusPath {
		return okEnvelope(managementResponse{StatusCode: http.StatusNotFound, Headers: secureJSONHeaders(), Body: []byte(`{"error":"not_found"}`)})
	}
	if request.Method != http.MethodGet {
		headers := secureJSONHeaders()
		headers.Set("Allow", http.MethodGet)
		return okEnvelope(managementResponse{StatusCode: http.StatusMethodNotAllowed, Headers: headers, Body: []byte(`{"error":"method_not_allowed"}`)})
	}
	config := currentConfig()
	status := statusView{
		Plugin:          pluginID,
		Version:         pluginVersion,
		Provider:        "codex",
		AuthMode:        "credential_security_sidecar",
		SidecarEndpoint: fmt.Sprintf("http://127.0.0.1:%d/backend-api/codex", config.SidecarPort),
		Capabilities:    []string{"auth_provider", "management_api"},
		Counters: map[string]uint64{
			"register_total":    globalCounters.registerTotal.Load(),
			"reconfigure_total": globalCounters.reconfigureTotal.Load(),
			"parse_total":       globalCounters.parseTotal.Load(),
			"parse_handled":     globalCounters.parseHandled.Load(),
			"parse_rejected":    globalCounters.parseRejected.Load(),
			"refresh_total":     globalCounters.refreshTotal.Load(),
		},
		SecurityBoundary: []string{
			"Only versioned sidecar-owned projections with opaque cpcs_ keys are handled.",
			"Ordinary built-in OAuth files are declined and never re-encrypted by this plugin.",
			"Original static bearer/PAT values remain in the separately keyed AES-256-GCM sidecar store.",
		},
		OperationalWarnings: []string{
			"Sidecar health and encrypted-store health must be checked through the loopback sidecar management API.",
			"The first slice supports bounded HTTP/SSE forwarding only; OAuth refresh, AgentAssertion, and WebSockets are not implemented.",
		},
	}
	body, err := json.Marshal(status)
	if err != nil {
		return nil, fmt.Errorf("encode credential security status")
	}
	return okEnvelope(managementResponse{StatusCode: http.StatusOK, Headers: secureJSONHeaders(), Body: body})
}

func secureJSONHeaders() http.Header {
	return http.Header{
		"Content-Type":            []string{"application/json; charset=utf-8"},
		"Cache-Control":           []string{"no-store"},
		"Content-Security-Policy": []string{"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"},
		"Referrer-Policy":         []string{"no-referrer"},
		"X-Content-Type-Options":  []string{"nosniff"},
		"X-Frame-Options":         []string{"DENY"},
	}
}
