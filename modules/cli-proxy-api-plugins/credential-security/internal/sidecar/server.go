package sidecar

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/credential"
	credentialstore "github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/store"
)

const (
	ManagementPrefix = "/v0/credential-security"
	maxRequestBytes  = 16 << 20
	maxManageBytes   = 256 << 10
)

type Config struct {
	ManagementKey     []byte
	ProjectionBaseURL string
	UpstreamURL       string
	AllowTestUpstream bool
	Store             *credentialstore.Store
	HTTPClient        *http.Client
}

type Server struct {
	managementKey []byte
	projectionURL string
	upstream      *url.URL
	store         *credentialstore.Store
	client        *http.Client
}

type importRequest struct {
	Token string `json:"token"`
	Label string `json:"label,omitempty"`
}

type actionRequest struct {
	Action string `json:"action"`
}

type projectionResponse struct {
	Credential credentialstore.PublicCredential `json:"credential"`
	Projection credential.Projection            `json:"projection"`
}

func New(config Config) (*Server, error) {
	if len(config.ManagementKey) < 8 {
		return nil, errors.New("sidecar management key must contain at least 8 bytes")
	}
	if config.Store == nil {
		return nil, errors.New("sidecar credential store is required")
	}
	projectionURL, err := validateProjectionURL(config.ProjectionBaseURL)
	if err != nil {
		return nil, err
	}
	upstream, err := validateUpstreamURL(config.UpstreamURL, config.AllowTestUpstream)
	if err != nil {
		return nil, err
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: 0,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	return &Server{
		managementKey: append([]byte(nil), config.ManagementKey...),
		projectionURL: projectionURL,
		upstream:      upstream,
		store:         config.Store,
		client:        client,
	}, nil
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if strings.HasPrefix(request.URL.Path, ManagementPrefix) {
		s.serveManagement(response, request)
		return
	}
	if request.URL.Path == credential.URLPath || strings.HasPrefix(request.URL.Path, credential.URLPath+"/") {
		s.serveProxy(response, request)
		return
	}
	writeError(response, http.StatusNotFound, "route_not_found", "route not found")
}

func (s *Server) serveManagement(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	if !s.authorized(request.Header.Get("X-Management-Key")) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "management authentication required")
		return
	}
	path := strings.TrimSuffix(request.URL.Path, "/")
	switch {
	case path == ManagementPrefix+"/status" && request.Method == http.MethodGet:
		records, err := s.store.List()
		if err != nil {
			writeError(response, http.StatusInternalServerError, "store_unavailable", "credential store unavailable")
			return
		}
		active := 0
		for _, record := range records {
			if !record.Disabled {
				active++
			}
		}
		writeJSON(response, http.StatusOK, map[string]any{"service": "credential-security-sidecar", "version": "0.1.0", "credential_count": len(records), "active_count": active, "projection_base_url": s.projectionURL})
	case path == ManagementPrefix+"/credentials" && request.Method == http.MethodGet:
		records, err := s.store.List()
		if err != nil {
			writeError(response, http.StatusInternalServerError, "store_unavailable", "credential store unavailable")
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{"credentials": records})
	case path == ManagementPrefix+"/credentials/import" && request.Method == http.MethodPost:
		s.importCredential(response, request)
	case strings.HasPrefix(path, ManagementPrefix+"/credentials/"):
		s.manageCredential(response, request, strings.TrimPrefix(path, ManagementPrefix+"/credentials/"))
	default:
		writeError(response, http.StatusNotFound, "route_not_found", "management route not found")
	}
}

func (s *Server) importCredential(response http.ResponseWriter, request *http.Request) {
	var payload importRequest
	if err := decodeJSON(request.Body, &payload, maxManageBytes); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "credential import request is invalid")
		return
	}
	created, err := s.store.Import(payload.Token, payload.Label, time.Now())
	if err != nil {
		writeError(response, http.StatusBadRequest, "import_failed", err.Error())
		return
	}
	projection, err := s.projection(created)
	if err != nil {
		_ = s.store.Delete(created.ID)
		writeError(response, http.StatusInternalServerError, "projection_failed", "credential projection failed")
		return
	}
	writeJSON(response, http.StatusCreated, projectionResponse{Credential: created.PublicCredential, Projection: projection})
}

