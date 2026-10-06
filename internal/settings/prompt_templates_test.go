package settings

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestPromptTemplates(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := (&Store{})
	defaults, err := app.LoadPromptTemplates()
	if err != nil || len(defaults) != 2 {
		t.Fatal(defaults, err)
	}
	if defaults[1].Name != "SRT · 叙述回放" || !strings.Contains(defaults[1].Body, "SRT 文件：{{SRT 文件路径}}") {
		t.Fatal("missing SRT preset", defaults)
	}
	defaults[1].Name = "My replay"
	defaults[1].Body = "Edited replay content"
	if err := app.SavePromptTemplates(defaults); err != nil {
		t.Fatal(err)
	}
	loaded, err := (&Store{}).LoadPromptTemplates()
	if err != nil || !reflect.DeepEqual(loaded, defaults) {
		t.Fatal("renamed preset reappeared or lost edits", loaded, err)
	}
	if err := app.SavePromptTemplates(defaults[:1]); err != nil {
		t.Fatal(err)
	}
	loaded, err = (&Store{}).LoadPromptTemplates()
	if err != nil || !reflect.DeepEqual(loaded, defaults[:1]) {
		t.Fatal("deleted preset reappeared", loaded, err)
	}
	templates := []PromptTemplate{{Name: "Demo", Body: "主题：{{主题}}\nKeep [other blanks] literal."}}
	if err := app.SavePromptTemplates(templates); err != nil {
		t.Fatal(err)
	}
	loaded, err = (&Store{}).LoadPromptTemplates()
	if err != nil || !reflect.DeepEqual(loaded, templates) {
		t.Fatal(loaded, err)
	}
	if err := app.SavePromptTemplates([]PromptTemplate{{Name: "Demo", Body: "x"}, {Name: " demo ", Body: "y"}}); err == nil {
		t.Fatal("duplicate names accepted")
	}
	if err := app.SavePromptTemplates([]PromptTemplate{{Name: "Demo", Body: " "}}); err == nil {
		t.Fatal("empty template accepted")
	}
	loaded, err = app.LoadPromptTemplates()
	if err != nil || !reflect.DeepEqual(loaded, templates) {
		t.Fatal("invalid save replaced templates", loaded, err)
	}
	if err := app.SavePromptTemplates(nil); err != nil {
		t.Fatal(err)
	}
	loaded, err = app.LoadPromptTemplates()
	if err != nil || loaded == nil || len(loaded) != 0 {
		t.Fatal("deleted defaults reappeared", loaded, err)
	}
	path, _ := promptTemplatesFile()
	if err := os.WriteFile(path, []byte("broken JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.LoadPromptTemplates(); err == nil {
		t.Fatal("corrupt file silently replaced by defaults")
	}
}
