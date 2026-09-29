package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceBoundary(t *testing.T) {
	root := t.TempDir()
	app := &App{root: root}
	if !app.contains(filepath.Join(root, "notes", "drawing.excalidraw")) {
		t.Fatal("workspace file should be allowed")
	}
	if app.contains(filepath.Join(root, "..", "outside.excalidraw")) {
		t.Fatal("path outside workspace should be rejected")
	}
	for _, dir := range []string{"z-folder", "a-folder"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range map[string]string{"drawing.excalidraw": "{}", "ignored.txt": "no"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := app.ReadDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || entries[0].Name != "a-folder" || entries[1].Name != "z-folder" || entries[2].Name != "drawing.excalidraw" {
		t.Fatalf("unexpected file tree: %#v", entries)
	}
}

func TestWorkspaceHistory(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	root := t.TempDir()
	first, second := filepath.Join(root, "first"), filepath.Join(root, "second")
	if err := os.Mkdir(first, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(second, 0755); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	if _, err := app.remember(first); err != nil {
		t.Fatal(err)
	}
	state, err := app.remember(second)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current != second || len(state.Folders) != 2 || state.Folders[0] != second || state.Folders[1] != first {
		t.Fatalf("unexpected workspace history: %#v", state)
	}
}
