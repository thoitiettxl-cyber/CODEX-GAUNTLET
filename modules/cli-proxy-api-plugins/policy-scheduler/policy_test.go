package main

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

func candidate(id, status, tenant, quota, plan string, priority int) pluginapi.SchedulerAuthCandidate {
	return pluginapi.SchedulerAuthCandidate{
		ID:       id,
		Provider: "codex",
		Status:   status,
		Priority: priority,
		Attributes: map[string]string{
			"tenant_group":            tenant,
			"quota_remaining_percent": quota,
			"plan_type":               plan,
		},
	}
}

func TestPolicyChainUsesRequiredOrder(t *testing.T) {
	cfg := defaultConfig()
	cfg.TenantGroups = map[string]string{"tenant-a": "group-a"}
	cfg.QuotaReservePercent = 20
	cfg.PlanTiers = []string{"pro", "free"}
	engine := newPolicyEngine(cfg)
	req := pluginapi.SchedulerPickRequest{
		Provider: "codex",
		Model:    "gpt-5",
		Options: pluginapi.SchedulerOptions{
			Headers: map[string][]string{"X-CPA-Tenant": {"tenant-a"}},
		},
		Candidates: []pluginapi.SchedulerAuthCandidate{
			candidate("disabled", "disabled", "group-a", "90", "pro", 100),
			candidate("wrong-tenant", "active", "group-b", "90", "pro", 100),
			candidate("under-reserve", "active", "group-a", "5", "pro", 100),
			candidate("lower-priority", "active", "group-a", "80", "pro", 10),
			candidate("selected", "active", "group-a", "80", "pro", 100),
		},
	}

	resp, err := engine.pick(req)
	if err != nil {
		t.Fatalf("pick() error = %v", err)
	}
	if resp.AuthID != "selected" || !resp.Handled {
		t.Fatalf("pick() = %#v, want selected", resp)
	}
	decisions := engine.decisionsSnapshot()
	if len(decisions) != 1 {
		t.Fatalf("decision count = %d, want 1", len(decisions))
	}
	got := decisions[0]
	if got.AfterStatus != 4 || got.AfterTenant != 3 || got.AfterQuota != 2 || got.AfterPriority != 1 {
		t.Fatalf("policy stage counts = %d/%d/%d/%d", got.AfterStatus, got.AfterTenant, got.AfterQuota, got.AfterPriority)
	}
	if got.SelectedAlias == "" || got.SelectedAlias == "selected" {
		t.Fatalf("selected alias = %q, want redacted alias", got.SelectedAlias)
	}
}

func TestPolicyFallbackMustRemainInHostCandidates(t *testing.T) {
	cfg := defaultConfig()
	cfg.TenantGroups = map[string]string{"tenant-a": "group-a"}
	cfg.BackupAuthIDs = []string{"backup"}
	engine := newPolicyEngine(cfg)
	req := pluginapi.SchedulerPickRequest{
		Options: pluginapi.SchedulerOptions{Headers: map[string][]string{"X-CPA-Tenant": {"tenant-a"}}},
		Candidates: []pluginapi.SchedulerAuthCandidate{
			candidate("primary", "active", "group-b", "50", "pro", 10),
			candidate("backup", "active", "group-c", "50", "free", 1),
		},
	}
	resp, err := engine.pick(req)
	if err != nil || resp.AuthID != "backup" {
		t.Fatalf("pick() = %#v, %v; want candidate backup", resp, err)
	}

	engine = newPolicyEngine(cfg)
	req.Candidates = req.Candidates[:1]
	_, err = engine.pick(req)
	var policyErr *policyError
	if !errors.As(err, &policyErr) || policyErr.Code != "scheduler_no_eligible_candidate" {
		t.Fatalf("pick() error = %#v, want explicit no-eligible error", err)
	}
}

