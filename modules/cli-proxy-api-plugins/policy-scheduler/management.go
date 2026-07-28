package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginabi"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

const (
	managementStatusPath  = "/policy-scheduler/status"
	resourceDashboardPath = "/dashboard"
	resourceScriptPath    = "/dashboard.js"
)

type credentialAliaser struct {
	mu   sync.Mutex
	key  []byte
	seen map[string]string
	next uint64
}

func newCredentialAliaser() *credentialAliaser {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		key = nil
	}
	return &credentialAliaser{key: key, seen: make(map[string]string)}
}

func (aliaser *credentialAliaser) Alias(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	aliaser.mu.Lock()
	defer aliaser.mu.Unlock()
	if alias := aliaser.seen[value]; alias != "" {
		return alias
	}
	var alias string
	if len(aliaser.key) == 32 {
		digest := hmac.New(sha256.New, aliaser.key)
		_, _ = digest.Write([]byte(value))
		alias = "credential-" + hex.EncodeToString(digest.Sum(nil)[:6])
	} else {
		// crypto/rand failure must not downgrade to a predictable hash of the raw
		// identifier. A process-local sequence preserves redaction and uniqueness.
		aliaser.next++
		alias = "credential-redacted-" + strconv.FormatUint(aliaser.next, 10)
	}
	aliaser.seen[value] = alias
	return alias
}

type managementRegistration struct {
	Routes    []managementRoute `json:"routes,omitempty"`
	Resources []resourceRoute   `json:"resources,omitempty"`
}

type managementRoute struct {
	Method      string `json:"Method"`
	Path        string `json:"Path"`
	Menu        string `json:"Menu,omitempty"`
	Description string `json:"Description,omitempty"`
}

type resourceRoute struct {
	Path        string `json:"Path"`
	Menu        string `json:"Menu"`
	Description string `json:"Description"`
}

type managementRequest struct {
	Method string
	Path   string
	Body   []byte
}

type managementResponse struct {
	StatusCode int         `json:"StatusCode"`
	Headers    http.Header `json:"Headers"`
	Body       []byte      `json:"Body"`
}

type authListResponse struct {
	Files []pluginapi.HostAuthFileEntry `json:"files"`
}

type credentialView struct {
	Alias          string `json:"alias"`
	Provider       string `json:"provider,omitempty"`
	Status         string `json:"status,omitempty"`
	Disabled       bool   `json:"disabled"`
	Unavailable    bool   `json:"unavailable"`
	RuntimeOnly    bool   `json:"runtime_only"`
	Source         string `json:"source,omitempty"`
	Priority       int    `json:"priority"`
	AccountType    string `json:"account_type,omitempty"`
	Success        int64  `json:"success"`
	Failed         int64  `json:"failed"`
	NextRetryAfter string `json:"next_retry_after,omitempty"`
}

type configView struct {
	TenantHeader            string            `json:"tenant_header"`
	TenantMetadataKey       string            `json:"tenant_metadata_key"`
	TenantGroupAttribute    string            `json:"tenant_group_attribute"`
	TenantGroups            map[string]string `json:"tenant_groups"`
	DenyUnknownTenant       bool              `json:"deny_unknown_tenant"`
	QuotaReservePercent     float64           `json:"quota_reserve_percent"`
	QuotaRemainingAttribute string            `json:"quota_remaining_attribute"`
	PlanTierAttribute       string            `json:"plan_tier_attribute"`
	PlanTiers               []string          `json:"plan_tiers"`
	BalanceStrategy         string            `json:"balance_strategy"`
	WeightAttribute         string            `json:"weight_attribute"`
	BackupCount             int               `json:"backup_count"`
	DelegateBuiltin         string            `json:"delegate_builtin"`
	SessionAffinityEnabled  bool              `json:"session_affinity_enabled"`
	SessionAffinityHeader   string            `json:"session_affinity_header"`
	SessionAffinityMetadata string            `json:"session_affinity_metadata_key"`
	SessionAffinityTTL      int               `json:"session_affinity_ttl_seconds"`
	SessionAffinityMax      int               `json:"session_affinity_max_entries"`
}

type affinityView struct {
	ActiveBindings int  `json:"active_bindings"`
	KeyAvailable   bool `json:"key_available"`
}

type statusResponse struct {
	Plugin                  string           `json:"plugin"`
	Version                 string           `json:"version"`
	HostContractLimitations []string         `json:"host_contract_limitations"`
	Config                  configView       `json:"config"`
	Credentials             []credentialView `json:"credentials"`
	Decisions               []policyDecision `json:"decisions"`
	Affinity                affinityView     `json:"affinity"`
	HostStateAvailable      bool             `json:"host_state_available"`
	HostStateError          string           `json:"host_state_error,omitempty"`
}

