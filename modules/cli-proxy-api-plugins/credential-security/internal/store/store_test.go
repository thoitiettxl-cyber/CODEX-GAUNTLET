package store

import (
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEncryptedStoreSurvivesRestartAndNeverPersistsSecrets(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{0x2a}, 32)
	credentialStore, err := New(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 28, 18, 0, 0, 0, time.UTC)
	imported, err := credentialStore.Import("at-sensitive-test-token", "lab", now)
	if err != nil {
		t.Fatal(err)
	}
	if !imported.Disabled {
		t.Fatal("new credential must be disabled by default")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries=%d err=%v", len(entries), err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"at-sensitive-test-token", imported.OpaqueKey} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("credential record persisted secret %q", forbidden)
		}
	}
	info, err := os.Stat(filepath.Join(dir, entries[0].Name()))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%v err=%v", info.Mode().Perm(), err)
	}
	restarted, err := New(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	got, found, err := restarted.Lookup(imported.OpaqueKey)
	if err != nil || !found || got.Token != "at-sensitive-test-token" || got.ID != imported.ID {
		t.Fatalf("found=%v got=%#v err=%v", found, got, err)
	}
	if _, err := New(dir, bytes.Repeat([]byte{0x33}, 32)); err == nil {
		t.Fatal("wrong encryption key accepted")
	}
}

func TestRotateDisableAndDeleteAreBounded(t *testing.T) {
	credentialStore, err := New(t.TempDir(), bytes.Repeat([]byte{0x11}, 32))
	if err != nil {
		t.Fatal(err)
	}
	imported, err := credentialStore.Import("static-token", "primary", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := credentialStore.SetDisabled(imported.ID, false, time.Now()); err != nil {
		t.Fatal(err)
	}
	active, found, err := credentialStore.Lookup(imported.OpaqueKey)
	if err != nil || !found || active.Disabled {
		t.Fatalf("found=%v active=%#v err=%v", found, active, err)
	}
	rotated, err := credentialStore.Rotate(imported.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if rotated.OpaqueKey == imported.OpaqueKey || rotated.Disabled {
		t.Fatalf("unexpected rotation: %#v", rotated)
	}
	if _, found, err := credentialStore.Lookup(imported.OpaqueKey); err != nil || found {
		t.Fatalf("old opaque key remained active: found=%v err=%v", found, err)
	}
	if got, found, err := credentialStore.Lookup(rotated.OpaqueKey); err != nil || !found || got.Token != "static-token" {
		t.Fatalf("rotated lookup found=%v got=%#v err=%v", found, got, err)
	}
	if err := credentialStore.Delete(imported.ID); err != nil {
		t.Fatal(err)
	}
	if records, err := credentialStore.List(); err != nil || len(records) != 0 {
		t.Fatalf("records=%#v err=%v", records, err)
	}
}

func TestImportEnforcesRecordLimit(t *testing.T) {
	credentialStore, err := New(t.TempDir(), bytes.Repeat([]byte{0x66}, 32))
	if err != nil {
		t.Fatal(err)
	}
	credentialStore.recordLimit = 1
	if _, err = credentialStore.Import("first-token", "first", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err = credentialStore.Import("second-token", "second", time.Now()); err == nil || !strings.Contains(err.Error(), "record limit") {
		t.Fatalf("second import err=%v, want record limit rejection", err)
	}
	if records, listErr := credentialStore.List(); listErr != nil || len(records) != 1 {
		t.Fatalf("records=%#v err=%v", records, listErr)
	}
}

func TestParseKeyAcceptsOwnerFileFormats(t *testing.T) {
	key := bytes.Repeat([]byte{0xab}, 32)
	for name, raw := range map[string][]byte{
		"raw": key,
		"hex": []byte(hex.EncodeToString(key) + "\n"),
	} {
		t.Run(name, func(t *testing.T) {
			parsed, err := ParseKey(raw)
			if err != nil || !bytes.Equal(parsed, key) {
				t.Fatalf("parsed=%x err=%v", parsed, err)
			}
		})
	}
	if _, err := ParseKey([]byte("short")); err == nil {
		t.Fatal("short key accepted")
	}
}
