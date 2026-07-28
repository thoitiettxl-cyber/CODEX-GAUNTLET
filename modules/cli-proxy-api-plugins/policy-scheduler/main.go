package main

/*
#include <stdint.h>
#include <stdlib.h>

typedef struct {
	void* ptr;
	size_t len;
} cliproxy_buffer;

typedef int (*cliproxy_host_call_fn)(void*, const char*, const uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_host_free_fn)(void*, size_t);

typedef struct {
	uint32_t abi_version;
	void* host_ctx;
	cliproxy_host_call_fn call;
	cliproxy_host_free_fn free_buffer;
} cliproxy_host_api;

typedef int (*cliproxy_plugin_call_fn)(char*, uint8_t*, size_t, cliproxy_buffer*);
typedef void (*cliproxy_plugin_free_fn)(void*, size_t);
typedef void (*cliproxy_plugin_shutdown_fn)(void);

typedef struct {
	uint32_t abi_version;
	cliproxy_plugin_call_fn call;
	cliproxy_plugin_free_fn free_buffer;
	cliproxy_plugin_shutdown_fn shutdown;
} cliproxy_plugin_api;

extern int cliproxyPluginCall(char*, uint8_t*, size_t, cliproxy_buffer*);
extern void cliproxyPluginFree(void*, size_t);
extern void cliproxyPluginShutdown(void);

static const cliproxy_host_api* stored_host;

static void store_host_api(const cliproxy_host_api* host) {
	stored_host = host;
}

static int call_host_api(const char* method, const uint8_t* request, size_t request_len, cliproxy_buffer* response) {
	if (stored_host == NULL || stored_host->call == NULL) {
		return 1;
	}
	return stored_host->call(stored_host->host_ctx, method, request, request_len, response);
}

static void free_host_buffer(void* ptr, size_t len) {
	if (stored_host != NULL && stored_host->free_buffer != NULL && ptr != NULL) {
		stored_host->free_buffer(ptr, len);
	}
}
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"unsafe"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

const (
	pluginID      = "policy-scheduler"
	pluginVersion = "0.3.1"
)

type envelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *envelopeError  `json:"error,omitempty"`
}

type envelopeError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Retryable  bool   `json:"retryable,omitempty"`
	HTTPStatus int    `json:"http_status,omitempty"`
}

type lifecycleRequest struct {
	ConfigYAML []byte `json:"config_yaml"`
}

type registration struct {
	SchemaVersion uint32                   `json:"schema_version"`
	Metadata      pluginapi.Metadata       `json:"metadata"`
	Capabilities  registrationCapabilities `json:"capabilities"`
}

type registrationCapabilities struct {
	Scheduler     bool `json:"scheduler"`
	ManagementAPI bool `json:"management_api"`
}

var globalEngine = newPolicyEngine(defaultConfig())

func main() {}

//export cliproxy_plugin_init
func cliproxy_plugin_init(host *C.cliproxy_host_api, plugin *C.cliproxy_plugin_api) C.int {
	if plugin == nil || host == nil {
		return 1
	}
	C.store_host_api(host)
	plugin.abi_version = C.uint32_t(pluginabi.ABIVersion)
	plugin.call = C.cliproxy_plugin_call_fn(C.cliproxyPluginCall)
	plugin.free_buffer = C.cliproxy_plugin_free_fn(C.cliproxyPluginFree)
	plugin.shutdown = C.cliproxy_plugin_shutdown_fn(C.cliproxyPluginShutdown)
	return 0
}

//export cliproxyPluginCall
func cliproxyPluginCall(method *C.char, request *C.uint8_t, requestLen C.size_t, response *C.cliproxy_buffer) C.int {
	if response != nil {
		response.ptr = nil
		response.len = 0
	}
	if method == nil {
		writeResponse(response, errorEnvelope(&envelopeError{Code: "invalid_method", Message: "method is required"}))
		return 1
	}
	if requestLen > C.size_t(1<<31-1) {
		writeResponse(response, errorEnvelope(&envelopeError{Code: "request_too_large", Message: "plugin request exceeds supported size"}))
		return 1
	}
	var requestBytes []byte
	if request != nil && requestLen > 0 {
		requestBytes = C.GoBytes(unsafe.Pointer(request), C.int(requestLen))
	}
	raw, err := handleMethod(C.GoString(method), requestBytes)
	if err != nil {
		writeResponse(response, errorEnvelope(&envelopeError{Code: "plugin_error", Message: err.Error()}))
		return 1
	}
	writeResponse(response, raw)
	return 0
}

//export cliproxyPluginFree
func cliproxyPluginFree(ptr unsafe.Pointer, _ C.size_t) {
	if ptr != nil {
		C.free(ptr)
	}
}

//export cliproxyPluginShutdown
func cliproxyPluginShutdown() {
	globalEngine.shutdown()
}

func handleMethod(method string, request []byte) ([]byte, error) {
	switch method {
	case pluginabi.MethodPluginRegister:
		if err := configure(request, false); err != nil {
			return errorEnvelope(&envelopeError{Code: "invalid_config", Message: err.Error()}), nil
		}
		return okEnvelope(pluginRegistration())
	case pluginabi.MethodPluginReconfigure:
		if err := configure(request, true); err != nil {
			return errorEnvelope(&envelopeError{Code: "invalid_config", Message: err.Error()}), nil
		}
		return okEnvelope(pluginRegistration())
	case pluginabi.MethodPluginShutdown:
		cliproxyPluginShutdown()
		return okEnvelope(map[string]any{})
	case pluginabi.MethodSchedulerPick:
		return handleSchedulerPick(globalEngine, request)
	case pluginabi.MethodManagementRegister:
		return okEnvelope(registerManagement())
	case pluginabi.MethodManagementHandle:
		return handleManagement(request)
	default:
		return errorEnvelope(&envelopeError{Code: "unknown_method", Message: "unknown method: " + method}), nil
	}
}

func configure(raw []byte, reconfigure bool) error {
	var req lifecycleRequest
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &req); err != nil {
			return fmt.Errorf("decode lifecycle request: %w", err)
		}
	}
	cfg, err := decodeConfig(req.ConfigYAML)
	if err != nil {
		return err
	}
	if reconfigure {
		globalEngine.reconfigure(cfg)
	} else {
		globalEngine.register(cfg)
	}
	return nil
}

func decodeSchedulerRequest(raw []byte) (pluginapi.SchedulerPickRequest, error) {
	var req pluginapi.SchedulerPickRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return pluginapi.SchedulerPickRequest{}, fmt.Errorf("decode scheduler request: %w", err)
	}
	return req, nil
}

func handleSchedulerPick(engine *policyEngine, request []byte) ([]byte, error) {
	req, err := decodeSchedulerRequest(request)
	if err != nil {
		return errorEnvelope(&envelopeError{Code: "invalid_scheduler_request", Message: "scheduler request is invalid"}), nil
	}
	resp, err := engine.pick(req)
	if err != nil {
		if policyErr, ok := err.(*policyError); ok {
			return errorEnvelope(&envelopeError{Code: policyErr.Code, Message: policyErr.Message, Retryable: policyErr.Retryable, HTTPStatus: policyErr.HTTPStatus}), nil
		}
		return errorEnvelope(&envelopeError{Code: "scheduler_error", Message: "scheduler policy failed", Retryable: true, HTTPStatus: 503}), nil
	}
	return okEnvelope(resp)
}

func pluginRegistration() registration {
	return registration{
		SchemaVersion: pluginabi.SchemaVersion,
		Metadata: pluginapi.Metadata{
			Name:             "Policy and Scheduling",
			Version:          pluginVersion,
			Author:           "thoitiettxl-cyber",
			GitHubRepository: "https://github.com/thoitiettxl-cyber/codex-gauntlet-termux",
			ConfigFields: []pluginapi.ConfigField{
				{Name: "tenant_header", Type: pluginapi.ConfigFieldTypeString, Description: "Inbound header carrying the tenant signal."},
				{Name: "tenant_metadata_key", Type: pluginapi.ConfigFieldTypeString, Description: "Scheduler metadata key carrying the tenant signal when the header is absent."},
				{Name: "tenant_group_attribute", Type: pluginapi.ConfigFieldTypeString, Description: "Safe candidate attribute containing the tenant group tag."},
				{Name: "tenant_groups", Type: pluginapi.ConfigFieldTypeObject, Description: "Map from tenant signal to allowed candidate group."},
				{Name: "deny_unknown_tenant", Type: pluginapi.ConfigFieldTypeBoolean, Description: "Reject tenant signals missing from tenant_groups unless an eligible backup is present."},
				{Name: "quota_reserve_percent", Type: pluginapi.ConfigFieldTypeNumber, Description: "Exclude candidates with a known remaining-percent attribute below this threshold."},
				{Name: "quota_remaining_attribute", Type: pluginapi.ConfigFieldTypeString, Description: "Safe candidate attribute containing quota remaining percent."},
				{Name: "plan_tier_attribute", Type: pluginapi.ConfigFieldTypeString, Description: "Safe candidate attribute containing the plan tier."},
				{Name: "plan_tiers", Type: pluginapi.ConfigFieldTypeArray, Description: "Plan tiers ordered from highest to lowest preference."},
				{Name: "balance_strategy", Type: pluginapi.ConfigFieldTypeEnum, EnumValues: []string{balanceDelegate, balanceLRU, balanceWeighted}, Description: "Delegate equal candidates or balance them with LRU/weight."},
				{Name: "weight_attribute", Type: pluginapi.ConfigFieldTypeString, Description: "Safe positive-integer candidate attribute used by weighted balancing."},
				{Name: "backup_auth_ids", Type: pluginapi.ConfigFieldTypeArray, Description: "Ordered backup AuthIDs; the host must still include a backup in Candidates."},
				{Name: "delegate_builtin", Type: pluginapi.ConfigFieldTypeEnum, EnumValues: []string{pluginapi.SchedulerBuiltinRoundRobin, pluginapi.SchedulerBuiltinFillFirst}, Description: "Built-in scheduler used when policy has no strong decision."},
				{Name: "decision_history_limit", Type: pluginapi.ConfigFieldTypeInteger, Description: "In-memory redacted decision history size (1-200)."},
				{Name: "session_affinity_enabled", Type: pluginapi.ConfigFieldTypeBoolean, Description: "Keep one client/session on an eligible credential for a bounded TTL; disabled by default."},
				{Name: "session_affinity_header", Type: pluginapi.ConfigFieldTypeString, Description: "Request header carrying the affinity signal; its value is HMACed in memory and never exposed. Leave empty to disable header input."},
				{Name: "session_affinity_metadata_key", Type: pluginapi.ConfigFieldTypeString, Description: "Scheduler metadata key carrying a preferred opaque string identity. Leave empty to disable metadata input."},
				{Name: "session_affinity_ttl_seconds", Type: pluginapi.ConfigFieldTypeInteger, Description: "Sliding affinity TTL in seconds (60-86400)."},
				{Name: "session_affinity_max_entries", Type: pluginapi.ConfigFieldTypeInteger, Description: "Maximum in-memory affinity bindings with least-recently-used eviction (1-10000)."},
			},
		},
		Capabilities: registrationCapabilities{Scheduler: true, ManagementAPI: true},
	}
}

func okEnvelope(value any) ([]byte, error) {
	result, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{OK: true, Result: result})
}

func errorEnvelope(err *envelopeError) []byte {
	raw, _ := json.Marshal(envelope{OK: false, Error: err})
	return raw
}

func writeResponse(response *C.cliproxy_buffer, raw []byte) {
	if response == nil || len(raw) == 0 {
		return
	}
	ptr := C.CBytes(raw)
	if ptr == nil {
		return
	}
	response.ptr = ptr
	response.len = C.size_t(len(raw))
}

func callHost(method string, payload any) (json.RawMessage, error) {
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal host callback payload: %w", err)
	}
	cMethod := C.CString(method)
	defer C.free(unsafe.Pointer(cMethod))
	var response C.cliproxy_buffer
	var requestPtr *C.uint8_t
	if len(rawPayload) != 0 {
		allocated := C.CBytes(rawPayload)
		if allocated == nil {
			return nil, fmt.Errorf("allocate host callback payload")
		}
		defer C.free(allocated)
		requestPtr = (*C.uint8_t)(allocated)
	}
	code := C.call_host_api(cMethod, requestPtr, C.size_t(len(rawPayload)), &response)
	var rawResponse []byte
	if response.ptr != nil && response.len > 0 {
		rawResponse = C.GoBytes(response.ptr, C.int(response.len))
	}
	if response.ptr != nil {
		C.free_host_buffer(response.ptr, response.len)
	}
	if code != 0 || len(rawResponse) == 0 {
		return nil, fmt.Errorf("host callback unavailable")
	}
	var env envelope
	if err := json.Unmarshal(rawResponse, &env); err != nil || !env.OK {
		return nil, fmt.Errorf("host callback failed")
	}
	return append(json.RawMessage(nil), env.Result...), nil
}
