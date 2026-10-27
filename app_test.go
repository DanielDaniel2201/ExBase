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
	expected := []string{"AbortRecording", "AppendRecording", "AppendRecordingFrame", "AskAI", "BeginMP4Recording", "BeginPresentationExport", "BeginRecording", "CancelAI", "CaptureApplicationFrame", "CheckForUpdates", "ChooseFolder", "ChoosePresentationAssets", "ChoosePresentationVideo", "ConfirmClose", "CreateAISession", "CreateDocument", "CreateFolder", "CreateMarkdown", "DeleteEntry", "DisableRecordingWebcam", "ExportSlides", "FinalizeRecording", "FinishRecording", "GetUpdateInfo", "InstallUpdate", "LoadAISettings", "LoadGeneralSettings", "LoadPromptTemplates", "OpenDocument", "OpenPresentationAssets", "PlanPresentation", "PrepareRecording", "ReadDirectory", "ReleasePresentationVideo", "Rename", "ResolveAICanvas", "Save", "SaveAIProviders", "SaveAISettings", "SaveGeneralSettings", "SavePromptTemplates", "SaveRecordingVideo", "SetCloseGuard", "SetRecordingWebcam", "StartRecordingMicrophone", "SwitchFolder", "Workspaces"}
	typ := reflect.TypeOf(app)
	actual := make([]string, typ.NumMethod())
	for i := range actual {
		actual[i] = typ.Method(i).Name
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("Wails API changed: got %v, want %v", actual, expected)
	}
}
