package app

import "testing"

func TestDevelopmentBuildCannotUpdate(t *testing.T) {
	a := NewApp()
	if info := a.GetUpdateInfo(); info.Installed || info.Version != "dev" {
		t.Fatalf("development build reported installed: %+v", info)
	}
	if _, err := a.CheckForUpdates(); err == nil {
		t.Fatal("development build checked for updates")
	}
	if err := a.InstallUpdate(); err == nil {
		t.Fatal("development build accepted an installation")
	}
	if a.updateInstaller != "" || a.updateBusy {
		t.Fatal("failed update left pending work")
	}
}
