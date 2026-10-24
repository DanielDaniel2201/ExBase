package app

import (
	"context"
	"exbase/internal/workspace"
	"strings"
	"testing"
)

func TestDisableAIFeatures(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	a := NewApp()
	a.Workspace = workspace.New(home)
	general, err := a.LoadGeneralSettings()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.aiCancel = cancel
	general.AIEnabled = false
	if err := a.SaveGeneralSettings(general); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatal("disabling AI did not cancel the active request")
	}
	a.aiCancel = nil
	document, err := a.CreateDocument(home)
	if err != nil {
		t.Fatal(err)
	}
	for _, planning := range []bool{false, true} {
		_, err := a.askAI(document.Path, `{"elements":[{"id":"box","type":"rectangle"}]}`, "", "SRT file: narration.srt", "", nil, "", "disabled", "high", planning)
		if err == nil || !strings.Contains(err.Error(), "AI features are disabled") {
			t.Fatalf("planning=%v: %v", planning, err)
		}
	}
	general.AIEnabled = true
	if err := a.SaveGeneralSettings(general); err != nil {
		t.Fatal(err)
	}
	saved, err := a.LoadGeneralSettings()
	if err != nil || !saved.AIEnabled {
		t.Fatal(saved, err)
	}
}
