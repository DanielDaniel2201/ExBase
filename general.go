package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type GeneralSettings struct {
	SlidesEnabled bool `json:"slidesEnabled"`
}

func generalSettingsFile() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, ".exbase", "general.json"), err
}

func (a *App) LoadGeneralSettings() (GeneralSettings, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	settings := GeneralSettings{SlidesEnabled: true}
	path, err := generalSettingsFile()
	if err != nil {
		return settings, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	err = json.Unmarshal(data, &settings)
	return settings, err
}

func (a *App) SaveGeneralSettings(settings GeneralSettings) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	path, err := generalSettingsFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	return replaceFile(path, data)
}

// Keep the previous file intact until the complete replacement is ready.
func replaceFile(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".exbase-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
