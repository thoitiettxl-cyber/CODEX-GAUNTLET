package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

func TestObservabilityTracksLifecycleStrategiesAffinityAndState(t *testing.T) {
	cfg := defaultConfig()
	cfg.BalanceStrategy = balanceLRU
	cfg.SessionAffinityEnabled = true
	cfg.SessionAffinityHeader = "Session_id"
	cfg.SessionAffinityMetadata = ""
	cfg.SessionAffinityTTL = 60
	cfg.SessionAffinityMax = 1
	engine := newPolicyEngine(defaultConfig())
	engine.register(cfg)

	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	engine.now = func() time.Time { return now }
	request := pluginapi.SchedulerPickRequest{
		Provider: "codex",
		Model:    "gpt-5",
		Options:  pluginapi.SchedulerOptions{Headers: map[string][]string{"Session_id": {"client-one"}}},
		Candidates: []pluginapi.SchedulerAuthCandidate{
			candidate("a", "active", "", "", "", 0),
			candidate("b", "active", "", "", "", 0),
		},
	}
	for range 2 {
		if _, err := engine.pick(request); err != nil {
			t.Fatal(err)
		}
	}
	request.Candidates = request.Candidates[1:]
	if _, err := engine.pick(request); err != nil {
		t.Fatal(err)
	}
	request.Options.Headers["Session_id"] = []string{"client-two"}
	request.Candidates = []pluginapi.SchedulerAuthCandidate{
		candidate("a", "active", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}
	if _, err := engine.pick(request); err != nil {
		t.Fatal(err)
	}

	now = now.Add(61 * time.Second)
	_ = engine.observabilitySnapshot()
	request.Options.Headers = nil
	request.Candidates = []pluginapi.SchedulerAuthCandidate{
		candidate("cooling", "cooldown", "", "", "", 0),
		candidate("b", "active", "", "", "", 0),
	}
	if _, err := engine.pick(request); err != nil {
		t.Fatal(err)
	}

	view := engine.observabilitySnapshot()
	if view.Generation != 1 || view.RegisterCount != 1 || view.ReconfigureCount != 0 {
		t.Fatalf("lifecycle counters = generation:%d register:%d reconfigure:%d", view.Generation, view.RegisterCount, view.ReconfigureCount)
	}
	if view.PickTotal != 5 || view.CurrentGenerationPicks != 5 || view.CooldownCandidatesExcluded != 1 {
		t.Fatalf("pick counters = total:%d generation:%d cooldown:%d", view.PickTotal, view.CurrentGenerationPicks, view.CooldownCandidatesExcluded)
	}
	wantStrategies := map[string]uint64{
		"session_affinity_new":      2,
		"session_affinity_hit":      1,
		"session_affinity_failover": 1,
		"least_recently_used":       1,
	}
	for strategy, want := range wantStrategies {
		if got := view.PicksByStrategy[strategy]; got != want {
			t.Fatalf("strategy %s = %d, want %d; all=%#v", strategy, got, want, view.PicksByStrategy)
		}
	}
	if view.AffinityEvents.New != 2 || view.AffinityEvents.Hit != 1 || view.AffinityEvents.Failover != 1 || view.AffinityEvents.Expiries != 1 || view.AffinityEvents.Evictions != 1 {
		t.Fatalf("affinity events = %#v", view.AffinityEvents)
	}
	if view.StateSize.RouteScopes != 1 || view.StateSize.LRUEntries != 2 || view.StateSize.AffinityBindings != 0 {
		t.Fatalf("state size = %#v", view.StateSize)
	}
	if len(view.StateByProviderModel) != 1 || view.StateByProviderModel[0].Provider != "codex" || view.StateByProviderModel[0].Model != "gpt-5" {
		t.Fatalf("route state = %#v", view.StateByProviderModel)
	}

	engine.reconfigure(cfg)
	view = engine.observabilitySnapshot()
	if view.Generation != 2 || view.ReconfigureCount != 1 || view.CurrentGenerationPicks != 0 || view.EffectivenessEvaluation != "awaiting_scheduler_traffic" {
		t.Fatalf("post-reconfigure observability = %#v", view)
	}
	engine.shutdown()
	view = engine.observabilitySnapshot()
	if view.Generation != 0 || view.PickTotal != 0 || len(view.PicksByStrategy) != 0 {
		t.Fatalf("shutdown retained metrics = %#v", view)
	}
}

func TestObservabilityReportsConfiguredButIneffectivePolicies(t *testing.T) {
	cfg := defaultConfig()
	cfg.TenantGroups = map[string]string{"tenant-a": "group-a"}
	cfg.QuotaReservePercent = 20
	cfg.PlanTiers = []string{"pro"}
	cfg.BalanceStrategy = balanceWeighted
	cfg.BackupAuthIDs = []string{"backup"}
	cfg.SessionAffinityEnabled = true
	cfg.SessionAffinityHeader = "Session_id"
	cfg.SessionAffinityMetadata = ""
	engine := newPolicyEngine(defaultConfig())
	engine.register(cfg)

	request := pluginapi.SchedulerPickRequest{
		Provider:   "codex",
		Model:      "gpt-5",
		Candidates: []pluginapi.SchedulerAuthCandidate{candidate("primary", "active", "", "", "", 0)},
	}
	if _, err := engine.pick(request); err != nil {
		t.Fatal(err)
	}
	view := engine.observabilitySnapshot()
	wantFields := []string{"tenant_policy", "quota_remaining_attribute", "plan_tier_attribute", "weight_attribute", "backup_auth_ids", "session_affinity"}
	for _, field := range wantFields {
		found := false
		for _, issue := range view.ConfiguredButIneffective {
			found = found || issue.Field == field
		}
		if !found {
			t.Fatalf("missing ineffective field %q in %#v", field, view.ConfiguredButIneffective)
		}
	}

	backup := candidate("backup", "active", "group-a", "80", "pro", 0)
	backup.Attributes["weight"] = "2"
	request.Options.Headers = map[string][]string{
		"X-CPA-Tenant": {"tenant-a"},
		"Session_id":   {"client-one"},
	}
	request.Candidates = []pluginapi.SchedulerAuthCandidate{backup}
	if _, err := engine.pick(request); err != nil {
		t.Fatal(err)
	}
	view = engine.observabilitySnapshot()
	if len(view.ConfiguredButIneffective) != 0 {
		t.Fatalf("effective policies remained flagged: %#v", view.ConfiguredButIneffective)
	}
}

func TestObservabilityProjectionDoesNotExposeAuthIDsOrAffinityDigests(t *testing.T) {
	cfg := defaultConfig()
	cfg.BalanceStrategy = balanceLRU
	cfg.SessionAffinityEnabled = true
	engine := newPolicyEngine(cfg)
	_, err := engine.pick(pluginapi.SchedulerPickRequest{
		Provider:   "codex",
		Model:      "gpt-5",
		Options:    pluginapi.SchedulerOptions{Metadata: map[string]any{"api_key_id": "raw-session-signal"}},
		Candidates: []pluginapi.SchedulerAuthCandidate{candidate("raw-auth-id\x00secret", "active", "", "", "", 0)},
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(engine.observabilitySnapshot())
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"raw-auth-id", "secret", "raw-session-signal"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("observability leaked %q: %s", forbidden, raw)
		}
	}
}

func TestObservabilityBoundsProviderModelStateProjection(t *testing.T) {
	cfg := defaultConfig()
	cfg.BalanceStrategy = balanceLRU
	engine := newPolicyEngine(cfg)
	for index := range maxRouteStateViews + 5 {
		_, err := engine.pick(pluginapi.SchedulerPickRequest{
			Provider:   "codex",
			Model:      strings.Repeat("m", 140) + time.Unix(int64(index), 0).UTC().Format(time.RFC3339Nano),
			Candidates: []pluginapi.SchedulerAuthCandidate{candidate("raw-auth-id", "active", "", "", "", 0)},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	view := engine.observabilitySnapshot()
	if len(view.StateByProviderModel) != maxRouteStateViews || view.StateProviderModelsOmitted != 5 || view.StateSize.RouteScopes != maxRouteStateViews+5 {
		t.Fatalf("bounded route projection = rows:%d omitted:%d total:%d", len(view.StateByProviderModel), view.StateProviderModelsOmitted, view.StateSize.RouteScopes)
	}
	for _, route := range view.StateByProviderModel {
		if len([]rune(route.Model)) > 128 {
			t.Fatalf("model projection is not bounded: %q", route.Model)
		}
	}
}
