package credential

import (
	"encoding/json"
	"strings"
	"testing"
)

const (
	testCredentialID = "cs-0123456789abcdef01234567"
	testOpaqueKey    = OpaqueKeyPrefix + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

func TestParseRecognizesOnlySafeSidecarProjection(t *testing.T) {
	projection := Projection{
		Type:         "codex",
		AuthMode:     AuthMode,
		AccessToken:  testOpaqueKey,
		BaseURL:      "http://127.0.0.1:18319/backend-api/codex",
		CredentialID: testCredentialID,
		Disabled:     true,
		Websockets:   false,
	}
	raw, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	parsed, handled, err := Parse("codex", "credential-security-cs-0123456789abcdef01234567.json", raw, 18319)
	if err != nil || !handled || parsed == nil {
		t.Fatalf("handled=%v parsed=%#v err=%v", handled, parsed, err)
	}
	if parsed.Label != testCredentialID || !parsed.Disabled || parsed.Attributes["api_key"] != testOpaqueKey || parsed.Attributes["base_url"] != projection.BaseURL {
		t.Fatalf("unexpected parse result: %#v", parsed)
	}
	if _, exposed := parsed.Metadata["access_token"]; exposed {
		t.Fatalf("opaque key entered metadata: %#v", parsed.Metadata)
	}
}

func TestParseDeclinesOrdinaryAuthAndOtherProviders(t *testing.T) {
	for name, test := range map[string]struct {
		provider string
		raw      string
	}{
		"ordinary codex": {provider: "codex", raw: `{"type":"codex","access_token":"ordinary"}`},
		"other provider": {provider: "claude", raw: `{"type":"codex","auth_mode":"credential_security_sidecar"}`},
		"invalid json":   {provider: "codex", raw: `{`},
	} {
		t.Run(name, func(t *testing.T) {
			parsed, handled, err := Parse(test.provider, "ordinary.json", []byte(test.raw), 18319)
			if err != nil || handled || parsed != nil {
				t.Fatalf("handled=%v parsed=%#v err=%v", handled, parsed, err)
			}
		})
	}
}

func TestParseRejectsRecognizedUnsafeProjection(t *testing.T) {
	base := map[string]any{
		"type":          "codex",
		"auth_mode":     AuthMode,
		"access_token":  testOpaqueKey,
		"base_url":      "http://127.0.0.1:18319/backend-api/codex",
		"credential_id": testCredentialID,
		"disabled":      true,
		"websockets":    false,
	}
	tests := map[string]func(map[string]any){
		"plaintext token": func(value map[string]any) { value["refresh_token"] = "raw-secret" },
		"remote base url": func(value map[string]any) { value["base_url"] = "https://example.com/backend-api/codex" },
		"wrong port":      func(value map[string]any) { value["base_url"] = "http://127.0.0.1:18320/backend-api/codex" },
		"weak opaque key": func(value map[string]any) { value["access_token"] = "cpcs_short" },
		"websocket":       func(value map[string]any) { value["websockets"] = true },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			value := make(map[string]any, len(base))
			for key, item := range base {
				value[key] = item
			}
			mutate(value)
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			parsed, handled, err := Parse("codex", "credential-security-"+testCredentialID+".json", raw, 18319)
			if !handled || err == nil || parsed != nil || strings.Contains(err.Error(), "raw-secret") {
				t.Fatalf("handled=%v parsed=%#v err=%v", handled, parsed, err)
			}
		})
	}
}

func TestIdentifiersAndFileNamesAreBounded(t *testing.T) {
	if !ValidCredentialID(testCredentialID) || !ValidOpaqueKey(testOpaqueKey) {
		t.Fatal("valid identifiers rejected")
	}
	for _, value := range []string{"", "cs-ABCDEF0123456789abcdef01", "cs-../0123456789abcdef012345", "cs-0123"} {
		if ValidCredentialID(value) {
			t.Fatalf("invalid credential id accepted: %q", value)
		}
	}
	name, err := FileName(testCredentialID)
	if err != nil || name != "credential-security-"+testCredentialID+".json" {
		t.Fatalf("name=%q err=%v", name, err)
	}
}

func TestParseRejectsPathBearingFileName(t *testing.T) {
	raw, err := json.Marshal(Projection{Type: "codex", AuthMode: AuthMode, AccessToken: testOpaqueKey, BaseURL: "http://127.0.0.1:18319/backend-api/codex", CredentialID: testCredentialID})
	if err != nil {
		t.Fatal(err)
	}
	if _, handled, err := Parse("codex", "../credential-security-"+testCredentialID+".json", raw, 18319); !handled || err == nil {
		t.Fatalf("path-bearing file name accepted: handled=%v err=%v", handled, err)
	}
}
