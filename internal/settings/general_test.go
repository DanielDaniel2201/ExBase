package settings

import (
	"os"
	"testing"
)

func TestGeneralSettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := (&Store{})
	settings, err := app.LoadGeneralSettings()
	if err != nil || !settings.SlidesEnabled || settings.RecordingEnabled || settings.RecordingMode != "canvas" || settings.KeepRecordingOnCancel {
		t.Fatal(settings, err)
	}
	if err := app.SaveGeneralSettings(GeneralSettings{SlidesEnabled: false}); err != nil {
		t.Fatal(err)
	}
	settings, err = (&Store{}).LoadGeneralSettings()
	if err != nil || settings.SlidesEnabled {
		t.Fatal("disabled setting was not retained", settings, err)
	}
	path, _ := generalSettingsFile()
	if err := os.WriteFile(path, []byte(`{"slidesEnabled":true,"recordingMicrophone":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	settings, err = app.LoadGeneralSettings()
	if err != nil || settings.RecordingMode != "canvas" || settings.RecordingEnabled || settings.KeepRecordingOnCancel {
		t.Fatal("legacy settings", settings, err)
	}
	for _, mode := range []string{"app", "canvas", "canvas-locked"} {
		keepOnCancel := mode == "canvas"
		if err := app.SaveGeneralSettings(GeneralSettings{SlidesEnabled: true, RecordingEnabled: true, RecordingMode: mode, KeepRecordingOnCancel: keepOnCancel}); err != nil {
			t.Fatal(err)
		}
		settings, err = app.LoadGeneralSettings()
		if err != nil || !settings.RecordingEnabled || settings.RecordingMode != mode || settings.KeepRecordingOnCancel != keepOnCancel {
			t.Fatal("recording settings not retained", settings, err)
		}
	}
	if err := app.SaveGeneralSettings(GeneralSettings{RecordingMode: "unknown"}); err == nil {
		t.Fatal("invalid mode accepted")
	}
	if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.LoadGeneralSettings(); err == nil {
		t.Fatal("corrupt settings accepted")
	}
}
