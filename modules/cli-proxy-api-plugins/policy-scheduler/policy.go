package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
	"gopkg.in/yaml.v3"
)

const (
	balanceDelegate = "delegate"
	balanceLRU      = "least-recently-used"
	balanceWeighted = "weighted"
)

type pluginConfig struct {
	TenantHeader            string            `yaml:"tenant_header"`
	TenantMetadataKey       string            `yaml:"tenant_metadata_key"`
	TenantGroupAttribute    string            `yaml:"tenant_group_attribute"`
	TenantGroups            map[string]string `yaml:"tenant_groups"`
	DenyUnknownTenant       bool              `yaml:"deny_unknown_tenant"`
	QuotaReservePercent     float64           `yaml:"quota_reserve_percent"`
	QuotaRemainingAttribute string            `yaml:"quota_remaining_attribute"`
	PlanTierAttribute       string            `yaml:"plan_tier_attribute"`
	PlanTiers               []string          `yaml:"plan_tiers"`
	BalanceStrategy         string            `yaml:"balance_strategy"`
	WeightAttribute         string            `yaml:"weight_attribute"`
	BackupAuthIDs           []string          `yaml:"backup_auth_ids"`
	DelegateBuiltin         string            `yaml:"delegate_builtin"`
	DecisionHistoryLimit    int               `yaml:"decision_history_limit"`
	SessionAffinityEnabled  bool              `yaml:"session_affinity_enabled"`
	SessionAffinityHeader   string            `yaml:"session_affinity_header"`
	SessionAffinityMetadata string            `yaml:"session_affinity_metadata_key"`
	SessionAffinityTTL      int               `yaml:"session_affinity_ttl_seconds"`
	SessionAffinityMax      int               `yaml:"session_affinity_max_entries"`
}

func defaultConfig() pluginConfig {
	return pluginConfig{
		TenantHeader:            "X-CPA-Tenant",
		TenantMetadataKey:       "tenant",
		TenantGroupAttribute:    "tenant_group",
		TenantGroups:            map[string]string{},
		QuotaReservePercent:     0,
		QuotaRemainingAttribute: "quota_remaining_percent",
		PlanTierAttribute:       "plan_type",
		BalanceStrategy:         balanceDelegate,
		WeightAttribute:         "weight",
		DelegateBuiltin:         pluginapi.SchedulerBuiltinRoundRobin,
		DecisionHistoryLimit:    50,
		SessionAffinityHeader:   "Authorization",
		SessionAffinityMetadata: "api_key_id",
		SessionAffinityTTL:      3600,
		SessionAffinityMax:      4096,
	}
}

func decodeConfig(raw []byte) (pluginConfig, error) {
	cfg := defaultConfig()
	if len(raw) != 0 {
		if err := yaml.Unmarshal(raw, &cfg); err != nil {
			return pluginConfig{}, fmt.Errorf("decode plugin config: %w", err)
		}
	}
	cfg.normalize()
	if cfg.QuotaReservePercent < 0 || cfg.QuotaReservePercent > 100 {
		return pluginConfig{}, fmt.Errorf("quota_reserve_percent must be between 0 and 100")
	}
	switch cfg.BalanceStrategy {
	case balanceDelegate, balanceLRU, balanceWeighted:
	default:
		return pluginConfig{}, fmt.Errorf("balance_strategy must be delegate, least-recently-used, or weighted")
	}
	switch cfg.DelegateBuiltin {
	case pluginapi.SchedulerBuiltinRoundRobin, pluginapi.SchedulerBuiltinFillFirst:
	default:
		return pluginConfig{}, fmt.Errorf("delegate_builtin must be round-robin or fill-first")
	}
	if cfg.SessionAffinityTTL < 60 || cfg.SessionAffinityTTL > 86400 {
		return pluginConfig{}, fmt.Errorf("session_affinity_ttl_seconds must be between 60 and 86400")
	}
	if cfg.SessionAffinityMax < 1 || cfg.SessionAffinityMax > 10000 {
		return pluginConfig{}, fmt.Errorf("session_affinity_max_entries must be between 1 and 10000")
	}
	if len(cfg.SessionAffinityHeader) > 128 {
		return pluginConfig{}, fmt.Errorf("session_affinity_header must not exceed 128 bytes")
	}
	if len(cfg.SessionAffinityMetadata) > 128 {
		return pluginConfig{}, fmt.Errorf("session_affinity_metadata_key must not exceed 128 bytes")
	}
	if cfg.SessionAffinityEnabled && cfg.SessionAffinityHeader == "" && cfg.SessionAffinityMetadata == "" {
		return pluginConfig{}, fmt.Errorf("session affinity requires a header or metadata key")
	}
	return cfg, nil
}