var hostCall = callHost

func registerManagement() managementRegistration {
	return managementRegistration{
		Routes: []managementRoute{{
			Method:      http.MethodGet,
			Path:        managementStatusPath,
			Description: "Read-only redacted scheduler and credential runtime status.",
		}},
		Resources: []resourceRoute{{
			Path:        resourceDashboardPath,
			Menu:        "Policy Scheduler",
			Description: "Read-only policy, credential runtime, and recent decision dashboard.",
		}, {
			Path:        resourceScriptPath,
			Description: "Self-hosted Policy Scheduler dashboard JavaScript.",
		}},
	}
}

func handleManagement(raw []byte) ([]byte, error) {
	var req managementRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("decode management request: %w", err)
	}
	if strings.HasSuffix(req.Path, resourceDashboardPath) {
		return okEnvelope(managementResponse{
			StatusCode: http.StatusOK,
			Headers: http.Header{
				"Content-Type":            []string{"text/html; charset=utf-8"},
				"Content-Security-Policy": []string{"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; object-src 'none'"},
				"Referrer-Policy":         []string{"no-referrer"},
				"X-Content-Type-Options":  []string{"nosniff"},
				"X-Frame-Options":         []string{"SAMEORIGIN"},
				"Permissions-Policy":      []string{"camera=(), microphone=(), geolocation=()"},
				"Cache-Control":           []string{"no-store"},
			},
			Body: []byte(dashboardHTML),
		})
	}
	if strings.HasSuffix(req.Path, resourceScriptPath) {
		return okEnvelope(managementResponse{
			StatusCode: http.StatusOK,
			Headers: http.Header{
				"Content-Type":           []string{"text/javascript; charset=utf-8"},
				"X-Content-Type-Options": []string{"nosniff"},
				"Cache-Control":          []string{"no-store"},
			},
			Body: []byte(dashboardJS),
		})
	}
	if req.Path != "/v0/management"+managementStatusPath {
		return okEnvelope(managementResponse{StatusCode: http.StatusNotFound, Body: []byte(`{"error":"not found"}`)})
	}
	status := buildStatusResponse(globalEngine)
	body, err := json.Marshal(status)
	if err != nil {
		return nil, fmt.Errorf("encode status response: %w", err)
	}
	return okEnvelope(managementResponse{
		StatusCode: http.StatusOK,
		Headers: http.Header{
			"Content-Type":  []string{"application/json; charset=utf-8"},
			"Cache-Control": []string{"no-store"},
		},
		Body: body,
	})
}

func buildStatusResponse(engine *policyEngine) statusResponse {
	cfg := engine.configSnapshot()
	affinityBindings, affinityKeyAvailable := engine.affinityStateSnapshot()
	credentials, err := collectCredentialViews(engine.aliaser)
	status := statusResponse{
		Plugin:  pluginID,
		Version: pluginVersion,
		HostContractLimitations: []string{
			"CLIProxyAPI filters cooldown/disabled credentials and lower priority tiers before scheduler.pick.",
			"scheduler.pick can select only an AuthID present in Candidates; lower-tier backups are not reachable.",
			"CLIProxyAPI 7.2.103 does not populate Candidates.Metadata; quota and tenant policy require safe candidate Attributes.",
		},
		Config: configView{
			TenantHeader:            cfg.TenantHeader,
			TenantMetadataKey:       cfg.TenantMetadataKey,
			TenantGroupAttribute:    cfg.TenantGroupAttribute,
			TenantGroups:            cleanStringMap(cfg.TenantGroups),
			DenyUnknownTenant:       cfg.DenyUnknownTenant,
			QuotaReservePercent:     cfg.QuotaReservePercent,
			QuotaRemainingAttribute: cfg.QuotaRemainingAttribute,
			PlanTierAttribute:       cfg.PlanTierAttribute,
			PlanTiers:               append([]string(nil), cfg.PlanTiers...),
			BalanceStrategy:         cfg.BalanceStrategy,
			WeightAttribute:         cfg.WeightAttribute,
			BackupCount:             len(cfg.BackupAuthIDs),
			DelegateBuiltin:         cfg.DelegateBuiltin,
			SessionAffinityEnabled:  cfg.SessionAffinityEnabled,
			SessionAffinityHeader:   cfg.SessionAffinityHeader,
			SessionAffinityMetadata: cfg.SessionAffinityMetadata,
			SessionAffinityTTL:      cfg.SessionAffinityTTL,
			SessionAffinityMax:      cfg.SessionAffinityMax,
		},
		Credentials: credentials,
		Decisions:   engine.decisionsSnapshot(),
		Affinity: affinityView{
			ActiveBindings: affinityBindings,
			KeyAvailable:   affinityKeyAvailable,
		},
	}
	status.HostStateAvailable = err == nil
	if err != nil {
		status.HostStateError = "host credential runtime callbacks are unavailable"
	}
	return status
}

