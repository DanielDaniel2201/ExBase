package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx     context.Context
	root    string
	folders []string
}

type Document struct {
	Path string `json:"path"`
	Data string `json:"data"`
}

type FileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
}

type WorkspaceState struct {
	Current string   `json:"current"`
	Folders []string `json:"folders"`
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	data, err := os.ReadFile(workspaceFile())
	if err != nil {
		return
	}
	var saved WorkspaceState
	if json.Unmarshal(data, &saved) != nil {
		saved.Current = strings.TrimSpace(string(data)) // Migrate the original single-folder format.
	}
	for _, path := range append([]string{saved.Current}, saved.Folders...) {
		path = filepath.Clean(path)
		if info, statErr := os.Stat(path); path != "." && statErr == nil && info.IsDir() && !containsPath(a.folders, path) {
			a.folders = append(a.folders, path)
		}
	}
	if len(a.folders) > 0 {
		a.root = a.folders[0]
	}
}

func workspaceFile() string {
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "ExBase", "workspace")
}

func (a *App) Workspaces() WorkspaceState {
	return WorkspaceState{Current: a.root, Folders: append([]string(nil), a.folders...)}
}

func (a *App) ChooseFolder() (WorkspaceState, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open folder",
		DefaultDirectory: a.root,
	})
	if err != nil || path == "" {
		return WorkspaceState{}, err
	}
	return a.remember(path)
}

func (a *App) SwitchFolder(path string) (WorkspaceState, error) {
	path = filepath.Clean(path)
	if !containsPath(a.folders, path) {
		return WorkspaceState{}, errors.New("folder is not in workspace history")
	}
	return a.remember(path)
}

func (a *App) remember(path string) (WorkspaceState, error) {
	path = filepath.Clean(path)
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return WorkspaceState{}, errors.New("folder no longer exists")
	}
	folders := []string{path}
	for _, old := range a.folders {
		if !strings.EqualFold(old, path) {
			folders = append(folders, old)
		}
	}
	state := WorkspaceState{Current: path, Folders: folders}
	data, err := json.Marshal(state)
	if err != nil {
		return WorkspaceState{}, err
	}
	config := workspaceFile()
	if err := os.MkdirAll(filepath.Dir(config), 0755); err != nil {
		return WorkspaceState{}, err
	}
	if err := os.WriteFile(config, data, 0644); err != nil {
		return WorkspaceState{}, err
	}
	a.root, a.folders = path, folders
	return state, nil
}

func containsPath(paths []string, target string) bool {
	for _, path := range paths {
		if strings.EqualFold(path, target) {
			return true
		}
	}
	return false
}

func (a *App) ReadDirectory(path string) ([]FileEntry, error) {
	if path == "" {
		path = a.root
	}
	if !a.contains(path) {
		return nil, errors.New("folder is outside the open workspace")
	}
	items, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	entries := make([]FileEntry, 0, len(items))
	for _, item := range items {
		if item.Type()&os.ModeSymlink != 0 || (!item.IsDir() && !strings.EqualFold(filepath.Ext(item.Name()), ".excalidraw")) {
			continue
		}
		entries = append(entries, FileEntry{
			Name: item.Name(), Path: filepath.Join(path, item.Name()), IsDir: item.IsDir(),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

func (a *App) OpenDocument(path string) (Document, error) {
	if !a.contains(path) || !strings.EqualFold(filepath.Ext(path), ".excalidraw") {
		return Document{}, errors.New("file is outside the open workspace or is not an Excalidraw file")
	}
	data, err := os.ReadFile(path)
	return Document{Path: path, Data: string(data)}, err
}

func (a *App) Save(path, data string) error {
	if !a.contains(path) || !strings.EqualFold(filepath.Ext(path), ".excalidraw") {
		return errors.New("file is outside the open workspace or is not an Excalidraw file")
	}
	return os.WriteFile(path, []byte(data), 0644)
}

func (a *App) contains(path string) bool {
	if a.root == "" || path == "" {
		return false
	}
	rel, err := filepath.Rel(a.root, filepath.Clean(path))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