func (cfg *pluginConfig) normalize() {
	defaults := defaultConfig()
	cfg.TenantHeader = firstNonEmpty(cfg.TenantHeader, defaults.TenantHeader)
	cfg.TenantMetadataKey = firstNonEmpty(cfg.TenantMetadataKey, defaults.TenantMetadataKey)
	cfg.TenantGroupAttribute = firstNonEmpty(cfg.TenantGroupAttribute, defaults.TenantGroupAttribute)
	cfg.QuotaRemainingAttribute = firstNonEmpty(cfg.QuotaRemainingAttribute, defaults.QuotaRemainingAttribute)
	cfg.PlanTierAttribute = firstNonEmpty(cfg.PlanTierAttribute, defaults.PlanTierAttribute)
	cfg.WeightAttribute = firstNonEmpty(cfg.WeightAttribute, defaults.WeightAttribute)
	cfg.BalanceStrategy = strings.ToLower(firstNonEmpty(cfg.BalanceStrategy, defaults.BalanceStrategy))
	cfg.DelegateBuiltin = strings.ToLower(firstNonEmpty(cfg.DelegateBuiltin, defaults.DelegateBuiltin))
	// The struct is preloaded with defaults before YAML decode. Preserve an
	// explicitly empty source so an operator can disable reading that input.
	cfg.SessionAffinityHeader = strings.TrimSpace(cfg.SessionAffinityHeader)
	cfg.SessionAffinityMetadata = strings.TrimSpace(cfg.SessionAffinityMetadata)
	if cfg.SessionAffinityTTL <= 0 {
		cfg.SessionAffinityTTL = defaults.SessionAffinityTTL
	}
	if cfg.SessionAffinityMax <= 0 {
		cfg.SessionAffinityMax = defaults.SessionAffinityMax
	}
	if cfg.DecisionHistoryLimit <= 0 {
		cfg.DecisionHistoryLimit = defaults.DecisionHistoryLimit
	}
	if cfg.DecisionHistoryLimit > 200 {
		cfg.DecisionHistoryLimit = 200
	}
	if cfg.TenantGroups == nil {
		cfg.TenantGroups = map[string]string{}
	}
	cfg.TenantGroups = cleanStringMap(cfg.TenantGroups)
	cfg.PlanTiers = cleanStrings(cfg.PlanTiers)
	cfg.BackupAuthIDs = cleanStrings(cfg.BackupAuthIDs)
}

func firstNonEmpty(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}

func cleanStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func cleanStringMap(values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for key, value := range values {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" {
			out[strings.ToLower(key)] = value
		}
	}
	return out
}

type policyError struct {
	Code       string
	Message    string
	Retryable  bool
	HTTPStatus int
}

func (err *policyError) Error() string { return err.Message }

