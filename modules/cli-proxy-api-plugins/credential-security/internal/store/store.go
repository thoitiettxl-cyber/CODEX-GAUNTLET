package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	keySize       = 32
	maxTokenBytes = 128 << 10
	maxRecords    = 4096
	version       = 1
)

type Store struct {
	dir         string
	aead        cipher.AEAD
	recordLimit int
	mu          sync.RWMutex
}

type PublicCredential struct {
	ID        string    `json:"id"`
	Label     string    `json:"label,omitempty"`
	Disabled  bool      `json:"disabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type diskRecord struct {
	Version       int    `json:"version"`
	ID            string `json:"id"`
	Label         string `json:"label,omitempty"`
	OpaqueKeyHash string `json:"opaque_key_hash"`
	Nonce         string `json:"nonce"`
	Ciphertext    string `json:"ciphertext"`
	Disabled      bool   `json:"disabled"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

type secretPayload struct {
	Token     string `json:"token"`
	OpaqueKey string `json:"opaque_key"`
}

type Credential struct {
	PublicCredential
	Token     string
	OpaqueKey string
}

func New(dir string, key []byte) (*Store, error) {
	if len(key) != keySize {
		return nil, errors.New("credential encryption key must contain exactly 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, errors.New("initialize credential encryption cipher")
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.New("initialize credential encryption mode")
	}
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, errors.New("credential store directory is required")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, errors.New("create credential store directory")
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("credential store path must be a real directory")
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, errors.New("protect credential store directory")
	}
	store := &Store{dir: dir, aead: aead, recordLimit: maxRecords}
	if err := store.validateRecords(); err != nil {
		return nil, err
	}
	return store, nil
}

func ParseKey(raw []byte) ([]byte, error) {
	if len(raw) == keySize {
		return append([]byte(nil), raw...), nil
	}
	raw = []byte(strings.TrimSpace(string(raw)))
	if decoded, err := hex.DecodeString(string(raw)); err == nil && len(decoded) == keySize {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(string(raw)); err == nil && len(decoded) == keySize {
		return decoded, nil
	}
	return nil, errors.New("credential encryption key must be raw, 64-char hex, or base64-encoded 32 bytes")
}

func (s *Store) Import(token, label string, now time.Time) (Credential, error) {
	token = strings.TrimSpace(token)
	if token == "" || len([]byte(token)) > maxTokenBytes {
		return Credential{}, errors.New("credential token is empty or too large")
	}
	id, err := randomID()
	if err != nil {
		return Credential{}, errors.New("generate credential id")
	}
	opaque, err := randomOpaqueKey()
	if err != nil {
		return Credential{}, errors.New("generate opaque credential key")
	}
	record, err := s.newRecord(id, label, token, opaque, true, now.UTC(), now.UTC())
	if err != nil {
		return Credential{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readRecordsLocked()
	if err != nil {
		return Credential{}, err
	}
	if len(records) >= s.recordLimit {
		return Credential{}, errors.New("credential store record limit exceeded")
	}
	if err := s.writeRecordLocked(record); err != nil {
		return Credential{}, err
	}
	return credentialFromRecord(record, token, opaque), nil
}

func (s *Store) Lookup(opaque string) (Credential, bool, error) {
	if s == nil || strings.TrimSpace(opaque) == "" {
		return Credential{}, false, nil
	}
	digest := sha256.Sum256([]byte(strings.TrimSpace(opaque)))
	want := hex.EncodeToString(digest[:])
	s.mu.RLock()
	records, err := s.readRecordsLocked()
	s.mu.RUnlock()
	if err != nil {
		return Credential{}, false, err
	}
	for _, record := range records {
		if subtle.ConstantTimeCompare([]byte(record.OpaqueKeyHash), []byte(want)) != 1 {
			continue
		}
		secret, err := s.decrypt(record)
		if err != nil {
			return Credential{}, false, err
		}
		return credentialFromRecord(record, secret.Token, secret.OpaqueKey), true, nil
	}
	return Credential{}, false, nil
}

func (s *Store) List() ([]PublicCredential, error) {
	s.mu.RLock()
	records, err := s.readRecordsLocked()
	s.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	result := make([]PublicCredential, 0, len(records))
	for _, record := range records {
		result = append(result, publicFromRecord(record))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (s *Store) Get(id string) (Credential, error) {
	s.mu.RLock()
	records, err := s.readRecordsLocked()
	s.mu.RUnlock()
	if err != nil {
		return Credential{}, err
	}
	for _, record := range records {
		if record.ID != strings.TrimSpace(id) {
			continue
		}
		secret, err := s.decrypt(record)
		if err != nil {
			return Credential{}, err
		}
		return credentialFromRecord(record, secret.Token, secret.OpaqueKey), nil
	}
	return Credential{}, errors.New("credential id not found")
}

func (s *Store) Rotate(id string, now time.Time) (Credential, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readRecordsLocked()
	if err != nil {
		return Credential{}, err
	}
	for _, record := range records {
		if record.ID != strings.TrimSpace(id) {
			continue
		}
		secret, err := s.decrypt(record)
		if err != nil {
			return Credential{}, err
		}
		opaque, err := randomOpaqueKey()
		if err != nil {
			return Credential{}, errors.New("generate rotated opaque key")
		}
		replacement, err := s.newRecord(record.ID, record.Label, secret.Token, opaque, record.Disabled, parseTime(record.CreatedAt), now.UTC())
		if err != nil {
			return Credential{}, err
		}
		if err := s.writeRecordLocked(replacement); err != nil {
			return Credential{}, err
		}
		return credentialFromRecord(replacement, secret.Token, opaque), nil
	}
	return Credential{}, errors.New("credential id not found")
}

func (s *Store) SetDisabled(id string, disabled bool, now time.Time) (PublicCredential, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readRecordsLocked()
	if err != nil {
		return PublicCredential{}, err
	}
	for _, record := range records {
		if record.ID != strings.TrimSpace(id) {
			continue
		}
		secret, err := s.decrypt(record)
		if err != nil {
			return PublicCredential{}, err
		}
		replacement, err := s.newRecord(record.ID, record.Label, secret.Token, secret.OpaqueKey, disabled, parseTime(record.CreatedAt), now.UTC())
		if err != nil {
			return PublicCredential{}, err
		}
		if err := s.writeRecordLocked(replacement); err != nil {
			return PublicCredential{}, err
		}
		return publicFromRecord(replacement), nil
	}
	return PublicCredential{}, errors.New("credential id not found")
}

func (s *Store) Delete(id string) error {
	if s == nil {
		return errors.New("credential store is nil")
	}
	name, err := recordFileName(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(filepath.Join(s.dir, name)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return errors.New("credential id not found")
		}
		return errors.New("delete credential record")
	}
	return syncDir(s.dir)
}

func (s *Store) newRecord(id, label, token, opaque string, disabled bool, created, updated time.Time) (diskRecord, error) {
	digest := sha256.Sum256([]byte(opaque))
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return diskRecord{}, errors.New("generate credential nonce")
	}
	plaintext, err := json.Marshal(secretPayload{Token: token, OpaqueKey: opaque})
	if err != nil {
		return diskRecord{}, errors.New("encode credential secret payload")
	}
	ciphertext := s.aead.Seal(nil, nonce, plaintext, aad(id))
	return diskRecord{
		Version:       version,
		ID:            id,
		Label:         strings.TrimSpace(label),
		OpaqueKeyHash: hex.EncodeToString(digest[:]),
		Nonce:         base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext:    base64.RawStdEncoding.EncodeToString(ciphertext),
		Disabled:      disabled,
		CreatedAt:     created.UTC().Format(time.RFC3339Nano),
		UpdatedAt:     updated.UTC().Format(time.RFC3339Nano),
	}, nil
}

func (s *Store) decrypt(record diskRecord) (secretPayload, error) {
	nonce, err := base64.RawStdEncoding.DecodeString(record.Nonce)
	if err != nil || len(nonce) != s.aead.NonceSize() {
		return secretPayload{}, errors.New("credential nonce is invalid")
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(record.Ciphertext)
	if err != nil || len(ciphertext) < s.aead.Overhead() {
		return secretPayload{}, errors.New("credential ciphertext is invalid")
	}
	plaintext, err := s.aead.Open(nil, nonce, ciphertext, aad(record.ID))
	if err != nil {
		return secretPayload{}, errors.New("credential ciphertext authentication failed")
	}
	var secret secretPayload
	if err := json.Unmarshal(plaintext, &secret); err != nil || strings.TrimSpace(secret.Token) == "" || len(secret.Token) > maxTokenBytes || strings.TrimSpace(secret.OpaqueKey) == "" {
		return secretPayload{}, errors.New("credential plaintext is invalid")
	}
	digest := sha256.Sum256([]byte(secret.OpaqueKey))
	if subtle.ConstantTimeCompare([]byte(record.OpaqueKeyHash), []byte(hex.EncodeToString(digest[:]))) != 1 {
		return secretPayload{}, errors.New("credential opaque key authentication failed")
	}
	return secret, nil
}

func (s *Store) validateRecords() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.readRecordsLocked()
	if err != nil {
		return err
	}
	for _, record := range records {
		if _, err := s.decrypt(record); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) readRecordsLocked() ([]diskRecord, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, errors.New("read credential store")
	}
	result := make([]diskRecord, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "credential-") || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return nil, errors.New("credential record must be a regular file")
		}
		if len(result) >= maxRecords {
			return nil, errors.New("credential store record limit exceeded")
		}
		raw, err := os.ReadFile(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			return nil, errors.New("read credential record")
		}
		var record diskRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, errors.New("credential record is invalid")
		}
		expectedName, err := recordFileName(record.ID)
		if err != nil || expectedName != entry.Name() || record.Version != version || len(record.OpaqueKeyHash) != sha256.Size*2 || parseTime(record.CreatedAt).IsZero() || parseTime(record.UpdatedAt).IsZero() {
			return nil, errors.New("credential record is invalid")
		}
		result = append(result, record)
	}
	return result, nil
}

func (s *Store) writeRecordLocked(record diskRecord) error {
	name, err := recordFileName(record.ID)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return errors.New("encode credential record")
	}
	temporary, err := os.CreateTemp(s.dir, ".credential-*.tmp")
	if err != nil {
		return errors.New("create credential record temp file")
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return errors.New("protect credential record temp file")
	}
	if _, err := temporary.Write(raw); err != nil {
		_ = temporary.Close()
		return errors.New("write credential record")
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return errors.New("sync credential record")
	}
	if err := temporary.Close(); err != nil {
		return errors.New("close credential record")
	}
	if err := os.Rename(temporaryName, filepath.Join(s.dir, name)); err != nil {
		return errors.New("replace credential record")
	}
	return syncDir(s.dir)
}

func recordFileName(id string) (string, error) {
	if !strings.HasPrefix(id, "cs-") || len(id) != len("cs-")+24 {
		return "", errors.New("credential id is invalid")
	}
	for _, character := range strings.TrimPrefix(id, "cs-") {
		if !((character >= 'a' && character <= 'f') || (character >= '0' && character <= '9')) {
			return "", errors.New("credential id is invalid")
		}
	}
	return "credential-" + id + ".json", nil
}

func publicFromRecord(record diskRecord) PublicCredential {
	return PublicCredential{ID: record.ID, Label: record.Label, Disabled: record.Disabled, CreatedAt: parseTime(record.CreatedAt), UpdatedAt: parseTime(record.UpdatedAt)}
}

func credentialFromRecord(record diskRecord, token, opaque string) Credential {
	return Credential{PublicCredential: publicFromRecord(record), Token: token, OpaqueKey: opaque}
}

func randomID() (string, error) {
	raw := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", err
	}
	return "cs-" + hex.EncodeToString(raw), nil
}

func randomOpaqueKey() (string, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", err
	}
	return "cpcs_" + hex.EncodeToString(raw), nil
}

func aad(id string) []byte { return []byte("credential-security:v1:" + id) }

func parseTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func syncDir(dir string) error {
	handle, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("open credential store directory: %w", err)
	}
	defer handle.Close()
	return handle.Sync()
}
