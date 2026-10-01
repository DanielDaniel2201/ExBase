package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type aiTrace struct {
	file      *os.File
	sessionID string
	turnID    string
	key       string
}

func sessionFile(id string) (string, error) {
	if len(id) != 32 {
		return "", errors.New("invalid AI session ID")
	}
	if _, err := hex.DecodeString(id); err != nil {
		return "", errors.New("invalid AI session ID")
	}
	home, err := os.UserHomeDir()
	return filepath.Join(home, ".exbase", "sessions", id+".jsonl"), err
}

func newTraceID() string {
	var id [16]byte
	rand.Read(id[:])
	return hex.EncodeToString(id[:])
}

func (a *App) CreateAISession(path string) (string, error) {
	if !a.contains(path) || !strings.EqualFold(filepath.Ext(path), ".excalidraw") {
		return "", errors.New("open an Excalidraw document first")
	}
	id := newTraceID()
	filePath, err := sessionFile(id)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0700); err != nil {
		return "", err
	}
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer file.Close()
	trace := &aiTrace{file: file, sessionID: id}
	config, err := loadAIConfig()
	if err != nil {
		return "", err
	}
	if err := trace.write("session_start", map[string]any{"document_path": path, "model": "deepseek-flash", "reasoning_effort": config.ReasoningEffort}); err != nil {
		return "", err
	}
	return id, nil
}

func openAITrace(id, key string) (*aiTrace, error) {
	path, err := sessionFile(id)
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("cannot open AI trace: %w", err)
	}
	return &aiTrace{file: file, sessionID: id, turnID: newTraceID(), key: key}, nil
}

func redactTrace(value any) any {
	switch value := value.(type) {
	case map[string]any:
		for key, item := range value {
			normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
			switch normalized {
			case "authorization", "apikey", "accesstoken", "refreshtoken", "password", "secret":
				value[key] = "[REDACTED_SECRET]"
			default:
				value[key] = redactTrace(item)
			}
		}
	case []any:
		for i, item := range value {
			value[i] = redactTrace(item)
		}
	case string:
		if strings.HasPrefix(value, "data:image/") {
			return fmt.Sprintf("[image omitted: %d bytes]", len(value))
		}
	}
	return value
}

func (t *aiTrace) write(event string, data any) error {
	if t == nil {
		return nil
	}
	encoded, err := json.Marshal(map[string]any{"time": time.Now().UTC().Format(time.RFC3339Nano), "session_id": t.sessionID, "turn_id": t.turnID, "event": event, "data": data})
	if err != nil {
		return err
	}
	var safe any
	if err := json.Unmarshal(encoded, &safe); err != nil {
		return err
	}
	encoded, err = json.Marshal(redactTrace(safe))
	if err != nil {
		return err
	}
	if t.key != "" {
		secret, _ := json.Marshal(t.key)
		encoded = bytes.ReplaceAll(encoded, secret[1:len(secret)-1], []byte("[REDACTED_SECRET]"))
	}
	if _, err := t.file.Write(append(encoded, '\n')); err != nil {
		return fmt.Errorf("cannot write AI trace: %w", err)
	}
	return nil
}
