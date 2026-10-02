package main

import (
	"reflect"
	"testing"
)

func TestWailsAppMethods(t *testing.T) {
	app := NewApp()
	if app.App == nil || app.Workspace == nil || app.Store == nil {
		t.Fatal("backend services were not initialized")
	}
	expected := []string{"AskAI", "CancelAI", "ChooseFolder", "CreateAISession", "CreateDocument", "CreateFolder", "DeleteEntry", "ExportSlides", "LoadAISettings", "LoadGeneralSettings", "LoadPromptTemplates", "OpenDocument", "ReadDirectory", "Rename", "ResolveAICanvas", "Save", "SaveAISettings", "SaveGeneralSettings", "SavePromptTemplates", "SwitchFolder", "Workspaces"}
	typ := reflect.TypeOf(app)
	actual := make([]string, typ.NumMethod())
	for i := range actual {
		actual[i] = typ.Method(i).Name
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("Wails API changed: got %v, want %v", actual, expected)
	}
}