func TestPolicyAllCandidatesFailExplicitly(t *testing.T) {
	engine := newPolicyEngine(defaultConfig())
	_, err := engine.pick(pluginapi.SchedulerPickRequest{Candidates: []pluginapi.SchedulerAuthCandidate{
		candidate("disabled", "disabled", "", "", "", 0),
		candidate("cooldown", "cooldown", "", "", "", 0),
	}})
	var policyErr *policyError
	if !errors.As(err, &policyErr) {
		t.Fatalf("pick() error = %v, want policyError", err)
	}
	if !policyErr.Retryable || policyErr.HTTPStatus != 503 || policyErr.Code != "scheduler_no_eligible_candidate" {
		t.Fatalf("policy error = %#v", policyErr)
	}
}

func TestPolicyDelegatesWhenCandidatesAreEquivalent(t *testing.T) {
	cfg := defaultConfig()
	cfg.DelegateBuiltin = pluginapi.SchedulerBuiltinFillFirst
	engine := newPolicyEngine(cfg)
	resp, err := engine.pick(pluginapi.SchedulerPickRequest{Candidates: []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}})
	if err != nil || resp.AuthID != "" || resp.DelegateBuiltin != pluginapi.SchedulerBuiltinFillFirst || !resp.Handled {
		t.Fatalf("pick() = %#v, %v; want fill-first delegate", resp, err)
	}
}

func TestPolicyLeastRecentlyUsedBalancesSameTier(t *testing.T) {
	cfg := defaultConfig()
	cfg.BalanceStrategy = balanceLRU
	engine := newPolicyEngine(cfg)
	req := pluginapi.SchedulerPickRequest{Candidates: []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}}
	first, errFirst := engine.pick(req)
	second, errSecond := engine.pick(req)
	if errFirst != nil || errSecond != nil || first.AuthID != "a" || second.AuthID != "b" {
		t.Fatalf("LRU picks = %q/%q, errors %v/%v", first.AuthID, second.AuthID, errFirst, errSecond)
	}
}

func TestPolicyWeightedBalancesByAttribute(t *testing.T) {
	cfg := defaultConfig()
	cfg.BalanceStrategy = balanceWeighted
	engine := newPolicyEngine(cfg)
	a := candidate("a", "active", "", "", "", 0)
	b := candidate("b", "active", "", "", "", 0)
	a.Attributes["weight"] = "3"
	b.Attributes["weight"] = "1"
	counts := map[string]int{}
	for range 8 {
		resp, err := engine.pick(pluginapi.SchedulerPickRequest{Candidates: []pluginapi.SchedulerAuthCandidate{a, b}})
		if err != nil {
			t.Fatalf("weighted pick error = %v", err)
		}
		counts[resp.AuthID]++
	}
	if counts["a"] != 6 || counts["b"] != 2 {
		t.Fatalf("weighted counts = %#v, want 6/2", counts)
	}
}

func TestPolicyPlanTierBreaksPriorityTie(t *testing.T) {
	cfg := defaultConfig()
	cfg.PlanTiers = []string{"team", "plus", "free"}
	engine := newPolicyEngine(cfg)
	resp, err := engine.pick(pluginapi.SchedulerPickRequest{Candidates: []pluginapi.SchedulerAuthCandidate{
		candidate("free", "active", "", "", "free", 10),
		candidate("team", "active", "", "", "team", 10),
	}})
	if err != nil || resp.AuthID != "team" {
		t.Fatalf("pick() = %#v, %v; want team", resp, err)
	}
}

func TestDecodeConfigRejectsUnsafeValues(t *testing.T) {
	for _, raw := range []string{
		"quota_reserve_percent: 101\n",
		"quota_reserve_percent: -1\n",
		"balance_strategy: random\n",
		"delegate_builtin: arbitrary\n",
		"session_affinity_ttl_seconds: 59\n",
		"session_affinity_ttl_seconds: 86401\n",
		"session_affinity_max_entries: 10001\n",
		"session_affinity_enabled: true\nsession_affinity_header: ''\nsession_affinity_metadata_key: ''\n",
		"session_affinity_header: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'\n",
	} {
		if _, err := decodeConfig([]byte(raw)); err == nil {
			t.Fatalf("decodeConfig(%q) succeeded, want error", raw)
		}
	}
}

