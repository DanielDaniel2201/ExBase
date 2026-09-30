package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTraceAppendAndRedaction(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := &App{root: t.TempDir()}
	path := filepath.Join(app.root, "diagram.excalidraw")
	id, err := app.CreateAISession(path)
	if err != nil {
		t.Fatal(err)
	}
	other, err := app.CreateAISession(path)
	if err != nil || id == other {
		t.Fatal("new chat must have a separate trace", err)
	}
	if _, err := sessionFile("../../outside"); err == nil {
		t.Fatal("unsafe session ID accepted")
	}
	trace, err := openAITrace(id, "private-key")
	if err != nil {
		t.Fatal(err)
	}
	if err := trace.write("request", map[string]any{"messages": []any{map[string]any{"text": "private-key in text", "image_url": map[string]string{"url": "data:image/png;base64,test-image"}}}, "Authorization": "Bearer another-key", "api_key": "another-key"}); err != nil {
		t.Fatal(err)
	}
	trace.file.Close()
	trace, err = openAITrace(id, "private-key")
	if err != nil {
		t.Fatal(err)
	}
	if err := trace.write("response", map[string]string{"reply": "Done"}); err != nil {
		t.Fatal(err)
	}
	trace.file.Close()
	tracePath, _ := sessionFile(id)
	data, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "private-key") || strings.Contains(string(data), "another-key") || strings.Contains(string(data), "test-image") {
		t.Fatal("trace leaked a secret or image payload")
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 3 {
		t.Fatal("trace was overwritten instead of appended")
	}
	for _, line := range lines {
		if !json.Valid([]byte(line)) {
			t.Fatal("invalid JSONL record")
		}
	}
	if err := trace.write("after_close", nil); err == nil {
		t.Fatal("trace write failures must be reported")
	}
}
