package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	if err := wails.Run(&options.App{
		Title:     "ExBase",
		Width:     1100,
		Height:    700,
		Assets:    assets,
		OnStartup: app.startup,
		Bind:      []interface{}{app},
	}); err != nil {
		println(err.Error())
	}
}
