package app

import (
	"bytes"
	"encoding/json"
	"exbase/internal/workspace"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestAIProviderMigrationAndSelection(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	path, _ := authFile()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	legacy := []byte(`{"deepseek":{"type":"api_key","apiKey":"legacy-key","reasoningEffort":"none"}}`)
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	settings, err := app.LoadAISettings()
	if err != nil || len(settings.Providers) != 1 || settings.ActiveProviderID != "deepseek" || settings.APIKey != "legacy-key" || settings.ReasoningEffort != "none" {
		t.Fatal("legacy configuration was not preserved", err)
	}
	unchanged, _ := os.ReadFile(path)
	if !bytes.Equal(legacy, unchanged) {
		t.Fatal("loading must not overwrite existing credentials")
	}
	custom := AIProvider{ID: "custom", Name: " My provider ", BaseURL: " https://provider.example/v1/ ", Model: " deepseek/deepseek-v4.1-flash ", APIKey: " custom-key "}
	settings, err = app.SaveAIProviders(append(settings.Providers, custom), custom.ID)
	if err != nil {
		t.Fatal(err)
	}
	config, err := loadAIConfig()
	if err != nil || config.ID != "custom" || config.BaseURL != "https://provider.example/v1" || config.Model != "deepseek/deepseek-v4.1-flash" || config.APIKey != "custom-key" || config.ReasoningEffort != "none" {
		t.Fatal("active provider was not loaded", err)
	}
	reloaded, err := app.LoadAISettings()
	if err != nil || !reflect.DeepEqual(settings, reloaded) || !reloaded.HasAPIKey {
		t.Fatal("provider configuration did not persist", err)
	}
	settings, err = app.SaveAIProviders(settings.Providers, "deepseek")
	if err != nil || settings.APIKey != "legacy-key" {
		t.Fatal("switching providers lost the official key", err)
	}
	settings, err = app.SaveAIProviders(settings.Providers[:1], "deepseek")
	if err != nil || len(settings.Providers) != 1 || settings.APIKey != "legacy-key" {
		t.Fatal("deleting a provider lost the preset", err)
	}
	settings.Providers[0].APIKey = ""
	settings, err = app.SaveAIProviders(settings.Providers, "deepseek")
	if err != nil || settings.HasAPIKey || settings.APIKey != "" {
		t.Fatal("clearing credentials was not persisted", err)
	}
}

func TestAIProviderValidationPreservesSettings(t *testing.T) {
	t.Setenv("USERPROFILE", t.TempDir())
	t.Setenv("HOME", os.Getenv("USERPROFILE"))
	app := NewApp()
	if _, err := app.SaveAISettings("original-key", "high"); err != nil {
		t.Fatal(err)
	}
	path, _ := authFile()
	original, _ := os.ReadFile(path)
	for _, change := range []struct {
		name string
		edit func(*aiAuth)
	}{
		{"URL scheme", func(a *aiAuth) { a.Providers[1].BaseURL = "file:///tmp" }},
		{"URL credentials", func(a *aiAuth) { a.Providers[1].BaseURL = "https://user:secret@provider.example" }},
		{"URL query", func(a *aiAuth) { a.Providers[1].BaseURL += "?key=secret" }},
		{"URL fragment", func(a *aiAuth) { a.Providers[1].BaseURL += "#fragment" }},
		{"full endpoint", func(a *aiAuth) { a.Providers[1].BaseURL += "/chat/completions" }},
		{"missing model", func(a *aiAuth) { a.Providers[1].Model = " " }},
		{"header injection", func(a *aiAuth) { a.Providers[1].APIKey = "bad\r\nheader" }},
		{"missing name", func(a *aiAuth) { a.Providers[1].Name = " " }},
		{"long name", func(a *aiAuth) { a.Providers[1].Name = strings.Repeat("n", 81) }},
		{"duplicate ID", func(a *aiAuth) { a.Providers = append(a.Providers, a.Providers[1]) }},
		{"invalid active ID", func(a *aiAuth) { a.ActiveProviderID = "missing" }},
		{"remove preset", func(a *aiAuth) { a.Providers = a.Providers[1:] }},
		{"change preset", func(a *aiAuth) { a.Providers[0].BaseURL = "https://provider.example" }},
	} {
		t.Run(change.name, func(t *testing.T) {
			auth := aiAuth{Providers: []AIProvider{officialAIProvider(), {ID: "custom", Name: "Custom", BaseURL: "https://provider.example/v1", Model: "flash", APIKey: "custom-key"}}, ActiveProviderID: "custom"}
			change.edit(&auth)
			if _, err := app.SaveAIProviders(auth.Providers, auth.ActiveProviderID); err == nil {
				t.Fatal("invalid provider configuration accepted")
			}
			data, _ := os.ReadFile(path)
			if !bytes.Equal(original, data) {
				t.Fatal("invalid save replaced existing credentials")
			}
		})
	}
	if err := os.WriteFile(path, []byte("invalid JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.SaveAIProviders([]AIProvider{officialAIProvider()}, "deepseek"); err == nil {
		t.Fatal("a corrupt auth file must not be silently overwritten")
	}
}

// Opt-in real-provider check; credentials, sessions, and the canvas stay in temporary directories.
func TestLiveAIProvider(t *testing.T) {
	key := os.Getenv("EXBASE_LIVE_PROVIDER_KEY")
	baseURL := os.Getenv("EXBASE_LIVE_PROVIDER_URL")
	model := os.Getenv("EXBASE_LIVE_PROVIDER_MODEL")
	if key == "" || baseURL == "" || model == "" {
		t.Skip("set EXBASE_LIVE_PROVIDER_KEY, EXBASE_LIVE_PROVIDER_URL, and EXBASE_LIVE_PROVIDER_MODEL")
	}
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := &App{Workspace: workspace.New(t.TempDir())}
	provider := AIProvider{ID: "live-check", Name: "Live check", BaseURL: baseURL, Model: model, APIKey: key}
	if _, err := app.SaveAIProviders([]AIProvider{officialAIProvider(), provider}, provider.ID); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []struct{ name, effort string }{{"Fast", "none"}, {"Stable", "high"}} {
		t.Run(mode.name, func(t *testing.T) {
			path := filepath.Join(app.Workspaces().Current, "provider-check.excalidraw")
			session, err := app.CreateAISession(path)
			if err != nil {
				t.Fatal(err)
			}
			started := time.Now()
			result, err := app.AskAI(path, `{"elements":[]}`, "", "Draw one small rectangle labeled Test. Use create_view. Keep it simple; no additional shapes or explanation.", "", nil, session, "live-provider-check", mode.effort)
			if err != nil {
				t.Fatal(strings.ReplaceAll(err.Error(), key, "[REDACTED_SECRET]"))
			}
			var elements []map[string]any
			if err := json.Unmarshal(result.Elements, &elements); err != nil || len(elements) == 0 || result.CheckpointID == "" {
				t.Fatal("real provider did not complete a tool call and return canvas elements")
			}
			tracePath, _ := sessionFile(session)
			trace, err := os.ReadFile(tracePath)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(trace), key) {
				t.Fatal("trace leaked credentials")
			}
			if !strings.Contains(string(trace), `"provider_id":"live-check"`) || !strings.Contains(string(trace), model) || !strings.Contains(string(trace), `"stream":true`) {
				t.Fatal("trace did not identify a streamed request to the configured provider")
			}
			t.Logf("real provider %s passed: %d elements, streamed tool calls and MCP checkpoint, %.1fs", mode.name, len(elements), time.Since(started).Seconds())
		})
	}
}