type policyDecision struct {
	Time            time.Time          `json:"time"`
	Provider        string             `json:"provider,omitempty"`
	Model           string             `json:"model,omitempty"`
	Stream          bool               `json:"stream"`
	Tenant          string             `json:"tenant,omitempty"`
	InputCount      int                `json:"input_count"`
	AfterStatus     int                `json:"after_status"`
	AfterTenant     int                `json:"after_tenant"`
	AfterQuota      int                `json:"after_quota"`
	AfterPriority   int                `json:"after_priority"`
	Outcome         string             `json:"outcome"`
	SelectedAlias   string             `json:"selected_alias,omitempty"`
	DelegateBuiltin string             `json:"delegate_builtin,omitempty"`
	Reason          string             `json:"reason"`
	RetryAfter      string             `json:"retry_after,omitempty"`
	CandidateTags   []candidateTagView `json:"candidate_tags,omitempty"`
	AffinityOutcome string             `json:"affinity_outcome,omitempty"`
}

type candidateTagView struct {
	Alias          string `json:"alias"`
	TenantGroup    string `json:"tenant_group,omitempty"`
	PlanTier       string `json:"plan_tier,omitempty"`
	QuotaRemaining string `json:"quota_remaining_percent,omitempty"`
	Priority       int    `json:"priority"`
}

type policyEngine struct {
	mu              sync.Mutex
	config          pluginConfig
	sequence        uint64
	lastPicked      map[string]uint64
	weightedCurrent map[string]int
	rotationCursors map[string]uint64
	decisions       []policyDecision
	aliaser         *credentialAliaser
	affinityKey     [32]byte
	affinityReady   bool
	affinityTick    uint64
	affinity        map[string]affinityBinding
	now             func() time.Time
}

type affinityBinding struct {
	AuthID    string
	ExpiresAt time.Time
	LastUsed  uint64
}

func newPolicyEngine(cfg pluginConfig) *policyEngine {
	engine := &policyEngine{
		config:          cfg,
		lastPicked:      make(map[string]uint64),
		weightedCurrent: make(map[string]int),
		rotationCursors: make(map[string]uint64),
		aliaser:         newCredentialAliaser(),
		affinity:        make(map[string]affinityBinding),
		now:             time.Now,
	}
	engine.resetAffinityKeyLocked()
	return engine
}

func (engine *policyEngine) reconfigure(cfg pluginConfig) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if affinityConfigChanged(engine.config, cfg) {
		engine.affinity = make(map[string]affinityBinding)
		engine.affinityTick = 0
	}
	if balanceConfigChanged(engine.config, cfg) {
		engine.lastPicked = make(map[string]uint64)
		engine.weightedCurrent = make(map[string]int)
		engine.rotationCursors = make(map[string]uint64)
	}
	engine.config = cfg
	if len(engine.decisions) > cfg.DecisionHistoryLimit {
		engine.decisions = append([]policyDecision(nil), engine.decisions[len(engine.decisions)-cfg.DecisionHistoryLimit:]...)
	}
}

func (engine *policyEngine) shutdown() {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.config = defaultConfig()
	engine.sequence = 0
	engine.lastPicked = make(map[string]uint64)
	engine.weightedCurrent = make(map[string]int)
	engine.rotationCursors = make(map[string]uint64)
	engine.decisions = nil
	engine.aliaser = newCredentialAliaser()
	engine.affinity = make(map[string]affinityBinding)
	engine.affinityTick = 0
	engine.resetAffinityKeyLocked()
}

func (engine *policyEngine) configSnapshot() pluginConfig {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	return cloneConfig(engine.config)
}

func cloneConfig(cfg pluginConfig) pluginConfig {
	cfg.TenantGroups = cleanStringMap(cfg.TenantGroups)
	cfg.PlanTiers = append([]string(nil), cfg.PlanTiers...)
	cfg.BackupAuthIDs = append([]string(nil), cfg.BackupAuthIDs...)
	return cfg
}

