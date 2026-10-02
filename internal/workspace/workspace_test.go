package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceBoundary(t *testing.T) {
	root := t.TempDir()
	app := &Workspace{root: root}
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
	app := New("")
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

func TestCreateUnique(t *testing.T) {
	root := t.TempDir()
	app := &Workspace{root: root}
	first, err := app.CreateDocument(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.CreateDocument(root)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(first.Path) != "Untitled.excalidraw" || filepath.Base(second.Path) != "Untitled 2.excalidraw" {
		t.Fatalf("unexpected document names: %q, %q", first.Path, second.Path)
	}
	folder, err := app.CreateFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.CreateFolder(root); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Untitled", "Untitled 2"} {
		if info, err := os.Stat(filepath.Join(root, name)); err != nil || !info.IsDir() {
			t.Fatalf("folder %q was not created", name)
		}
	}
	inside, err := app.CreateDocument(folder.Path)
	if err != nil || filepath.Dir(inside.Path) != folder.Path {
		t.Fatalf("document was not created in the selected folder: %#v, %v", inside, err)
	}
	renamed, err := app.Rename(first.Path, "Diagram")
	if err != nil || filepath.Base(renamed.Path) != "Diagram.excalidraw" {
		t.Fatalf("unexpected rename result: %#v, %v", renamed, err)
	}
	if _, err := app.CreateDocument(filepath.Dir(root)); err == nil {
		t.Fatal("creating outside the workspace should fail")
	}
	if err := app.DeleteEntry(second.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(second.Path); !os.IsNotExist(err) {
		t.Fatal("document was not deleted")
	}
	if err := app.DeleteEntry(folder.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(inside.Path); !os.IsNotExist(err) {
		t.Fatal("folder contents were not deleted")
	}
	if err := app.DeleteEntry(root); err == nil {
		t.Fatal("workspace root deletion should fail")
	}
}