func TestSessionAffinityAcceptsOnlyBoundedStringSignals(t *testing.T) {
	cfg := defaultConfig()
	req := pluginapi.SchedulerPickRequest{Options: pluginapi.SchedulerOptions{
		Headers:  map[string][]string{"Authorization": {"header-fallback"}},
		Metadata: map[string]any{"api_key_id": map[string]any{"nested": "not-accepted"}},
	}}
	if got := sessionAffinitySignal(req, cfg); got != "header\x00header-fallback" {
		t.Fatalf("signal with object metadata = %q, want bounded header fallback", got)
	}
	req.Options.Metadata["api_key_id"] = strings.Repeat("x", 4097)
	if got := sessionAffinitySignal(req, cfg); got != "header\x00header-fallback" {
		t.Fatalf("signal with oversized metadata = %q, want bounded header fallback", got)
	}
	req.Options.Metadata["api_key_id"] = "metadata-preferred"
	if got := sessionAffinitySignal(req, cfg); got != "metadata\x00metadata-preferred" {
		t.Fatalf("string metadata signal = %q", got)
	}

	decoded, err := decodeConfig([]byte("session_affinity_enabled: true\nsession_affinity_header: ''\n"))
	if err != nil || decoded.SessionAffinityHeader != "" {
		t.Fatalf("metadata-only config = %#v, %v", decoded, err)
	}
}

func TestSessionAffinitySticksBySignalAndSeparatesClients(t *testing.T) {
	cfg := defaultConfig()
	cfg.SessionAffinityEnabled = true
	cfg.BalanceStrategy = balanceLRU
	engine := newPolicyEngine(cfg)
	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	engine.now = func() time.Time { return now }
	candidates := []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}
	request := func(signal string) pluginapi.SchedulerPickRequest {
		return pluginapi.SchedulerPickRequest{
			Provider:   "codex",
			Options:    pluginapi.SchedulerOptions{Metadata: map[string]any{"api_key_id": signal}},
			Candidates: candidates,
		}
	}

	first, errFirst := engine.pick(request("client-one"))
	second, errSecond := engine.pick(request("client-one"))
	other, errOther := engine.pick(request("client-two"))
	if errFirst != nil || errSecond != nil || errOther != nil {
		t.Fatalf("affinity picks returned errors: %v/%v/%v", errFirst, errSecond, errOther)
	}
	if first.AuthID != "a" || second.AuthID != "a" || other.AuthID != "b" {
		t.Fatalf("affinity picks = %q/%q/%q, want a/a/b", first.AuthID, second.AuthID, other.AuthID)
	}
	decisions := engine.decisionsSnapshot()
	if decisions[0].AffinityOutcome != "new" || decisions[1].AffinityOutcome != "hit" || decisions[2].AffinityOutcome != "new" {
		t.Fatalf("affinity outcomes = %q/%q/%q", decisions[0].AffinityOutcome, decisions[1].AffinityOutcome, decisions[2].AffinityOutcome)
	}
}

func TestSessionAffinityExpiresAndFailsOverFromUnavailableCredential(t *testing.T) {
	cfg := defaultConfig()
	cfg.SessionAffinityEnabled = true
	cfg.SessionAffinityTTL = 60
	cfg.BalanceStrategy = balanceLRU
	engine := newPolicyEngine(cfg)
	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	engine.now = func() time.Time { return now }
	all := []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}
	req := pluginapi.SchedulerPickRequest{
		Provider:   "codex",
		Options:    pluginapi.SchedulerOptions{Headers: map[string][]string{"authorization": {"Bearer client-secret"}}},
		Candidates: all,
	}
	first, err := engine.pick(req)
	if err != nil || first.AuthID != "a" {
		t.Fatalf("initial affinity pick = %#v, %v", first, err)
	}

	req.Candidates = all[1:]
	failover, err := engine.pick(req)
	if err != nil || failover.AuthID != "b" {
		t.Fatalf("failover affinity pick = %#v, %v", failover, err)
	}
	decisions := engine.decisionsSnapshot()
	if decisions[len(decisions)-1].AffinityOutcome != "failover" {
		t.Fatalf("failover outcome = %q", decisions[len(decisions)-1].AffinityOutcome)
	}

	now = now.Add(61 * time.Second)
	req.Candidates = all
	afterExpiry, err := engine.pick(req)
	if err != nil || afterExpiry.AuthID != "a" {
		t.Fatalf("post-expiry affinity pick = %#v, %v; want LRU a", afterExpiry, err)
	}
}