func (engine *policyEngine) pick(req pluginapi.SchedulerPickRequest) (pluginapi.SchedulerPickResponse, error) {
	engine.mu.Lock()
	defer engine.mu.Unlock()

	cfg := engine.config
	now := engine.now().UTC()
	decision := policyDecision{
		Time:       now,
		Provider:   strings.TrimSpace(req.Provider),
		Model:      strings.TrimSpace(req.Model),
		Stream:     req.Stream,
		InputCount: len(req.Candidates),
	}
	routeKey := schedulerRouteKey(req)
	tenant := tenantFromRequest(req, cfg)
	if tenant != "" {
		decision.Tenant = "present"
	}
	decision.CandidateTags = engine.candidateTags(req.Candidates, cfg)

	active := filterActive(req.Candidates)
	decision.AfterStatus = len(active)
	if len(active) == 0 {
		return pluginapi.SchedulerPickResponse{}, engine.failLocked(&decision, "all candidates are disabled, unavailable, or in cooldown")
	}

	tenantFiltered, tenantApplied := filterTenant(active, tenant, cfg)
	decision.AfterTenant = len(tenantFiltered)
	if len(tenantFiltered) == 0 {
		if backup, ok := firstBackup(active, cfg.BackupAuthIDs); ok {
			return engine.selectLocked(&decision, routeKey, backup, "backup_after_tenant_filter"), nil
		}
		return pluginapi.SchedulerPickResponse{}, engine.failLocked(&decision, "tenant policy removed every candidate and no eligible backup is present")
	}

	quotaFiltered, quotaApplied := filterQuota(tenantFiltered, cfg)
	decision.AfterQuota = len(quotaFiltered)
	if len(quotaFiltered) == 0 {
		if backup, ok := firstBackup(active, cfg.BackupAuthIDs); ok {
			return engine.selectLocked(&decision, routeKey, backup, "backup_after_quota_reserve"), nil
		}
		return pluginapi.SchedulerPickResponse{}, engine.failLocked(&decision, "every candidate is below quota reserve and no eligible backup is present")
	}

	preferred, priorityApplied := filterPriorityAndPlan(quotaFiltered, cfg)
	decision.AfterPriority = len(preferred)
	if len(preferred) == 0 {
		if backup, ok := firstBackup(active, cfg.BackupAuthIDs); ok {
			return engine.selectLocked(&decision, routeKey, backup, "backup_after_priority_filter"), nil
		}
		return pluginapi.SchedulerPickResponse{}, engine.failLocked(&decision, "priority policy produced no candidate")
	}

	strongPolicy := tenantApplied || quotaApplied || priorityApplied
	if cfg.SessionAffinityEnabled {
		signal := sessionAffinitySignal(req, cfg)
		if signal != "" {
			if !engine.affinityReady {
				return pluginapi.SchedulerPickResponse{}, engine.failLocked(&decision, "session affinity key is unavailable")
			}
			cacheKey := engine.sessionAffinityKey(req, tenant, signal)
			if selected, ok := engine.affinityCandidateLocked(cacheKey, preferred, now, cfg); ok {
				decision.AffinityOutcome = "hit"
				return engine.selectLocked(&decision, routeKey, selected, "session_affinity_hit"), nil
			}
			selected := engine.pickAffinityFallbackLocked(req, preferred, cfg)
			outcome := "new"
			if _, existed := engine.affinity[cacheKey]; existed {
				outcome = "failover"
			}
			engine.bindAffinityLocked(cacheKey, selected.ID, now, cfg)
			decision.AffinityOutcome = outcome
			return engine.selectLocked(&decision, routeKey, selected, "session_affinity_"+outcome), nil
		}
	}
	switch cfg.BalanceStrategy {
	case balanceLRU:
		selected := engine.pickLRULocked(routeKey, preferred)
		return engine.selectLocked(&decision, routeKey, selected, "least_recently_used"), nil
	case balanceWeighted:
		selected := engine.pickWeightedLocked(routeKey, preferred, cfg.WeightAttribute)
		return engine.selectLocked(&decision, routeKey, selected, "weighted"), nil
	default:
		if len(preferred) == 1 && strongPolicy {
			return engine.selectLocked(&decision, routeKey, preferred[0], "policy_unique_candidate"), nil
		}
		decision.Outcome = "delegated"
		decision.DelegateBuiltin = cfg.DelegateBuiltin
		decision.Reason = "no_strong_policy_decision"
		engine.recordLocked(decision)
		return pluginapi.SchedulerPickResponse{DelegateBuiltin: cfg.DelegateBuiltin, Handled: true}, nil
	}
}