func (s *Server) manageCredential(response http.ResponseWriter, request *http.Request, suffix string) {
	parts := strings.Split(suffix, "/")
	if len(parts) == 1 && request.Method == http.MethodDelete {
		if err := s.store.Delete(parts[0]); err != nil {
			writeError(response, http.StatusNotFound, "credential_not_found", "credential not found")
			return
		}
		response.WriteHeader(http.StatusNoContent)
		return
	}
	if len(parts) != 2 || parts[1] != "actions" || request.Method != http.MethodPost {
		writeError(response, http.StatusNotFound, "route_not_found", "credential route not found")
		return
	}
	var payload actionRequest
	if err := decodeJSON(request.Body, &payload, 4096); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "credential action request is invalid")
		return
	}
	switch strings.ToLower(strings.TrimSpace(payload.Action)) {
	case "enable", "disable":
		disabled := strings.EqualFold(strings.TrimSpace(payload.Action), "disable")
		updated, err := s.store.SetDisabled(parts[0], disabled, time.Now())
		if err != nil {
			writeError(response, http.StatusNotFound, "credential_not_found", "credential not found")
			return
		}
		full, err := s.store.Get(parts[0])
		if err != nil {
			writeError(response, http.StatusInternalServerError, "store_unavailable", "credential store unavailable")
			return
		}
		projection, err := s.projection(full)
		if err != nil {
			writeError(response, http.StatusInternalServerError, "projection_failed", "credential projection failed")
			return
		}
		writeJSON(response, http.StatusOK, projectionResponse{Credential: updated, Projection: projection})
	case "rotate":
		rotated, err := s.store.Rotate(parts[0], time.Now())
		if err != nil {
			writeError(response, http.StatusNotFound, "credential_not_found", "credential not found")
			return
		}
		projection, err := s.projection(rotated)
		if err != nil {
			writeError(response, http.StatusInternalServerError, "projection_failed", "credential projection failed")
			return
		}
		writeJSON(response, http.StatusOK, projectionResponse{Credential: rotated.PublicCredential, Projection: projection})
	default:
		writeError(response, http.StatusBadRequest, "invalid_action", "credential action must be enable, disable, or rotate")
	}
}

func (s *Server) projection(stored credentialstore.Credential) (credential.Projection, error) {
	parsed, err := url.Parse(s.projectionURL)
	if err != nil {
		return credential.Projection{}, errors.New("projection base URL is invalid")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		return credential.Projection{}, errors.New("projection port is invalid")
	}
	projection := credential.Projection{Type: "codex", AuthMode: credential.AuthMode, AccessToken: stored.OpaqueKey, BaseURL: s.projectionURL, CredentialID: stored.ID, Disabled: stored.Disabled, Websockets: false}
	raw, err := json.Marshal(projection)
	if err != nil {
		return credential.Projection{}, errors.New("encode credential projection")
	}
	fileName, err := credential.FileName(stored.ID)
	if err != nil {
		return credential.Projection{}, err
	}
	if _, handled, err := credential.Parse("codex", fileName, raw, port); err != nil || !handled {
		return credential.Projection{}, errors.New("credential projection self-check failed")
	}
	return projection, nil
}