func collectCredentialViews(aliaser *credentialAliaser) ([]credentialView, error) {
	result, err := hostCall(pluginabi.MethodHostAuthList, map[string]any{})
	if err != nil {
		return nil, err
	}
	var list authListResponse
	if err := json.Unmarshal(result, &list); err != nil {
		return nil, fmt.Errorf("decode host.auth.list result: %w", err)
	}
	if len(list.Files) > 100 {
		list.Files = list.Files[:100]
	}
	views := make([]credentialView, 0, len(list.Files))
	for _, entry := range list.Files {
		current := entry
		if strings.TrimSpace(entry.AuthIndex) != "" {
			runtimeResult, runtimeErr := hostCall(pluginabi.MethodHostAuthGetRuntime, pluginapi.HostAuthGetRequest{AuthIndex: entry.AuthIndex})
			if runtimeErr == nil {
				var runtime pluginapi.HostAuthGetRuntimeResponse
				if json.Unmarshal(runtimeResult, &runtime) == nil {
					current = runtime.Auth
				}
			}
		}
		identity := firstNonEmpty(current.ID, current.AuthIndex)
		view := credentialView{
			Alias:       aliaser.Alias(identity),
			Provider:    strings.TrimSpace(current.Provider),
			Status:      strings.TrimSpace(current.Status),
			Disabled:    current.Disabled,
			Unavailable: current.Unavailable,
			RuntimeOnly: current.RuntimeOnly,
			Source:      strings.TrimSpace(current.Source),
			Priority:    current.Priority,
			AccountType: strings.TrimSpace(current.AccountType),
			Success:     current.Success,
			Failed:      current.Failed,
		}
		if !current.NextRetryAfter.IsZero() {
			view.NextRetryAfter = current.NextRetryAfter.UTC().Format(time.RFC3339)
		}
		views = append(views, view)
	}
	return views, nil
}

const dashboardHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CLIProxyAPI Policy Scheduler</title><style>
:root{color-scheme:dark;background:#07111f;color:#dce8f7;font:15px system-ui,sans-serif}body{margin:0}main{max-width:1100px;margin:auto;padding:28px}h1{margin:.2rem 0}p{line-height:1.5}.warning{border:1px solid #f0a43c;background:#2b1d0b;padding:12px;border-radius:10px}.bar{display:flex;gap:8px;margin:18px 0}input{flex:1;padding:10px;border-radius:8px;border:1px solid #496078;background:#0c1b2d;color:#fff}button{padding:10px 16px;border:0;border-radius:8px;background:#4ca3ff;color:#04101e;font-weight:700}pre{white-space:pre-wrap;overflow:auto;background:#0c1b2d;border:1px solid #263d56;padding:16px;border-radius:10px}</style></head>
<body><main><h1>Policy Scheduler</h1><p class="warning"><strong>Trusted in-process admin code:</strong> a CLIProxyAPI resource page is same-origin with Management Center and could read a management key stored in localStorage. This page never reads or writes localStorage and keeps the supplied key only in this page's memory, but installing/enabling the plugin still grants admin-equivalent trust.</p>
<p>Enter the management key to load the authenticated, redacted status endpoint. Raw credential JSON, tokens, paths, names, email, and account identifiers are never returned.</p>
<div class="bar"><input id="key" type="password" autocomplete="off" placeholder="Management key"><button id="load" type="button">Load status</button></div><pre id="output">Not loaded.</pre>
<script src="./dashboard.js" defer></script></main></body></html>`

const dashboardJS = `(()=>{'use strict';const key=document.getElementById('key'),out=document.getElementById('output'),load=document.getElementById('load');load.addEventListener('click',async()=>{out.textContent='Loading…';try{const r=await fetch('/v0/management/policy-scheduler/status',{headers:{'X-Management-Key':key.value},cache:'no-store'});const text=await r.text();if(!r.ok)throw new Error('HTTP '+r.status);out.textContent=JSON.stringify(JSON.parse(text),null,2)}catch(e){out.textContent=String(e)}})})();`