func affinityConfigChanged(left, right pluginConfig) bool {
	return left.SessionAffinityEnabled != right.SessionAffinityEnabled ||
		!strings.EqualFold(left.SessionAffinityHeader, right.SessionAffinityHeader) ||
		!strings.EqualFold(left.SessionAffinityMetadata, right.SessionAffinityMetadata) ||
		left.SessionAffinityTTL != right.SessionAffinityTTL ||
		left.SessionAffinityMax != right.SessionAffinityMax
}

func balanceConfigChanged(left, right pluginConfig) bool {
	return !strings.EqualFold(left.BalanceStrategy, right.BalanceStrategy) ||
		!strings.EqualFold(left.WeightAttribute, right.WeightAttribute) ||
		!strings.EqualFold(left.DelegateBuiltin, right.DelegateBuiltin)
}

func (engine *policyEngine) resetAffinityKeyLocked() {
	engine.affinityKey = [32]byte{}
	_, err := rand.Read(engine.affinityKey[:])
	engine.affinityReady = err == nil
}

func sessionAffinitySignal(req pluginapi.SchedulerPickRequest, cfg pluginConfig) string {
	if cfg.SessionAffinityMetadata != "" {
		if raw, ok := req.Options.Metadata[cfg.SessionAffinityMetadata]; ok {
			value, isString := raw.(string)
			value = strings.TrimSpace(value)
			if isString && value != "" && len(value) <= 4096 {
				return "metadata\x00" + value
			}
		}
	}
	if cfg.SessionAffinityHeader == "" {
		return ""
	}
	for key, values := range req.Options.Headers {
		if !strings.EqualFold(strings.TrimSpace(key), cfg.SessionAffinityHeader) {
			continue
		}
		for _, value := range values {
			if value = strings.TrimSpace(value); value != "" && len(value) <= 4096 {
				return "header\x00" + value
			}
		}
	}
	return ""
}

func (engine *policyEngine) sessionAffinityKey(req pluginapi.SchedulerPickRequest, tenant, signal string) string {
	mac := hmac.New(sha256.New, engine.affinityKey[:])
	_, _ = mac.Write([]byte(schedulerRouteKey(req)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.ToLower(strings.TrimSpace(tenant))))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(signal))
	return string(mac.Sum(nil))
}

func (engine *policyEngine) affinityCandidateLocked(cacheKey string, candidates []pluginapi.SchedulerAuthCandidate, now time.Time, cfg pluginConfig) (pluginapi.SchedulerAuthCandidate, bool) {
	engine.purgeExpiredAffinityLocked(now)
	binding, ok := engine.affinity[cacheKey]
	if !ok {
		return pluginapi.SchedulerAuthCandidate{}, false
	}
	for _, candidate := range candidates {
		if candidate.ID == binding.AuthID {
			engine.affinityTick++
			binding.ExpiresAt = now.Add(time.Duration(cfg.SessionAffinityTTL) * time.Second)
			binding.LastUsed = engine.affinityTick
			engine.affinity[cacheKey] = binding
			return candidate, true
		}
	}
	return pluginapi.SchedulerAuthCandidate{}, false
}

func (engine *policyEngine) pickAffinityFallbackLocked(req pluginapi.SchedulerPickRequest, candidates []pluginapi.SchedulerAuthCandidate, cfg pluginConfig) pluginapi.SchedulerAuthCandidate {
	routeKey := schedulerRouteKey(req)
	switch cfg.BalanceStrategy {
	case balanceWeighted:
		return engine.pickWeightedLocked(routeKey, candidates, cfg.WeightAttribute)
	case balanceLRU:
		return engine.pickLRULocked(routeKey, candidates)
	default:
		return engine.pickBuiltinLocked(routeKey, candidates, cfg.DelegateBuiltin)
	}
}

