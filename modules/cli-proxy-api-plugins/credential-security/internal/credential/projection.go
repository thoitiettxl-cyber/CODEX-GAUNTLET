package credential

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	AuthMode        = "credential_security_sidecar"
	OpaqueKeyPrefix = "cpcs_"
	URLPath         = "/backend-api/codex"
)

type Projection struct {
	Type         string `json:"type"`
	AuthMode     string `json:"auth_mode"`
	AccessToken  string `json:"access_token"`
	BaseURL      string `json:"base_url"`
	CredentialID string `json:"credential_id"`
	Prefix       string `json:"prefix,omitempty"`
	Disabled     bool   `json:"disabled"`
	Websockets   bool   `json:"websockets"`
}

type Parsed struct {
	ID          string
	FileName    string
	Label       string
	Prefix      string
	Disabled    bool
	StorageJSON []byte
	Metadata    map[string]any
	Attributes  map[string]string
}

func Parse(provider, fileName string, raw []byte, sidecarPort int) (*Parsed, bool, error) {
	if !strings.EqualFold(strings.TrimSpace(provider), "codex") {
		return nil, false, nil
	}
	var projection Projection
	if err := json.Unmarshal(raw, &projection); err != nil {
		return nil, false, nil
	}
	if !strings.EqualFold(strings.TrimSpace(projection.Type), "codex") ||
		!strings.EqualFold(strings.TrimSpace(projection.AuthMode), AuthMode) {
		return nil, false, nil
	}
	if err := validateProjection(projection, fileName, sidecarPort); err != nil {
		return nil, true, err
	}
	if containsForbiddenPlaintextField(raw) {
		return nil, true, errors.New("credential projection contains a forbidden plaintext field")
	}
	fileName = filepath.Base(strings.TrimSpace(fileName))
	prefix := strings.Trim(strings.TrimSpace(projection.Prefix), "/")
	metadata := map[string]any{
		"auth_mode":     AuthMode,
		"credential_id": projection.CredentialID,
		"file_name":     fileName,
	}
	return &Parsed{
		ID:          fileName,
		FileName:    fileName,
		Label:       projection.CredentialID,
		Prefix:      prefix,
		Disabled:    projection.Disabled,
		StorageJSON: append([]byte(nil), raw...),
		Metadata:    metadata,
		Attributes: map[string]string{
			"api_key":    projection.AccessToken,
			"auth_mode":  AuthMode,
			"base_url":   projection.BaseURL,
			"websockets": "false",
		},
	}, true, nil
}

func validateProjection(projection Projection, fileName string, sidecarPort int) error {
	if !ValidCredentialID(projection.CredentialID) {
		return errors.New("credential projection id is invalid")
	}
	if !ValidOpaqueKey(projection.AccessToken) {
		return errors.New("credential projection opaque key is invalid")
	}
	if projection.Websockets {
		return errors.New("credential projection cannot enable websockets")
	}
	if sidecarPort < 1024 || sidecarPort > 65535 {
		return errors.New("credential sidecar port is invalid")
	}
	if err := validateBaseURL(projection.BaseURL, sidecarPort); err != nil {
		return err
	}
	rawFileName := strings.TrimSpace(fileName)
	fileName = filepath.Base(rawFileName)
	if rawFileName != fileName {
		return errors.New("credential projection file name must not contain a path")
	}
	if fileName == "." || !strings.HasPrefix(fileName, "credential-security-") || !strings.HasSuffix(strings.ToLower(fileName), ".json") {
		return errors.New("credential projection file name is invalid")
	}
	prefix := strings.Trim(strings.TrimSpace(projection.Prefix), "/")
	if strings.Contains(prefix, "/") {
		return errors.New("credential projection model prefix is invalid")
	}
	return nil
}

func validateBaseURL(value string, port int) error {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(value), "/"))
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("credential sidecar base URL is invalid")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "127.0.0.1" || parsed.Port() != strconv.Itoa(port) || parsed.EscapedPath() != URLPath {
		return errors.New("credential sidecar base URL must use the configured loopback endpoint")
	}
	if net.ParseIP(host) == nil {
		return errors.New("credential sidecar host is invalid")
	}
	return nil
}

func containsForbiddenPlaintextField(raw []byte) bool {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return true
	}
	for _, field := range []string{"token", "refresh_token", "id_token", "password", "cookie", "storage_json"} {
		if value, exists := object[field]; exists && len(value) != 0 && string(value) != "null" && string(value) != `""` {
			return true
		}
	}
	return false
}

func ValidCredentialID(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "cs-") || len(value) != len("cs-")+24 {
		return false
	}
	return isLowerHex(strings.TrimPrefix(value, "cs-"))
}

func ValidOpaqueKey(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, OpaqueKeyPrefix) || len(value) != len(OpaqueKeyPrefix)+64 {
		return false
	}
	return isLowerHex(strings.TrimPrefix(value, OpaqueKeyPrefix))
}

func FileName(credentialID string) (string, error) {
	if !ValidCredentialID(credentialID) {
		return "", fmt.Errorf("credential id is invalid")
	}
	return "credential-security-" + credentialID + ".json", nil
}

func isLowerHex(value string) bool {
	for _, character := range value {
		if !((character >= 'a' && character <= 'f') || (character >= '0' && character <= '9')) {
			return false
		}
	}
	return value != ""
}
