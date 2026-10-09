package main

import (
	"embed"
	backend "exbase/internal/app"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	stopMedia, err := backend.StartPresentationMediaServer(app.App)
	if err != nil {
		println(err.Error())
		return
	}
	defer stopMedia()
	if err := wails.Run(&options.App{
		Title:         "ExBase",
		Width:         1100,
		Height:        700,
		Frameless:     true,
		DragAndDrop:   &options.DragAndDrop{EnableFileDrop: true},
		AssetServer:   &assetserver.Options{Assets: assets},
		OnStartup:     app.startup,
		OnBeforeClose: app.beforeClose,
		Bind:          []interface{}{app},
	}); err != nil {
		println(err.Error())
	}
}