func (engine *policyEngine) bindAffinityLocked(cacheKey, authID string, now time.Time, cfg pluginConfig) {
	engine.purgeExpiredAffinityLocked(now)
	if _, exists := engine.affinity[cacheKey]; !exists && len(engine.affinity) >= cfg.SessionAffinityMax {
		oldestKey := ""
		oldestTick := ^uint64(0)
		for key, binding := range engine.affinity {
			if binding.LastUsed < oldestTick {
				oldestKey = key
				oldestTick = binding.LastUsed
			}
		}
		delete(engine.affinity, oldestKey)
	}
	engine.affinityTick++
	engine.affinity[cacheKey] = affinityBinding{
		AuthID:    authID,
		ExpiresAt: now.Add(time.Duration(cfg.SessionAffinityTTL) * time.Second),
		LastUsed:  engine.affinityTick,
	}
}

func (engine *policyEngine) purgeExpiredAffinityLocked(now time.Time) {
	for key, binding := range engine.affinity {
		if !binding.ExpiresAt.After(now) {
			delete(engine.affinity, key)
		}
	}
}

func (engine *policyEngine) failLocked(decision *policyDecision, message string) error {
	decision.Outcome = "error"
	decision.Reason = message
	engine.recordLocked(*decision)
	return &policyError{Code: "scheduler_no_eligible_candidate", Message: message, Retryable: true, HTTPStatus: 503}
}

func (engine *policyEngine) selectLocked(decision *policyDecision, routeKey string, candidate pluginapi.SchedulerAuthCandidate, reason string) pluginapi.SchedulerPickResponse {
	engine.sequence++
	engine.lastPicked[selectionStateKey(routeKey, candidate.ID)] = engine.sequence
	decision.Outcome = "selected"
	decision.SelectedAlias = engine.aliaser.Alias(candidate.ID)
	decision.Reason = reason
	engine.recordLocked(*decision)
	return pluginapi.SchedulerPickResponse{AuthID: candidate.ID, Handled: true}
}

func (engine *policyEngine) recordLocked(decision policyDecision) {
	limit := engine.config.DecisionHistoryLimit
	if limit <= 0 {
		return
	}
	engine.decisions = append(engine.decisions, decision)
	if len(engine.decisions) > limit {
		engine.decisions = append([]policyDecision(nil), engine.decisions[len(engine.decisions)-limit:]...)
	}
}

func (engine *policyEngine) decisionsSnapshot() []policyDecision {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	out := make([]policyDecision, len(engine.decisions))
	copy(out, engine.decisions)
	return out
}

func (engine *policyEngine) affinityStateSnapshot() (active int, keyAvailable bool) {
	engine.mu.Lock()
	defer engine.mu.Unlock()
	engine.purgeExpiredAffinityLocked(engine.now().UTC())
	return len(engine.affinity), engine.affinityReady
}

func (engine *policyEngine) candidateTags(candidates []pluginapi.SchedulerAuthCandidate, cfg pluginConfig) []candidateTagView {
	out := make([]candidateTagView, 0, len(candidates))
	for _, candidate := range candidates {
		out = append(out, candidateTagView{
			Alias:          engine.aliaser.Alias(candidate.ID),
			TenantGroup:    boundedDisplay(candidateValue(candidate, cfg.TenantGroupAttribute)),
			PlanTier:       boundedDisplay(candidateValue(candidate, cfg.PlanTierAttribute)),
			QuotaRemaining: boundedDisplay(candidateValue(candidate, cfg.QuotaRemainingAttribute)),
			Priority:       candidate.Priority,
		})
	}
	return out
}

func boundedDisplay(value string) string {
	value = strings.TrimSpace(value)
	const maxRunes = 128
	runes := []rune(value)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes])
	}
	return value
}

