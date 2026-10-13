package app

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type AIProvider struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BaseURL string `json:"baseURL"`
	Model   string `json:"model"`
	APIKey  string `json:"apiKey"`
}

type AISettings struct {
	Providers        []AIProvider `json:"providers"`
	ActiveProviderID string       `json:"activeProviderID"`
	HasAPIKey        bool         `json:"hasAPIKey"`
	APIKey           string       `json:"apiKey"`
	ReasoningEffort  string       `json:"reasoningEffort"`
}

type aiAuth struct {
	Providers        []AIProvider `json:"providers"`
	ActiveProviderID string       `json:"activeProviderID"`
	ReasoningEffort  string       `json:"reasoningEffort"`
}

type aiConfig struct {
	AIProvider
	ReasoningEffort string
}

func officialAIProvider() AIProvider {
	return AIProvider{ID: "deepseek", Name: "DeepSeek", BaseURL: "https://api.deepseek.com", Model: "deepseek-flash"}
}

func authFile() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, ".exbase", "auth.json"), err
}

func loadAIAuth() (aiAuth, error) {
	path, err := authFile()
	if err != nil {
		return aiAuth{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return aiAuth{Providers: []AIProvider{officialAIProvider()}, ActiveProviderID: "deepseek", ReasoningEffort: "high"}, nil
	}
	if err != nil {
		return aiAuth{}, err
	}
	var auth aiAuth
	if err := json.Unmarshal(data, &auth); err != nil {
		return aiAuth{}, errors.New("cannot read AI settings")
	}
	if auth.Providers == nil {
		var legacy struct {
			DeepSeek struct {
				APIKey          string `json:"apiKey"`
				ReasoningEffort string `json:"reasoningEffort"`
			} `json:"deepseek"`
		}
		if err := json.Unmarshal(data, &legacy); err != nil {
			return aiAuth{}, errors.New("cannot read AI settings")
		}
		provider := officialAIProvider()
		provider.APIKey = legacy.DeepSeek.APIKey
		auth = aiAuth{Providers: []AIProvider{provider}, ActiveProviderID: provider.ID, ReasoningEffort: legacy.DeepSeek.ReasoningEffort}
	}
	if !validReasoningEffort(auth.ReasoningEffort) {
		auth.ReasoningEffort = "high"
	}
	if err := validateAIAuth(&auth); err != nil {
		return aiAuth{}, err
	}
	return auth, nil
}

func validateAIAuth(auth *aiAuth) error {
	ids := make(map[string]bool)
	for i := range auth.Providers {
		provider := &auth.Providers[i]
		provider.Name = strings.TrimSpace(provider.Name)
		provider.BaseURL = strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
		provider.Model = strings.TrimSpace(provider.Model)
		provider.APIKey = strings.TrimSpace(provider.APIKey)
		if provider.ID == "" || len(provider.ID) > 80 || ids[provider.ID] {
			return errors.New("provider IDs must be non-empty and unique")
		}
		for _, char := range provider.ID {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
				return errors.New("invalid provider ID")
			}
		}
		ids[provider.ID] = true
		if provider.Name == "" || utf8.RuneCountInString(provider.Name) > 80 || strings.ContainsAny(provider.Name, "\r\n\t") {
			return errors.New("enter a provider name (up to 80 characters)")
		}
		endpoint, err := url.Parse(provider.BaseURL)
		if err != nil || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.ForceQuery || endpoint.Fragment != "" || len(provider.BaseURL) > 2048 {
			return errors.New("enter an HTTP or HTTPS Base URL without credentials, a query, or a fragment")
		}
		if strings.HasSuffix(endpoint.Path, "/chat/completions") || strings.HasSuffix(endpoint.Path, "/responses") {
			return errors.New("enter the API Base URL, without /chat/completions or /responses")
		}
		if provider.Model == "" || len(provider.Model) > 256 || strings.ContainsAny(provider.Model, "\r\n\t ") {
			return errors.New("enter the provider's model ID for DeepSeek V4.1 Flash")
		}
		if len(provider.APIKey) > 1024 || strings.ContainsAny(provider.APIKey, "\r\n\t ") {
			return errors.New("enter a valid API key")
		}
		if provider.ID == "deepseek" {
			official := officialAIProvider()
			if provider.Name != official.Name || provider.BaseURL != official.BaseURL || provider.Model != official.Model {
				return errors.New("the official DeepSeek preset cannot be changed except for its API key")
			}
		}
	}
	if !ids["deepseek"] {
		return errors.New("keep the official DeepSeek preset")
	}
	if !ids[auth.ActiveProviderID] {
		return errors.New("select an existing provider")
	}
	return nil
}

func (auth aiAuth) settings() AISettings {
	settings := AISettings{Providers: auth.Providers, ActiveProviderID: auth.ActiveProviderID, ReasoningEffort: auth.ReasoningEffort}
	for _, provider := range auth.Providers {
		if provider.ID == auth.ActiveProviderID {
			settings.APIKey = provider.APIKey
			settings.HasAPIKey = provider.APIKey != ""
		}
	}
	return settings
}

func loadAIConfig() (aiConfig, error) {
	auth, err := loadAIAuth()
	if err != nil {
		return aiConfig{}, err
	}
	for _, provider := range auth.Providers {
		if provider.ID == auth.ActiveProviderID {
			return aiConfig{AIProvider: provider, ReasoningEffort: auth.ReasoningEffort}, nil
		}
	}
	return aiConfig{}, errors.New("select an AI provider in Settings first")
}

func loadAPIKey() (string, error) {
	config, err := loadAIConfig()
	return config.APIKey, err
}

func (a *App) LoadAISettings() (AISettings, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	auth, err := loadAIAuth()
	return auth.settings(), err
}

func (a *App) SaveAIProviders(providers []AIProvider, activeProviderID string) (AISettings, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	auth, err := loadAIAuth()
	if err != nil {
		return AISettings{}, err
	}
	auth.Providers = providers
	auth.ActiveProviderID = activeProviderID
	if err := validateAIAuth(&auth); err != nil {
		return AISettings{}, err
	}
	return auth.settings(), saveAIAuth(auth)
}

func (a *App) SaveAISettings(key, reasoningEffort string) (AISettings, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	reasoningEffort = strings.ToLower(strings.TrimSpace(reasoningEffort))
	if !validReasoningEffort(reasoningEffort) {
		return AISettings{}, errors.New("choose a valid reasoning effort")
	}
	auth, err := loadAIAuth()
	if err != nil {
		return AISettings{}, err
	}
	for i := range auth.Providers {
		if auth.Providers[i].ID == auth.ActiveProviderID && strings.TrimSpace(key) != "" {
			auth.Providers[i].APIKey = key
		}
	}
	auth.ReasoningEffort = reasoningEffort
	if err := validateAIAuth(&auth); err != nil {
		return AISettings{}, err
	}
	return auth.settings(), saveAIAuth(auth)
}

func saveAIAuth(auth aiAuth) error {
	path, err := authFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(auth)
	if err != nil {
		return err
	}
	// Replace only after a complete write, so an interrupted save keeps the old credentials.
	file, err := os.CreateTemp(filepath.Dir(path), "auth-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