func TestSessionAffinityCacheIsBoundedAndNeverExposesSignal(t *testing.T) {
	cfg := defaultConfig()
	cfg.SessionAffinityEnabled = true
	cfg.SessionAffinityMax = 1
	engine := newPolicyEngine(cfg)
	candidates := []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}
	const secretSignal = "Bearer must-not-appear"
	for _, signal := range []string{secretSignal, "second-client"} {
		_, err := engine.pick(pluginapi.SchedulerPickRequest{
			Provider:   "codex",
			Options:    pluginapi.SchedulerOptions{Headers: map[string][]string{"Authorization": {signal}}},
			Candidates: candidates,
		})
		if err != nil {
			t.Fatalf("affinity pick error = %v", err)
		}
	}
	active, ready := engine.affinityStateSnapshot()
	if !ready || active != 1 {
		t.Fatalf("affinity state = active:%d ready:%v, want 1/true", active, ready)
	}
	raw, err := json.Marshal(engine.decisionsSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secretSignal) {
		t.Fatalf("decision history exposed raw affinity signal: %s", raw)
	}
	for cacheKey := range engine.affinity {
		if strings.Contains(cacheKey, secretSignal) {
			t.Fatal("affinity cache key contains the raw signal")
		}
	}
}

func TestSessionAffinityFailsClosedWithoutHMACKeyAndClearsOnReconfigure(t *testing.T) {
	cfg := defaultConfig()
	cfg.SessionAffinityEnabled = true
	engine := newPolicyEngine(cfg)
	req := pluginapi.SchedulerPickRequest{
		Options:    pluginapi.SchedulerOptions{Metadata: map[string]any{"api_key_id": "client"}},
		Candidates: []pluginapi.SchedulerAuthCandidate{candidate("a", "active", "", "", "", 0)},
	}
	if _, err := engine.pick(req); err != nil {
		t.Fatalf("initial affinity pick error = %v", err)
	}
	if active, _ := engine.affinityStateSnapshot(); active != 1 {
		t.Fatalf("active bindings = %d, want 1", active)
	}

	changed := cfg
	changed.SessionAffinityTTL++
	engine.reconfigure(changed)
	if active, _ := engine.affinityStateSnapshot(); active != 0 {
		t.Fatalf("bindings after affinity reconfigure = %d, want 0", active)
	}
	engine.affinityReady = false
	_, err := engine.pick(req)
	var policyErr *policyError
	if !errors.As(err, &policyErr) || !strings.Contains(policyErr.Message, "key is unavailable") {
		t.Fatalf("pick without affinity key error = %#v", err)
	}
}

func TestSessionAffinityDelegatePreservesBuiltinStrategy(t *testing.T) {
	candidates := []pluginapi.SchedulerAuthCandidate{
		candidate("b", "active", "", "", "", 0),
		candidate("a", "active", "", "", "", 0),
	}
	request := func(model, signal string) pluginapi.SchedulerPickRequest {
		return pluginapi.SchedulerPickRequest{
			Provider:   "codex",
			Model:      model,
			Options:    pluginapi.SchedulerOptions{Metadata: map[string]any{"api_key_id": signal}},
			Candidates: candidates,
		}
	}

	t.Run("fill-first", func(t *testing.T) {
		cfg := defaultConfig()
		cfg.SessionAffinityEnabled = true
		cfg.DelegateBuiltin = pluginapi.SchedulerBuiltinFillFirst
		engine := newPolicyEngine(cfg)
		for _, signal := range []string{"client-one", "client-two"} {
			resp, err := engine.pick(request("model-a", signal))
			if err != nil || resp.AuthID != "a" {
				t.Fatalf("fill-first affinity pick for %q = %#v, %v; want a", signal, resp, err)
			}
		}
	})

	t.Run("round-robin-is-model-scoped", func(t *testing.T) {
		cfg := defaultConfig()
		cfg.SessionAffinityEnabled = true
		cfg.DelegateBuiltin = pluginapi.SchedulerBuiltinRoundRobin
		engine := newPolicyEngine(cfg)
		for _, test := range []struct {
			model  string
			signal string
			want   string
		}{
			{model: "model-a", signal: "a-one", want: "a"},
			{model: "model-a", signal: "a-two", want: "b"},
			{model: "model-b", signal: "b-one", want: "a"},
			{model: "model-a", signal: "a-one", want: "a"},
			{model: "model-a", signal: "a-three", want: "a"},
		} {
			resp, err := engine.pick(request(test.model, test.signal))
			if err != nil || resp.AuthID != test.want {
				t.Fatalf("round-robin affinity pick %s/%s = %#v, %v; want %s", test.model, test.signal, resp, err, test.want)
			}
		}
	})
}

