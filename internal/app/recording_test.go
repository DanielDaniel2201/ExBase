package app

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestRecordingChunksAndRecovery(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	a := NewApp()
	if _, err := a.BeginRecording("Canvas", "../mp4"); err == nil {
		t.Fatal("invalid recording format accepted")
	}
	id, err := a.BeginRecording("Canvas.excalidraw", "mp4")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(id) != ".mp4" || filepath.Ext(a.recordingName) != ".mp4" {
		t.Fatal("MP4 recording has the wrong extension")
	}
	if _, err := a.BeginRecording("other", "mp4"); err == nil {
		t.Fatal("overlapping recording accepted")
	}
	encode := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	if err := a.AppendRecording("wrong", encode("bad")); err == nil {
		t.Fatal("stale recording accepted")
	}
	if err := a.AppendRecording(id, "!!"); err == nil {
		t.Fatal("invalid base64 accepted")
	}
	for _, part := range []string{"webm header", "video frame"} {
		if err := a.AppendRecording(id, encode(part)); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.AbortRecording(id); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(home, ".exbase", "recordings", id))
	if err != nil || string(data) != "webm headervideo frame" {
		t.Fatal("captured frames were not retained", string(data), err)
	}
	if err := a.AppendRecording(id, encode("late")); err == nil {
		t.Fatal("late chunk accepted")
	}
	if err := a.AbortRecording(id); err == nil {
		t.Fatal("stale abort accepted")
	}
	id, err = a.BeginRecording("empty", "webm")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(id) != ".webm" {
		t.Fatal("WebM fallback has the wrong extension")
	}
	if _, err := a.FinishRecording(id); err == nil {
		t.Fatal("empty recording was reported as saved")
	}
	if err := a.AbortRecording(id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".exbase", "recordings", id)); !os.IsNotExist(err) {
		t.Fatal("empty recording retained", err)
	}
	source, destination := filepath.Join(home, "source.webm"), filepath.Join(home, "saved.webm")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyRecording(source, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil || string(got) != string(data) {
		t.Fatal("saved recording", string(got), err)
	}
	if err := copyRecording("missing", destination); err == nil {
		t.Fatal("missing source accepted")
	}
	got, _ = os.ReadFile(destination)
	if string(got) != string(data) {
		t.Fatal("failed save damaged existing recording")
	}
}
