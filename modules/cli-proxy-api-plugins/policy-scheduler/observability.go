package main

import (
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

const maxRouteStateViews = 100

type affinityEventCounters struct {
	New               uint64 `json:"new"`
	Hit               uint64 `json:"hit"`
	Failover          uint64 `json:"failover"`
	Expiries          uint64 `json:"expiry"`
	Evictions         uint64 `json:"eviction"`
	ReconfigureResets uint64 `json:"reconfigure_reset"`
	BindingsCleared   uint64 `json:"bindings_cleared"`
}

type effectivenessEvidence struct {
	TenantSignal    bool
	TenantAttribute bool
	QuotaAttribute  bool
	PlanAttribute   bool
	WeightAttribute bool
	BackupCandidate bool
	AffinitySignal  bool
}

type engineMetrics struct {
	Generation             uint64
	RegisterCount          uint64
	ReconfigureCount       uint64
	PickTotal              uint64
	CurrentGenerationPicks uint64
	PicksByStrategy        map[string]uint64
	Affinity               affinityEventCounters
	CooldownExclusions     uint64
	BalanceStateResets     uint64
	Effectiveness          effectivenessEvidence
}

type ineffectivePolicyView struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

type policyStateSizeView struct {
	DecisionHistoryEntries int `json:"decision_history_entries"`
	LRUEntries             int `json:"lru_entries"`
	WeightedEntries        int `json:"weighted_entries"`
	SelectionRouteEntries  int `json:"selection_route_index_entries"`
	RotationCursorEntries  int `json:"rotation_cursor_entries"`
	AffinityBindings       int `json:"affinity_bindings"`
	RouteScopes            int `json:"route_scopes"`
}

type routeStateSizeView struct {
	Provider         string `json:"provider,omitempty"`
	Model            string `json:"model,omitempty"`
	LRUEntries       int    `json:"lru_entries"`
	WeightedEntries  int    `json:"weighted_entries"`
	RotationCursor   bool   `json:"rotation_cursor"`
	AffinityBindings int    `json:"affinity_bindings"`
	sortKey          string
}

type observabilityView struct {
	Generation                 uint64                  `json:"generation"`
	RegisterCount              uint64                  `json:"register_count"`
	ReconfigureCount           uint64                  `json:"reconfigure_count"`
	PickTotal                  uint64                  `json:"pick_total"`
	CurrentGenerationPicks     uint64                  `json:"current_generation_picks"`
	PicksByStrategy            map[string]uint64       `json:"picks_by_strategy"`
	AffinityEvents             affinityEventCounters   `json:"affinity_events"`
	CooldownCandidatesExcluded uint64                  `json:"cooldown_candidates_excluded"`
	BalanceStateResets         uint64                  `json:"balance_state_resets"`
	EffectivenessEvaluation    string                  `json:"effectiveness_evaluation"`
	ConfiguredButIneffective   []ineffectivePolicyView `json:"configured_but_ineffective"`
	StateSize                  policyStateSizeView     `json:"state_size"`
	StateByProviderModel       []routeStateSizeView    `json:"state_by_provider_model"`
	StateProviderModelsOmitted int                     `json:"state_provider_models_omitted"`
}

type routeStateAccumulator struct {
	LRUEntries       int
	WeightedEntries  int
	RotationCursor   bool
	AffinityBindings int
}

func newEngineMetrics() engineMetrics {
	return engineMetrics{PicksByStrategy: make(map[string]uint64)}
}

func (engine *policyEngine) observePickInputsLocked(req pluginapi.SchedulerPickRequest, cfg pluginConfig) {
	evidence := &engine.metrics.Effectiveness
	if tenantFromRequest(req, cfg) != "" {
		evidence.TenantSignal = true
	}
	if sessionAffinitySignal(req, cfg) != "" {
		evidence.AffinitySignal = true
	}
	backupIDs := make(map[string]struct{}, len(cfg.BackupAuthIDs))
	for _, authID := range cfg.BackupAuthIDs {
		backupIDs[authID] = struct{}{}
	}
	for _, candidate := range req.Candidates {
		if strings.EqualFold(strings.TrimSpace(candidate.Status), "cooldown") {
			engine.metrics.CooldownExclusions++
		}
		if candidateValue(candidate, cfg.TenantGroupAttribute) != "" {
			evidence.TenantAttribute = true
		}
		if value := candidateValue(candidate, cfg.QuotaRemainingAttribute); finiteNumber(value) {
			evidence.QuotaAttribute = true
		}
		if candidateValue(candidate, cfg.PlanTierAttribute) != "" {
			evidence.PlanAttribute = true
		}
		if value := candidateValue(candidate, cfg.WeightAttribute); positiveInteger(value) {
			evidence.WeightAttribute = true
		}
		if _, ok := backupIDs[candidate.ID]; ok {
			evidence.BackupCandidate = true
		}
	}
}

func finiteNumber(value string) bool {
	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
}

func positiveInteger(value string) bool {
	number, err := strconv.Atoi(strings.TrimSpace(value))
	return err == nil && number > 0
}

func (engine *policyEngine) recordDecisionMetricsLocked(decision policyDecision) {
	engine.metrics.PickTotal++
	engine.metrics.CurrentGenerationPicks++
	strategy := decisionMetricStrategy(decision)
	engine.metrics.PicksByStrategy[strategy]++
	switch decision.AffinityOutcome {
	case "new":
		engine.metrics.Affinity.New++
	case "hit":
		engine.metrics.Affinity.Hit++
	case "failover":
		engine.metrics.Affinity.Failover++
	}
}

func decisionMetricStrategy(decision policyDecision) string {
	if decision.AffinityOutcome != "" {
		return "session_affinity_" + decision.AffinityOutcome
	}
	if decision.Outcome == "error" {
		return "error"
	}
	if decision.Outcome == "delegated" {
		switch decision.DelegateBuiltin {
		case pluginapi.SchedulerBuiltinFillFirst:
			return "delegate_fill_first"
		default:
			return "delegate_round_robin"
		}
	}
	switch {
	case decision.Reason == "least_recently_used":
		return "least_recently_used"
	case decision.Reason == "weighted":
		return "weighted"
	case decision.Reason == "policy_unique_candidate":
		return "policy_unique_candidate"
	case strings.HasPrefix(decision.Reason, "backup_after_"):
		return "backup"
	default:
		return "other"
	}
}

func (engine *policyEngine) observabilitySnapshot() observabilityView {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.purgeExpiredAffinityLocked(engine.now().UTC())

	picks := make(map[string]uint64, len(engine.metrics.PicksByStrategy))
	for strategy, count := range engine.metrics.PicksByStrategy {
		picks[strategy] = count
	}
	routes := engine.routeStateSnapshotLocked()
	omitted := 0
	if len(routes) > maxRouteStateViews {
		omitted = len(routes) - maxRouteStateViews
		routes = routes[:maxRouteStateViews]
	}
	evaluation := "observed"
	ineffective := engine.configuredButIneffectiveLocked()
	if engine.metrics.CurrentGenerationPicks == 0 {
		evaluation = "awaiting_scheduler_traffic"
		ineffective = []ineffectivePolicyView{}
	}
	return observabilityView{
		Generation:                 engine.metrics.Generation,
		RegisterCount:              engine.metrics.RegisterCount,
		ReconfigureCount:           engine.metrics.ReconfigureCount,
		PickTotal:                  engine.metrics.PickTotal,
		CurrentGenerationPicks:     engine.metrics.CurrentGenerationPicks,
		PicksByStrategy:            picks,
		AffinityEvents:             engine.metrics.Affinity,
		CooldownCandidatesExcluded: engine.metrics.CooldownExclusions,
		BalanceStateResets:         engine.metrics.BalanceStateResets,
		EffectivenessEvaluation:    evaluation,
		ConfiguredButIneffective:   ineffective,
		StateSize: policyStateSizeView{
			DecisionHistoryEntries: len(engine.decisions),
			LRUEntries:             len(engine.lastPicked),
			WeightedEntries:        len(engine.weightedCurrent),
			SelectionRouteEntries:  len(engine.selectionRoutes),
			RotationCursorEntries:  len(engine.rotationCursors),
			AffinityBindings:       len(engine.affinity),
			RouteScopes:            len(routes) + omitted,
		},
		StateByProviderModel:       routes,
		StateProviderModelsOmitted: omitted,
	}
}

func (engine *policyEngine) configuredButIneffectiveLocked() []ineffectivePolicyView {
	cfg := engine.config
	evidence := engine.metrics.Effectiveness
	out := make([]ineffectivePolicyView, 0, 6)
	if len(cfg.TenantGroups) > 0 || cfg.DenyUnknownTenant {
		switch {
		case !evidence.TenantSignal:
			out = append(out, ineffectivePolicyView{Field: "tenant_policy", Reason: "no configured request signal observed"})
		case !evidence.TenantAttribute:
			out = append(out, ineffectivePolicyView{Field: "tenant_group_attribute", Reason: "no candidate attribute observed"})
		}
	}
	if cfg.QuotaReservePercent > 0 && !evidence.QuotaAttribute {
		out = append(out, ineffectivePolicyView{Field: "quota_remaining_attribute", Reason: "no finite numeric candidate attribute observed"})
	}
	if len(cfg.PlanTiers) > 0 && !evidence.PlanAttribute {
		out = append(out, ineffectivePolicyView{Field: "plan_tier_attribute", Reason: "no candidate attribute observed"})
	}
	if cfg.BalanceStrategy == balanceWeighted && !evidence.WeightAttribute {
		out = append(out, ineffectivePolicyView{Field: "weight_attribute", Reason: "no positive integer candidate attribute observed; equal default weights are in use"})
	}
	if len(cfg.BackupAuthIDs) > 0 && !evidence.BackupCandidate {
		out = append(out, ineffectivePolicyView{Field: "backup_auth_ids", Reason: "configured backups were not present in host candidates"})
	}
	if cfg.SessionAffinityEnabled {
		switch {
		case !engine.affinityReady:
			out = append(out, ineffectivePolicyView{Field: "session_affinity", Reason: "process HMAC key is unavailable"})
		case !evidence.AffinitySignal:
			out = append(out, ineffectivePolicyView{Field: "session_affinity", Reason: "no configured header or metadata signal observed"})
		}
	}
	return out
}

func (engine *policyEngine) routeStateSnapshotLocked() []routeStateSizeView {
	accumulators := make(map[string]*routeStateAccumulator)
	get := func(routeKey string) *routeStateAccumulator {
		current := accumulators[routeKey]
		if current == nil {
			current = &routeStateAccumulator{}
			accumulators[routeKey] = current
		}
		return current
	}
	for key := range engine.lastPicked {
		if routeKey, ok := engine.selectionRoutes[key]; ok {
			get(routeKey).LRUEntries++
		}
	}
	for key := range engine.weightedCurrent {
		if routeKey, ok := engine.selectionRoutes[key]; ok {
			get(routeKey).WeightedEntries++
		}
	}
	for routeKey := range engine.rotationCursors {
		get(routeKey).RotationCursor = true
	}
	for _, binding := range engine.affinity {
		if binding.RouteKey != "" {
			get(binding.RouteKey).AffinityBindings++
		}
	}

	routes := make([]routeStateSizeView, 0, len(accumulators))
	for routeKey, state := range accumulators {
		provider, model := providerModelFromRouteKey(routeKey)
		routes = append(routes, routeStateSizeView{
			Provider:         boundedDisplay(provider),
			Model:            boundedDisplay(model),
			LRUEntries:       state.LRUEntries,
			WeightedEntries:  state.WeightedEntries,
			RotationCursor:   state.RotationCursor,
			AffinityBindings: state.AffinityBindings,
			sortKey:          routeKey,
		})
	}
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Provider != routes[j].Provider {
			return routes[i].Provider < routes[j].Provider
		}
		if routes[i].Model != routes[j].Model {
			return routes[i].Model < routes[j].Model
		}
		return routes[i].sortKey < routes[j].sortKey
	})
	return routes
}

func providerModelFromRouteKey(routeKey string) (string, string) {
	separator := strings.IndexByte(routeKey, 0)
	if separator < 0 {
		return routeKey, ""
	}
	return routeKey[:separator], routeKey[separator+1:]
}
