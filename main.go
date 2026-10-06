package main

import (
	"embed"
	backend "exbase/internal/app"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	media := backend.PresentationMediaHandler(app.App)
	if err := wails.Run(&options.App{
		Title:     "ExBase",
		Width:     1100,
		Height:    700,
		Frameless: true,
		AssetServer: &assetserver.Options{Assets: assets, Handler: media, Middleware: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/presentation-media/") {
					media.ServeHTTP(w, r)
				} else {
					next.ServeHTTP(w, r)
				}
			})
		}},
		OnStartup:     app.startup,
		OnBeforeClose: app.beforeClose,
		Bind:          []interface{}{app},
	}); err != nil {
		println(err.Error())
	}
}
