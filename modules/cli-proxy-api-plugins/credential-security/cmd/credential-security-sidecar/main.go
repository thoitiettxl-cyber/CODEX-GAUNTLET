package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/sidecar"
	credentialstore "github.com/thoitiettxl-cyber/codex-gauntlet-termux/modules/cli-proxy-api-plugins/credential-security/internal/store"
)

const (
	defaultListen   = "127.0.0.1:18319"
	defaultUpstream = "https://chatgpt.com/backend-api/codex"
)

func main() {
	listen := flag.String("listen", defaultListen, "loopback listen address")
	dataDir := flag.String("data-dir", "", "owner-only encrypted credential store directory")
	keyFile := flag.String("key-file", "", "owner-only 32-byte encryption key file")
	managementKeyFile := flag.String("management-key-file", "", "owner-only sidecar management key file")
	upstream := flag.String("upstream", defaultUpstream, "fixed HTTPS Codex upstream; loopback HTTP only with --allow-test-upstream")
	allowTestUpstream := flag.Bool("allow-test-upstream", false, "allow a loopback HTTP upstream for isolated tests")
	flag.Parse()

	if err := run(*listen, *dataDir, *keyFile, *managementKeyFile, *upstream, *allowTestUpstream); err != nil {
		fmt.Fprintln(os.Stderr, "credential-security-sidecar:", err)
		os.Exit(1)
	}
}

func run(listen, dataDir, keyFile, managementKeyFile, upstream string, allowTestUpstream bool) error {
	if strings.TrimSpace(dataDir) == "" || strings.TrimSpace(keyFile) == "" || strings.TrimSpace(managementKeyFile) == "" {
		return fmt.Errorf("--data-dir, --key-file, and --management-key-file are required")
	}
	key, err := readSecretFile(keyFile)
	if err != nil {
		return fmt.Errorf("read encryption key: %w", err)
	}
	parsedKey, err := credentialstore.ParseKey(key)
	if err != nil {
		return err
	}
	managementKey, err := readSecretFile(managementKeyFile)
	if err != nil {
		return fmt.Errorf("read management key: %w", err)
	}
	managementKey = bytes.TrimSpace(managementKey)
	credentialStore, err := credentialstore.New(dataDir, parsedKey)
	if err != nil {
		return err
	}
	projectionURL := "http://" + listen + "/backend-api/codex"
	service, err := sidecar.New(sidecar.Config{ManagementKey: managementKey, ProjectionBaseURL: projectionURL, UpstreamURL: upstream, AllowTestUpstream: allowTestUpstream, Store: credentialStore})
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	defer listener.Close()
	if !listener.Addr().(*net.TCPAddr).IP.IsLoopback() {
		return fmt.Errorf("listen address must be loopback")
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return sidecar.Serve(ctx, listener, service)
}

func readSecretFile(path string) ([]byte, error) {
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !pathInfo.Mode().IsRegular() || pathInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("secret file must be a regular non-symlink file")
	}
	handle, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	info, err := handle.Stat()
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("secret file permissions must be owner-only")
	}
	value, err := io.ReadAll(io.LimitReader(handle, 4097))
	if err != nil {
		return nil, err
	}
	if len(value) == 0 || len(value) > 4096 {
		return nil, fmt.Errorf("secret file is empty or too large")
	}
	return value, nil
}
