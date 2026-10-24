package app

import (
	"context"
	"exbase/internal/settings"
	"exbase/internal/workspace"
	"os"
	"sync"
)

type App struct {
	*workspace.Workspace
	*settings.Store
	ctx               context.Context
	aiMu              sync.Mutex
	aiCancel          context.CancelFunc
	aiCanvas          *aiCanvasPending
	canvasEmit        func(AICanvasRequest)
	recordingMu       sync.Mutex
	recordingFile     *os.File
	recordingPath     string
	recordingID       string
	recordingName     string
	recordingSaving   bool
	recordingEncoder  *mp4Encoder
	presentationMu    sync.Mutex
	presentationMedia map[string]string
	recordingMedia    map[string]string
	presentationURL   string
}

func NewApp() *App {
	return &App{Workspace: workspace.New(""), Store: &settings.Store{}}
}

func Startup(a *App, ctx context.Context) {
	a.ctx = ctx
	workspace.Startup(a.Workspace, ctx)
}

func (a *App) contains(path string) bool { return workspace.Contains(a.Workspace, path) }

// SaveGeneralSettings serializes disabling AI with starting a request.
func (a *App) SaveGeneralSettings(value settings.GeneralSettings) error {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	if err := a.Store.SaveGeneralSettings(value); err != nil {
		return err
	}
	if !value.AIEnabled && a.aiCancel != nil {
		a.aiCancel()
	}
	return nil
}
