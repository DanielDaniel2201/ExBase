package app

import (
	"errors"
	"exbase/internal/distribution"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) GetUpdateInfo() distribution.Info {
	return distribution.Info{Version: distribution.Version, Commit: distribution.Commit, Installed: distribution.Installed()}
}

func (a *App) CheckForUpdates() (distribution.Release, error) {
	if !distribution.Installed() {
		return distribution.Release{}, errors.New("updates are only available in the installed release")
	}
	return distribution.Check(a.ctx)
}

func (a *App) InstallUpdate() error {
	if !distribution.Installed() {
		return errors.New("updates are only available in the installed release")
	}
	a.updateMu.Lock()
	if a.updateBusy {
		a.updateMu.Unlock()
		return errors.New("an update is already in progress")
	}
	a.updateBusy = true
	a.updateMu.Unlock()
	defer func() { a.updateMu.Lock(); a.updateBusy = false; a.updateMu.Unlock() }()
	a.recordingMu.Lock()
	active, guard := a.recordingID != "", a.closeGuard
	a.recordingMu.Unlock()
	if active || !guard {
		return errors.New("stop recording and wait for the editor before updating")
	}
	release, err := distribution.Check(a.ctx)
	if err != nil {
		return err
	}
	path, err := distribution.Download(a.ctx, release)
	if err != nil {
		return err
	}
	a.updateMu.Lock()
	if a.updateInstaller != "" {
		os.RemoveAll(filepath.Dir(a.updateInstaller))
	}
	a.updateInstaller = path
	a.updateMu.Unlock()
	// Quit goes through the existing recording and document-save guards.
	runtime.Quit(a.ctx)
	return nil
}

func (a *App) launchPendingUpdate() error {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.updateInstaller == "" {
		return nil
	}
	a.recordingMu.Lock()
	active := a.recordingID != ""
	a.recordingMu.Unlock()
	if active {
		return errors.New("stop recording before updating")
	}
	if err := distribution.LaunchInstaller(a.updateInstaller); err != nil {
		return err
	}
	a.updateInstaller = ""
	return nil
}