func TestSessionAffinityAndBalancingAreScopedByRoute(t *testing.T) {
	candidates := []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}
	baseRequest := pluginapi.SchedulerPickRequest{
		Provider:   "codex",
		Options:    pluginapi.SchedulerOptions{Metadata: map[string]any{"api_key_id": "same-session"}},
		Candidates: candidates,
	}
	cfg := defaultConfig()
	engine := newPolicyEngine(cfg)
	signal := sessionAffinitySignal(baseRequest, cfg)
	modelA := baseRequest
	modelA.Model = "model-a"
	modelB := baseRequest
	modelB.Model = "model-b"
	if keyA, keyB := engine.sessionAffinityKey(modelA, "tenant", signal), engine.sessionAffinityKey(modelB, "tenant", signal); keyA == keyB {
		t.Fatal("affinity keys for different models must be isolated")
	}

	for _, strategy := range []string{balanceLRU, balanceWeighted} {
		t.Run(strategy, func(t *testing.T) {
			cfg := defaultConfig()
			cfg.BalanceStrategy = strategy
			engine := newPolicyEngine(cfg)
			for _, model := range []string{"model-a", "model-b"} {
				resp, err := engine.pick(pluginapi.SchedulerPickRequest{Provider: "codex", Model: model, Candidates: candidates})
				if err != nil || resp.AuthID != "a" {
					t.Fatalf("first %s pick for %s = %#v, %v; want a", strategy, model, resp, err)
				}
			}
		})
	}
}

func TestBalanceReconfigureClearsSelectionState(t *testing.T) {
	cfg := defaultConfig()
	cfg.SessionAffinityEnabled = true
	engine := newPolicyEngine(cfg)
	for _, signal := range []string{"client-one", "client-two"} {
		_, err := engine.pick(pluginapi.SchedulerPickRequest{
			Provider:   "codex",
			Model:      "model-a",
			Options:    pluginapi.SchedulerOptions{Metadata: map[string]any{"api_key_id": signal}},
			Candidates: []pluginapi.SchedulerAuthCandidate{candidate("a", "active", "", "", "", 0), candidate("b", "active", "", "", "", 0)},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(engine.rotationCursors) == 0 {
		t.Fatal("round-robin affinity picks recorded no route cursor")
	}
	changed := cfg
	changed.DelegateBuiltin = pluginapi.SchedulerBuiltinFillFirst
	engine.reconfigure(changed)
	if len(engine.rotationCursors) != 0 || len(engine.lastPicked) != 0 || len(engine.weightedCurrent) != 0 || len(engine.selectionRoutes) != 0 {
		t.Fatal("balance strategy reconfigure retained selection state")
	}
}

func TestPolicyEngineSupportsConcurrentPickReconfigureAndRead(t *testing.T) {
	engine := newPolicyEngine(defaultConfig())
	req := pluginapi.SchedulerPickRequest{Candidates: []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}}
	var wait sync.WaitGroup
	for index := range 60 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			switch index % 3 {
			case 0:
				_, _ = engine.pick(req)
			case 1:
				cfg := defaultConfig()
				cfg.BalanceStrategy = balanceLRU
				engine.reconfigure(cfg)
			default:
				_ = engine.configSnapshot()
				_ = engine.decisionsSnapshot()
				_ = engine.observabilitySnapshot()
			}
		}()
	}
	wait.Wait()
	if len(engine.decisionsSnapshot()) == 0 {
		t.Fatal("concurrent picks recorded no decisions")
	}
}
