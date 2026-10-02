package main

import (
	"encoding/base64"
	"os"
	"testing"
)

func TestGeneralSettingsAndSlideExport(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := NewApp()
	settings, err := app.LoadGeneralSettings()
	if err != nil || !settings.SlidesEnabled {
		t.Fatal(settings, err)
	}
	if err := app.SaveGeneralSettings(GeneralSettings{SlidesEnabled: false}); err != nil {
		t.Fatal(err)
	}
	settings, err = NewApp().LoadGeneralSettings()
	if err != nil || settings.SlidesEnabled {
		t.Fatal("disabled setting was not retained", settings, err)
	}
	path, _ := generalSettingsFile()
	if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.LoadGeneralSettings(); err == nil {
		t.Fatal("corrupt settings accepted")
	}
	encoded := base64.StdEncoding.EncodeToString([]byte("<!doctype html>"))
	if data, err := decodeSlideExport("html", encoded); err != nil || string(data) != "<!doctype html>" {
		t.Fatal(string(data), err)
	}
	if _, err := decodeSlideExport("exe", encoded); err == nil {
		t.Fatal("unsupported export format accepted")
	}
	if _, err := decodeSlideExport("pptx", "broken base64"); err == nil {
		t.Fatal("invalid export accepted")
	}
	if _, err := decodeSlideExport("html", ""); err == nil {
		t.Fatal("empty export accepted")
	}
}
