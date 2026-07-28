package main

import (
	"encoding/json"
	"testing"
)

const maxFuzzInputBytes = 64 << 10

func FuzzDecodeConfig(f *testing.F) {
	for _, seed := range [][]byte{
		nil,
		[]byte("balance_strategy: least-recently-used\n"),
		[]byte("session_affinity_enabled: true\nsession_affinity_header: Session_id\n"),
		[]byte("quota_reserve_percent: 101\n"),
		[]byte("[not-a-mapping]"),
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) > maxFuzzInputBytes {
			t.Skip()
		}
		cfg, err := decodeConfig(raw)
		if err != nil {
			return
		}
		if cfg.DecisionHistoryLimit < 1 || cfg.DecisionHistoryLimit > 200 || cfg.SessionAffinityTTL < 60 || cfg.SessionAffinityTTL > 86400 || cfg.SessionAffinityMax < 1 || cfg.SessionAffinityMax > 10000 {
			t.Fatalf("successful decode violated normalized bounds: %#v", cfg)
		}
	})
}

func FuzzSchedulerRequestEnvelope(f *testing.F) {
	for _, seed := range [][]byte{
		[]byte(`{}`),
		[]byte(`{"provider":"codex","model":"gpt-5","candidates":[]}`),
		[]byte(`{"provider":"codex","model":"gpt-5","candidates":[{"id":"a","status":"active"}]}`),
		[]byte(`{"provider":`),
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) > maxFuzzInputBytes {
			t.Skip()
		}
		response, err := handleSchedulerPick(newPolicyEngine(defaultConfig()), raw)
		if err != nil {
			t.Fatalf("scheduler handler returned transport error: %v", err)
		}
		if !json.Valid(response) {
			t.Fatalf("scheduler handler returned invalid envelope: %q", response)
		}
	})
}

func FuzzManagementRouteDecoder(f *testing.F) {
	for _, seed := range [][]byte{
		[]byte(`{}`),
		[]byte(`{"Method":"GET","Path":"/v0/management/policy-scheduler/status"}`),
		[]byte(`{"Method":"GET","Path":"/v0/resource/plugins/policy-scheduler/dashboard"}`),
		[]byte(`{"Path":`),
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) > maxFuzzInputBytes {
			t.Skip()
		}
		if _, err := decodeManagementRequest(raw); err != nil {
			return
		}
		response, err := handleManagement(raw)
		if err != nil {
			t.Fatalf("decoded management request failed dispatch: %v", err)
		}
		if !json.Valid(response) {
			t.Fatalf("management handler returned invalid envelope: %q", response)
		}
	})
}
