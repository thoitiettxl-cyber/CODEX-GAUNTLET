package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSecretFileRequiresOwnerOnlyRegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := os.WriteFile(path, []byte("test-secret-value"), 0o600); err != nil {
		t.Fatal(err)
	}
	if value, err := readSecretFile(path); err != nil || string(value) != "test-secret-value" {
		t.Fatalf("owner-only file rejected: err=%v", err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readSecretFile(path); err == nil {
		t.Fatal("group/world-readable secret file accepted")
	}
	link := filepath.Join(dir, "secret-link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readSecretFile(link); err == nil {
		t.Fatal("secret symlink accepted")
	}
}
