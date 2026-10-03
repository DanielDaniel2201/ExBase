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
	expected := []string{"AbortRecording", "AppendRecording", "AppendRecordingFrame", "AskAI", "BeginMP4Recording", "BeginRecording", "CancelAI", "CaptureApplicationFrame", "ChooseFolder", "CreateAISession", "CreateDocument", "CreateFolder", "DeleteEntry", "ExportSlides", "FinalizeRecording", "FinishRecording", "LoadAISettings", "LoadGeneralSettings", "LoadPromptTemplates", "OpenDocument", "ReadDirectory", "Rename", "ResolveAICanvas", "Save", "SaveAISettings", "SaveGeneralSettings", "SavePromptTemplates", "StartRecordingMicrophone", "SwitchFolder", "Workspaces"}
	typ := reflect.TypeOf(app)
	actual := make([]string, typ.NumMethod())
	for i := range actual {
		actual[i] = typ.Method(i).Name
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("Wails API changed: got %v, want %v", actual, expected)
	}
}
