package settings

import (
	"encoding/json"
	"errors"
	"exbase/internal/fileio"
	"os"
	"path/filepath"
)

type GeneralSettings struct {
	SlidesEnabled         bool   `json:"slidesEnabled"`
	RecordingEnabled      bool   `json:"recordingEnabled"`
	RecordingMode         string `json:"recordingMode"`
	KeepRecordingOnCancel bool   `json:"keepRecordingOnCancel"`
}

func validRecordingMode(mode string) bool {
	return mode == "app" || mode == "canvas" || mode == "canvas-locked"
}

func generalSettingsFile() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, ".exbase", "general.json"), err
}

func (a *Store) LoadGeneralSettings() (GeneralSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	settings := GeneralSettings{SlidesEnabled: true, RecordingMode: "canvas"}
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
	if !validRecordingMode(settings.RecordingMode) {
		settings.RecordingMode = "canvas"
	}
	return settings, err
}

func (a *Store) SaveGeneralSettings(settings GeneralSettings) error {
	if settings.RecordingMode == "" {
		settings.RecordingMode = "canvas"
	}
	if !validRecordingMode(settings.RecordingMode) {
		return errors.New("invalid recording mode")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
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
	return fileio.Replace(path, data)
}
