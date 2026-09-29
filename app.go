package main

import (
	"context"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct{ ctx context.Context }

type Document struct {
	Path string `json:"path"`
	Data string `json:"data"`
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) Open() (Document, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Excalidraw file",
		Filters: []runtime.FileFilter{{
			DisplayName: "Excalidraw (*.excalidraw)",
			Pattern:     "*.excalidraw",
		}},
	})
	if err != nil || path == "" {
		return Document{}, err
	}
	data, err := os.ReadFile(path)
	return Document{Path: path, Data: string(data)}, err
}

func (a *App) Save(path, data string) (string, error) {
	var err error
	if path == "" {
		path, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:           "Save Excalidraw file",
			DefaultFilename: "drawing.excalidraw",
			Filters: []runtime.FileFilter{{
				DisplayName: "Excalidraw (*.excalidraw)",
				Pattern:     "*.excalidraw",
			}},
		})
	}
	if err != nil || path == "" {
		return path, err
	}
	if filepath.Ext(path) == "" {
		path += ".excalidraw"
	}
	return path, os.WriteFile(path, []byte(data), 0644)
}
