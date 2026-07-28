package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
	"github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/credential"
	"gopkg.in/yaml.v3"
)

const (
	pluginID      = "credential-security"
	pluginVersion = "0.1.0"
	defaultPort   = 18319
)

type envelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *envelopeError  `json:"error,omitempty"`
}

type envelopeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type lifecycleRequest struct {
	ConfigYAML []byte `json:"config_yaml"`
}

type pluginConfig struct {
	SidecarPort int `yaml:"sidecar_port"`
}

type registration struct {
	SchemaVersion uint32                   `json:"schema_version"`
	Metadata      pluginapi.Metadata       `json:"metadata"`
	Capabilities  registrationCapabilities `json:"capabilities"`
}

type registrationCapabilities struct {
	AuthProvider  bool `json:"auth_provider"`
	ManagementAPI bool `json:"management_api"`
}

type identifierResponse struct {
	Identifier string `json:"identifier"`
}

type runtimeState struct {
	mu     sync.RWMutex
	config pluginConfig
}

type counters struct {
	registerTotal    atomic.Uint64
	reconfigureTotal atomic.Uint64
	parseTotal       atomic.Uint64
	parseHandled     atomic.Uint64
	parseRejected    atomic.Uint64
	refreshTotal     atomic.Uint64
}

var (
	globalState    = runtimeState{config: pluginConfig{SidecarPort: defaultPort}}
	globalCounters counters
)

func handleMethod(method string, request []byte) ([]byte, error) {
	switch method {
	case pluginabi.MethodPluginRegister:
		if err := configure(request); err != nil {
			return errorEnvelope("invalid_config", err.Error()), nil
		}
		globalCounters.registerTotal.Add(1)
		return okEnvelope(pluginRegistration())
	case pluginabi.MethodPluginReconfigure:
		if err := configure(request); err != nil {
			return errorEnvelope("invalid_config", err.Error()), nil
		}
		globalCounters.reconfigureTotal.Add(1)
		return okEnvelope(pluginRegistration())
	case pluginabi.MethodPluginShutdown:
		return okEnvelope(map[string]any{})
	case pluginabi.MethodAuthIdentifier:
		return okEnvelope(identifierResponse{Identifier: "codex"})
	case pluginabi.MethodAuthParse:
		return handleAuthParse(request)
	case pluginabi.MethodAuthRefresh:
		return handleAuthRefresh(request)
	case pluginabi.MethodAuthLoginStart:
		return okEnvelope(pluginapi.AuthLoginStartResponse{Provider: "codex", ExpiresAt: time.Now().UTC()})
	case pluginabi.MethodAuthLoginPoll:
		return okEnvelope(pluginapi.AuthLoginPollResponse{Status: pluginapi.AuthLoginStatusError, Message: "manage static sidecar credentials through the credential-security sidecar"})
	case pluginabi.MethodManagementRegister:
		return okEnvelope(registerManagement())
	case pluginabi.MethodManagementHandle:
		return handleManagement(request)
	default:
		return errorEnvelope("unknown_method", "unknown method: "+method), nil
	}
}

func configure(raw []byte) error {
	cfg := pluginConfig{SidecarPort: defaultPort}
	if len(raw) != 0 {
		var request lifecycleRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return errors.New("decode lifecycle request")
		}
		if len(request.ConfigYAML) != 0 {
			if err := yaml.Unmarshal(request.ConfigYAML, &cfg); err != nil {
				return errors.New("decode plugin config")
			}
		}
	}
	if cfg.SidecarPort == 0 {
		cfg.SidecarPort = defaultPort
	}
	if cfg.SidecarPort < 1024 || cfg.SidecarPort > 65535 {
		return errors.New("sidecar_port must be between 1024 and 65535")
	}
	globalState.mu.Lock()
	globalState.config = cfg
	globalState.mu.Unlock()
	return nil
}

func currentConfig() pluginConfig {
	globalState.mu.RLock()
	defer globalState.mu.RUnlock()
	return globalState.config
}

func pluginRegistration() registration {
	return registration{
		SchemaVersion: pluginabi.SchemaVersion,
		Metadata: pluginapi.Metadata{
			Name:             "Credential Security",
			Version:          pluginVersion,
			Author:           "thoitiettxl-cyber",
			GitHubRepository: "https://github.com/thoitiettxl-cyber/codex-gauntlet-termux",
			ConfigFields: []pluginapi.ConfigField{{
				Name:        "sidecar_port",
				Type:        pluginapi.ConfigFieldTypeInteger,
				Description: "Loopback credential-security sidecar port (1024-65535).",
			}},
		},
		Capabilities: registrationCapabilities{AuthProvider: true, ManagementAPI: true},
	}
}

func handleAuthParse(raw []byte) ([]byte, error) {
	globalCounters.parseTotal.Add(1)
	var request pluginapi.AuthParseRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		globalCounters.parseRejected.Add(1)
		return errorEnvelope("invalid_auth_parse", "auth parse request is invalid"), nil
	}
	parsed, handled, err := credential.Parse(request.Provider, request.FileName, request.RawJSON, currentConfig().SidecarPort)
	if err != nil {
		globalCounters.parseRejected.Add(1)
		return errorEnvelope("invalid_credential_projection", err.Error()), nil
	}
	if !handled || parsed == nil {
		return okEnvelope(pluginapi.AuthParseResponse{Handled: false})
	}
	globalCounters.parseHandled.Add(1)
	return okEnvelope(pluginapi.AuthParseResponse{Handled: true, Auth: authData(parsed)})
}

func handleAuthRefresh(raw []byte) ([]byte, error) {
	globalCounters.refreshTotal.Add(1)
	var request pluginapi.AuthRefreshRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		return errorEnvelope("invalid_auth_refresh", "auth refresh request is invalid"), nil
	}
	fileName := request.AuthID
	if value, ok := request.Metadata["file_name"].(string); ok && value != "" {
		fileName = value
	}
	parsed, handled, err := credential.Parse(request.AuthProvider, fileName, request.StorageJSON, currentConfig().SidecarPort)
	if err != nil || !handled || parsed == nil {
		return errorEnvelope("invalid_credential_projection", "credential refresh projection is invalid"), nil
	}
	data := authData(parsed)
	data.ID = request.AuthID
	return okEnvelope(pluginapi.AuthRefreshResponse{Auth: data, NextRefreshAfter: time.Now().Add(24 * time.Hour).UTC()})
}

func authData(parsed *credential.Parsed) pluginapi.AuthData {
	if parsed == nil {
		return pluginapi.AuthData{}
	}
	return pluginapi.AuthData{
		Provider:    "codex",
		ID:          parsed.ID,
		FileName:    parsed.FileName,
		Label:       parsed.Label,
		Prefix:      parsed.Prefix,
		Disabled:    parsed.Disabled,
		StorageJSON: append([]byte(nil), parsed.StorageJSON...),
		Metadata:    cloneAnyMap(parsed.Metadata),
		Attributes:  cloneStringMap(parsed.Attributes),
	}
}

func cloneAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func okEnvelope(value any) ([]byte, error) {
	result, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode plugin response")
	}
	return json.Marshal(envelope{OK: true, Result: result})
}

func errorEnvelope(code, message string) []byte {
	raw, _ := json.Marshal(envelope{OK: false, Error: &envelopeError{Code: code, Message: message}})
	return raw
}
