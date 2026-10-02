package app

import (
	"context"
	"exbase/internal/settings"
	"exbase/internal/workspace"
	"sync"
)

type App struct {
	*workspace.Workspace
	*settings.Store
	ctx        context.Context
	aiMu       sync.Mutex
	aiCancel   context.CancelFunc
	aiCanvas   *aiCanvasPending
	canvasEmit func(AICanvasRequest)
}

func NewApp() *App {
	return &App{Workspace: workspace.New(""), Store: &settings.Store{}}
}

func Startup(a *App, ctx context.Context) {
	a.ctx = ctx
	workspace.Startup(a.Workspace, ctx)
}

func (a *App) contains(path string) bool { return workspace.Contains(a.Workspace, path) }
