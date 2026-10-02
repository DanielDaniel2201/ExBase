package settings

import (
	"os"
	"reflect"
	"testing"
)

func TestPromptTemplates(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := (&Store{})
	defaults, err := app.LoadPromptTemplates()
	if err != nil || len(defaults) != 1 {
		t.Fatal(defaults, err)
	}
	templates := []PromptTemplate{{Name: "Demo", Body: "主题：{{主题}}\nKeep [other blanks] literal."}}
	if err := app.SavePromptTemplates(templates); err != nil {
		t.Fatal(err)
	}
	loaded, err := (&Store{}).LoadPromptTemplates()
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
