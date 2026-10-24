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

func TestMarkdownLifecycle(t *testing.T) {
	root := t.TempDir()
	app := New(root)
	first, err := app.CreateMarkdown("")
	if err != nil || filepath.Base(first.Path) != "Untitled.md" || first.Data != "" {
		t.Fatalf("unexpected new Markdown: %#v, %v", first, err)
	}
	second, err := app.CreateMarkdown(root)
	if err != nil || filepath.Base(second.Path) != "Untitled 2.md" {
		t.Fatalf("expected a unique name: %#v, %v", second, err)
	}
	content := "# 笔记\n\n- [x] **完成**\n\n```go\nfmt.Println(1)\n```\n"
	if err := app.Save(first.Path, content); err != nil {
		t.Fatal(err)
	}
	if err := app.Save(first.Path, content+"\nUpdated\n"); err != nil {
		t.Fatal(err)
	}
	renamed, err := app.Rename(first.Path, "笔记")
	if err != nil || renamed.Name != "笔记.md" {
		t.Fatalf("Markdown extension was not preserved: %#v, %v", renamed, err)
	}
	opened, err := app.OpenDocument(renamed.Path)
	if err != nil || opened.Data != content+"\nUpdated\n" {
		t.Fatalf("content did not survive saving and renaming: %#v, %v", opened, err)
	}
	if _, err := app.Rename(second.Path, "笔记.md"); err == nil {
		t.Fatal("rename must not overwrite an existing note")
	}
	for _, name := range []string{"UPPER.MD", "long.markdown", "drawing.excalidraw", "ignored.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("test"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := app.ReadDirectory("")
	if err != nil || len(entries) != 5 {
		t.Fatalf("expected Markdown and Excalidraw files only: %#v, %v", entries, err)
	}
	long, err := app.Rename(filepath.Join(root, "long.markdown"), "Renamed")
	if err != nil || long.Name != "Renamed.markdown" {
		t.Fatalf("long extension was not preserved: %#v, %v", long, err)
	}
	for _, path := range []string{filepath.Join(root, "ignored.txt"), filepath.Join(filepath.Dir(root), "outside.md")} {
		if _, err := app.OpenDocument(path); err == nil {
			t.Fatal("unsupported or outside file was opened")
		}
		if err := app.Save(path, "bad"); err == nil {
			t.Fatal("unsupported or outside file was saved")
		}
		if _, err := app.Rename(path, "bad"); err == nil {
			t.Fatal("unsupported or outside file was renamed")
		}
		if err := app.DeleteEntry(path); err == nil {
			t.Fatal("unsupported or outside file was deleted")
		}
	}
	if _, err := app.CreateMarkdown(filepath.Dir(root)); err == nil {
		t.Fatal("Markdown was created outside the workspace")
	}
	if err := app.DeleteEntry(renamed.Path); err != nil {
		t.Fatal(err)
	}
	if err := app.Save(renamed.Path, "late autosave"); err == nil {
		t.Fatal("autosave must not recreate a deleted file")
	}
	folder, err := app.CreateFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	inside, err := app.CreateMarkdown(folder.Path)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := app.Rename(folder.Path, "Notes")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.OpenDocument(filepath.Join(moved.Path, filepath.Base(inside.Path))); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceRejectsLinkedDocuments(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	app := New(root)
	target := filepath.Join(outside, "private.md")
	if err := os.WriteFile(target, []byte("private"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	if _, err := app.OpenDocument(filepath.Join(link, "private.md")); err == nil {
		t.Fatal("linked file outside the workspace was opened")
	}
	if _, err := app.CreateMarkdown(link); err == nil {
		t.Fatal("file was created through a link outside the workspace")
	}
	if err := app.Save(filepath.Join(link, "private.md"), "bad"); err == nil {
		t.Fatal("file was saved through a link outside the workspace")
	}
}