func (s *Server) serveProxy(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost && request.Method != http.MethodGet {
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "proxy method not allowed")
		return
	}
	suffix, validPath := proxyPathSuffix(request.URL.Path)
	if !validPath {
		writeError(response, http.StatusBadRequest, "invalid_proxy_path", "proxy path is invalid")
		return
	}
	opaque := bearerToken(request.Header.Get("Authorization"))
	if !credential.ValidOpaqueKey(opaque) {
		writeError(response, http.StatusUnauthorized, "invalid_credential", "opaque credential is invalid")
		return
	}
	stored, found, err := s.store.Lookup(opaque)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "store_unavailable", "credential store unavailable")
		return
	}
	if !found || stored.Disabled {
		writeError(response, http.StatusForbidden, "credential_unavailable", "credential is unavailable")
		return
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maxRequestBytes+1))
	if err != nil || len(body) > maxRequestBytes {
		writeError(response, http.StatusRequestEntityTooLarge, "request_too_large", "proxy request body is too large")
		return
	}
	target := *s.upstream
	target.Path = strings.TrimRight(s.upstream.Path, "/") + suffix
	target.RawQuery = request.URL.RawQuery
	upstreamRequest, err := http.NewRequestWithContext(request.Context(), request.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		writeError(response, http.StatusBadGateway, "upstream_request_failed", "upstream request failed")
		return
	}
	copyRequestHeaders(upstreamRequest.Header, request.Header)
	upstreamRequest.Header.Set("Authorization", "Bearer "+stored.Token)
	upstreamResponse, err := s.client.Do(upstreamRequest)
	if err != nil {
		writeError(response, http.StatusBadGateway, "upstream_unavailable", "upstream unavailable")
		return
	}
	defer upstreamResponse.Body.Close()
	copyResponseHeaders(response.Header(), upstreamResponse.Header)
	response.WriteHeader(upstreamResponse.StatusCode)
	streamCopy(response, upstreamResponse.Body)
}

func proxyPathSuffix(requestPath string) (string, bool) {
	if requestPath == credential.URLPath {
		return "", true
	}
	if !strings.HasPrefix(requestPath, credential.URLPath+"/") {
		return "", false
	}
	suffix := strings.TrimPrefix(requestPath, credential.URLPath)
	for _, segment := range strings.Split(suffix, "/") {
		if segment == "." || segment == ".." {
			return "", false
		}
	}
	return suffix, true
}

func (s *Server) authorized(value string) bool {
	value = strings.TrimSpace(value)
	return len(value) == len(s.managementKey) && subtle.ConstantTimeCompare([]byte(value), s.managementKey) == 1
}

func validateProjectionURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" || parsed.Path != credential.URLPath || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("projection base URL must be an exact loopback credential endpoint")
	}
	return parsed.String(), nil
}

func validateUpstreamURL(raw string, allowTest bool) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != credential.URLPath {
		return nil, errors.New("upstream URL is invalid")
	}
	if parsed.Scheme == "https" && strings.EqualFold(parsed.Hostname(), "chatgpt.com") && parsed.Port() == "" {
		return parsed, nil
	}
	if allowTest && parsed.Scheme == "http" && net.ParseIP(parsed.Hostname()).IsLoopback() && parsed.Port() != "" {
		return parsed, nil
	}
	return nil, errors.New("upstream URL must be the fixed HTTPS Codex origin")
}

func bearerToken(value string) string {
	parts := strings.Fields(strings.TrimSpace(value))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

func decodeJSON(reader io.Reader, target any, limit int64) error {
	decoder := json.NewDecoder(io.LimitReader(reader, limit+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("multiple JSON values are not allowed")
	}
	return nil
}

func copyRequestHeaders(target, source http.Header) {
	for name, values := range source {
		if blockedHeader(name) || strings.EqualFold(name, "Cookie") || strings.EqualFold(name, "X-Management-Key") {
			continue
		}
		for _, value := range values {
			target.Add(name, value)
		}
	}
}

func copyResponseHeaders(target, source http.Header) {
	for name, values := range source {
		if blockedHeader(name) || strings.EqualFold(name, "Set-Cookie") {
			continue
		}
		for _, value := range values {
			target.Add(name, value)
		}
	}
}

func blockedHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "authorization", "api-key", "x-api-key", "x-goog-api-key", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func streamCopy(response http.ResponseWriter, source io.Reader) {
	buffer := make([]byte, 32<<10)
	for {
		count, err := source.Read(buffer)
		if count > 0 {
			_, _ = response.Write(buffer[:count])
			if flusher, ok := response.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]any{"error": code, "message": message})
}

func Serve(ctx context.Context, listener net.Listener, handler http.Handler) error {
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	err := server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return fmt.Errorf("serve credential sidecar: %w", err)
}
