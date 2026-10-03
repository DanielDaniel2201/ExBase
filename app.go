package main

import (
	"context"
	"exbase/internal/app"
)

// Keep the main.App Wails binding while implementation lives in internal packages.
type App struct{ *app.App }

func NewApp() *App { return &App{App: app.NewApp()} }

func (a *App) startup(ctx context.Context) { app.Startup(a.App, ctx) }

func (a *App) beforeClose(ctx context.Context) bool { return app.BeforeClose(a.App, ctx) }