func (engine *policyEngine) pickLRULocked(routeKey string, candidates []pluginapi.SchedulerAuthCandidate) pluginapi.SchedulerAuthCandidate {
	sorted := append([]pluginapi.SchedulerAuthCandidate(nil), candidates...)
	sort.Slice(sorted, func(i, j int) bool {
		left := engine.lastPicked[selectionStateKey(routeKey, sorted[i].ID)]
		right := engine.lastPicked[selectionStateKey(routeKey, sorted[j].ID)]
		if left != right {
			return left < right
		}
		return sorted[i].ID < sorted[j].ID
	})
	return sorted[0]
}

func (engine *policyEngine) pickWeightedLocked(routeKey string, candidates []pluginapi.SchedulerAuthCandidate, attribute string) pluginapi.SchedulerAuthCandidate {
	sorted := append([]pluginapi.SchedulerAuthCandidate(nil), candidates...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	total := 0
	selected := 0
	best := 0
	for index, candidate := range sorted {
		weight := candidateWeight(candidate, attribute)
		total += weight
		stateKey := selectionStateKey(routeKey, candidate.ID)
		engine.weightedCurrent[stateKey] += weight
		current := engine.weightedCurrent[stateKey]
		if index == 0 || current > best {
			selected = index
			best = current
		}
	}
	engine.weightedCurrent[selectionStateKey(routeKey, sorted[selected].ID)] -= total
	return sorted[selected]
}

func (engine *policyEngine) pickBuiltinLocked(routeKey string, candidates []pluginapi.SchedulerAuthCandidate, strategy string) pluginapi.SchedulerAuthCandidate {
	ordered := append([]pluginapi.SchedulerAuthCandidate(nil), candidates...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	if strategy == pluginapi.SchedulerBuiltinFillFirst {
		return ordered[0]
	}
	cursor := engine.rotationCursors[routeKey]
	selected := ordered[cursor%uint64(len(ordered))]
	engine.rotationCursors[routeKey] = cursor + 1
	return selected
}

func schedulerRouteKey(req pluginapi.SchedulerPickRequest) string {
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		providers := make([]string, 0, len(req.Providers))
		seen := make(map[string]struct{}, len(req.Providers))
		for _, value := range req.Providers {
			value = strings.ToLower(strings.TrimSpace(value))
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			providers = append(providers, value)
		}
		sort.Strings(providers)
		provider = strings.Join(providers, ",")
	}
	return provider + "\x00" + strings.ToLower(strings.TrimSpace(req.Model))
}

func selectionStateKey(routeKey, authID string) string {
	return routeKey + "\x00" + authID
}

func filterActive(candidates []pluginapi.SchedulerAuthCandidate) []pluginapi.SchedulerAuthCandidate {
	out := make([]pluginapi.SchedulerAuthCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		status := strings.ToLower(strings.TrimSpace(candidate.Status))
		switch status {
		case "disabled", "cooldown", "unavailable":
			continue
		}
		out = append(out, candidate)
	}
	return out
}

func tenantFromRequest(req pluginapi.SchedulerPickRequest, cfg pluginConfig) string {
	for key, values := range req.Options.Headers {
		if strings.EqualFold(strings.TrimSpace(key), cfg.TenantHeader) {
			for _, value := range values {
				if value = strings.TrimSpace(value); value != "" {
					return value
				}
			}
		}
	}
	if raw, ok := req.Options.Metadata[cfg.TenantMetadataKey]; ok {
		return strings.TrimSpace(fmt.Sprint(raw))
	}
	return ""
}

func filterTenant(candidates []pluginapi.SchedulerAuthCandidate, tenant string, cfg pluginConfig) ([]pluginapi.SchedulerAuthCandidate, bool) {
	if tenant == "" {
		return append([]pluginapi.SchedulerAuthCandidate(nil), candidates...), false
	}
	group, known := cfg.TenantGroups[strings.ToLower(tenant)]
	if !known {
		if cfg.DenyUnknownTenant {
			return nil, true
		}
		return append([]pluginapi.SchedulerAuthCandidate(nil), candidates...), false
	}
	out := make([]pluginapi.SchedulerAuthCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if strings.EqualFold(candidateValue(candidate, cfg.TenantGroupAttribute), group) {
			out = append(out, candidate)
		}
	}
	return out, len(out) != len(candidates)
}

func filterQuota(candidates []pluginapi.SchedulerAuthCandidate, cfg pluginConfig) ([]pluginapi.SchedulerAuthCandidate, bool) {
	if cfg.QuotaReservePercent <= 0 {
		return append([]pluginapi.SchedulerAuthCandidate(nil), candidates...), false
	}
	out := make([]pluginapi.SchedulerAuthCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		value := candidateValue(candidate, cfg.QuotaRemainingAttribute)
		remaining, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err == nil && remaining < cfg.QuotaReservePercent {
			continue
		}
		out = append(out, candidate)
	}
	return out, len(out) != len(candidates)
}

func filterPriorityAndPlan(candidates []pluginapi.SchedulerAuthCandidate, cfg pluginConfig) ([]pluginapi.SchedulerAuthCandidate, bool) {
	if len(candidates) == 0 {
		return nil, false
	}
	maxPriority := candidates[0].Priority
	for _, candidate := range candidates[1:] {
		if candidate.Priority > maxPriority {
			maxPriority = candidate.Priority
		}
	}
	prioritySet := make([]pluginapi.SchedulerAuthCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Priority == maxPriority {
			prioritySet = append(prioritySet, candidate)
		}
	}
	applied := len(prioritySet) != len(candidates)
	if len(cfg.PlanTiers) == 0 || len(prioritySet) <= 1 {
		return prioritySet, applied
	}
	ranks := make(map[string]int, len(cfg.PlanTiers))
	for index, tier := range cfg.PlanTiers {
		ranks[strings.ToLower(tier)] = index
	}
	bestRank := len(cfg.PlanTiers) + 1
	for _, candidate := range prioritySet {
		if rank, ok := ranks[strings.ToLower(candidateValue(candidate, cfg.PlanTierAttribute))]; ok && rank < bestRank {
			bestRank = rank
		}
	}
	if bestRank > len(cfg.PlanTiers) {
		return prioritySet, applied
	}
	out := make([]pluginapi.SchedulerAuthCandidate, 0, len(prioritySet))
	for _, candidate := range prioritySet {
		if rank, ok := ranks[strings.ToLower(candidateValue(candidate, cfg.PlanTierAttribute))]; ok && rank == bestRank {
			out = append(out, candidate)
		}
	}
	return out, applied || len(out) != len(prioritySet)
}

func firstBackup(candidates []pluginapi.SchedulerAuthCandidate, backups []string) (pluginapi.SchedulerAuthCandidate, bool) {
	for _, backupID := range backups {
		for _, candidate := range candidates {
			if candidate.ID == backupID {
				return candidate, true
			}
		}
	}
	return pluginapi.SchedulerAuthCandidate{}, false
}

func candidateValue(candidate pluginapi.SchedulerAuthCandidate, key string) string {
	if value := strings.TrimSpace(candidate.Attributes[key]); value != "" {
		return value
	}
	for candidateKey, value := range candidate.Attributes {
		if strings.EqualFold(candidateKey, key) {
			return strings.TrimSpace(value)
		}
	}
	if value, ok := candidate.Metadata[key]; ok {
		return strings.TrimSpace(fmt.Sprint(value))
	}
	for candidateKey, value := range candidate.Metadata {
		if strings.EqualFold(candidateKey, key) {
			return strings.TrimSpace(fmt.Sprint(value))
		}
	}
	return ""
}

func candidateWeight(candidate pluginapi.SchedulerAuthCandidate, attribute string) int {
	weight, err := strconv.Atoi(candidateValue(candidate, attribute))
	if err != nil || weight <= 0 {
		return 1
	}
	if weight > 1000 {
		return 1000
	}
	return weight
}
