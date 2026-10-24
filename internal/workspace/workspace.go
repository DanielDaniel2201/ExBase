package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"exbase/internal/fileio"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Workspace struct {
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

func New(root string) *Workspace { return &Workspace{root: root} }

func Startup(a *Workspace, ctx context.Context) {
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

func (a *Workspace) Workspaces() WorkspaceState {
	return WorkspaceState{Current: a.root, Folders: append([]string(nil), a.folders...)}
}

func (a *Workspace) ChooseFolder() (WorkspaceState, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open folder",
		DefaultDirectory: a.root,
	})
	if err != nil || path == "" {
		return WorkspaceState{}, err
	}
	return a.remember(path)
}

func (a *Workspace) SwitchFolder(path string) (WorkspaceState, error) {
	path = filepath.Clean(path)
	if !containsPath(a.folders, path) {
		return WorkspaceState{}, errors.New("folder is not in workspace history")
	}
	return a.remember(path)
}

func (a *Workspace) remember(path string) (WorkspaceState, error) {
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

func (a *Workspace) ReadDirectory(path string) ([]FileEntry, error) {
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
		if item.Type()&os.ModeSymlink != 0 || (!item.IsDir() && !isDocument(item.Name())) {
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

func (a *Workspace) OpenDocument(path string) (Document, error) {
	if !a.contains(path) || !isDocument(path) {
		return Document{}, errors.New("file is outside the open workspace or is not an Excalidraw or Markdown file")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return Document{}, err
	}
	if !info.Mode().IsRegular() {
		return Document{}, errors.New("only regular document files can be opened")
	}
	data, err := os.ReadFile(path)
	return Document{Path: path, Data: string(data)}, err
}

func (a *Workspace) CreateDocument(dir string) (Document, error) {
	return a.createDocument(dir, ".excalidraw", `{"type":"excalidraw","version":2,"source":"local","elements":[],"appState":{},"files":{}}`)
}

func (a *Workspace) CreateMarkdown(dir string) (Document, error) {
	return a.createDocument(dir, ".md", "")
}

func (a *Workspace) createDocument(dir, ext, data string) (Document, error) {
	if dir == "" {
		dir = a.root
	}
	if !a.contains(dir) {
		return Document{}, errors.New("folder is outside the open workspace")
	}
	path, file, err := createUnique(dir, "Untitled", ext, false)
	if err != nil {
		return Document{}, err
	}
	if _, err := file.WriteString(data); err != nil {
		file.Close()
		os.Remove(path)
		return Document{}, err
	}
	if err := file.Close(); err != nil {
		return Document{}, err
	}
	return Document{Path: path, Data: data}, nil
}

func (a *Workspace) CreateFolder(dir string) (FileEntry, error) {
	if dir == "" {
		dir = a.root
	}
	if !a.contains(dir) {
		return FileEntry{}, errors.New("folder is outside the open workspace")
	}
	path, _, err := createUnique(dir, "Untitled", "", true)
	return FileEntry{Name: filepath.Base(path), Path: path, IsDir: true}, err
}

func (a *Workspace) Rename(path, name string) (FileEntry, error) {
	path = filepath.Clean(path)
	name = strings.TrimSpace(name)
	if !a.contains(path) || strings.EqualFold(path, a.root) {
		return FileEntry{}, errors.New("item is outside the open workspace")
	}
	if name == "" || filepath.Base(name) != name || name == "." || name == ".." {
		return FileEntry{}, errors.New("enter a valid name")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return FileEntry{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return FileEntry{}, errors.New("symbolic links cannot be renamed")
	}
	if !info.IsDir() {
		if !isDocument(path) {
			return FileEntry{}, errors.New("only Excalidraw and Markdown files can be renamed")
		}
		ext := filepath.Ext(path)
		if !strings.EqualFold(filepath.Ext(name), ext) {
			name += ext
		}
	}
	target := filepath.Join(filepath.Dir(path), name)
	entry := FileEntry{Name: filepath.Base(target), Path: target, IsDir: info.IsDir()}
	if path == target {
		return entry, nil
	}
	if _, err := os.Lstat(target); err == nil {
		return FileEntry{}, errors.New("an item with that name already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return FileEntry{}, err
	}
	return entry, os.Rename(path, target)
}

func (a *Workspace) DeleteEntry(path string) error {
	path = filepath.Clean(path)
	if !a.contains(path) || strings.EqualFold(path, a.root) {
		return errors.New("item is outside the open workspace")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("symbolic links cannot be deleted")
	}
	if info.IsDir() {
		return os.RemoveAll(path)
	}
	if !isDocument(path) {
		return errors.New("only Excalidraw and Markdown files can be deleted")
	}
	return os.Remove(path)
}

func createUnique(dir, name, ext string, directory bool) (string, *os.File, error) {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return "", nil, errors.New("workspace folder no longer exists")
	}
	for i := 1; ; i++ {
		candidate := filepath.Join(dir, name+ext)
		if i > 1 {
			candidate = filepath.Join(dir, name+" "+strconv.Itoa(i)+ext)
		}
		if directory {
			if err := os.Mkdir(candidate, 0755); errors.Is(err, os.ErrExist) {
				continue
			} else {
				return candidate, nil, err
			}
		}
		file, err := os.OpenFile(candidate, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		return candidate, file, err
	}
}

func (a *Workspace) Save(path, data string) error {
	if !a.contains(path) || !isDocument(path) {
		return errors.New("file is outside the open workspace or is not an Excalidraw or Markdown file")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("only regular document files can be saved")
	}
	return fileio.Replace(path, []byte(data))
}

func isDocument(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".excalidraw", ".md", ".markdown":
		return true
	}
	return false
}

func (a *Workspace) contains(path string) bool {
	if a.root == "" || path == "" {
		return false
	}
	rel, err := filepath.Rel(a.root, filepath.Clean(path))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	root, err := filepath.EvalSymlinks(a.root)
	if err != nil {
		return false
	}
	for current := filepath.Clean(path); ; current = filepath.Dir(current) {
		resolved, err := filepath.EvalSymlinks(current)
		if errors.Is(err, os.ErrNotExist) && filepath.Dir(current) != current {
			continue
		}
		if err != nil {
			return false
		}
		rel, err := filepath.Rel(root, resolved)
		return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
	}
}

// Contains applies the same workspace boundary to AI requests.
func Contains(a *Workspace, path string) bool { return a.contains(path) }
