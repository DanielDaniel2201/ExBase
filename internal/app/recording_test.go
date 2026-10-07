package app

import (
	"encoding/base64"
	"errors"
	"exbase/internal/settings"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func TestFinishRecordingCancelPolicy(t *testing.T) {
	for _, tc := range []struct {
		name      string
		keep      bool
		save      bool
		dialogErr bool
		corrupt   bool
	}{
		{name: "cancel discards by default"},
		{name: "cancel keeps when enabled", keep: true},
		{name: "save with retention disabled", save: true},
		{name: "save with retention enabled", keep: true, save: true},
		{name: "dialog error retains recovery", dialogErr: true},
		{name: "settings error retains recovery", corrupt: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("USERPROFILE", home)
			t.Setenv("HOME", home)
			a := NewApp()
			if tc.keep || tc.save {
				if err := a.SaveGeneralSettings(settings.GeneralSettings{KeepRecordingOnCancel: tc.keep}); err != nil {
					t.Fatal(err)
				}
			}
			id, err := a.BeginRecording("Canvas.excalidraw", "mp4")
			if err != nil {
				t.Fatal(err)
			}
			source := a.recordingPath
			payload := []byte("finalized video bytes")
			if err := a.AppendRecording(id, base64.StdEncoding.EncodeToString(payload)); err != nil {
				t.Fatal(err)
			}
			if tc.corrupt {
				if err := os.WriteFile(filepath.Join(home, ".exbase", "general.json"), []byte("broken"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			destination := filepath.Join(home, "saved")
			got, err := a.finishRecording(id, func(options runtime.SaveDialogOptions) (string, error) {
				if options.Title != "Save recording" || filepath.Ext(options.DefaultFilename) != ".mp4" {
					t.Fatal("incorrect save dialog options", options)
				}
				if tc.dialogErr {
					return "", errors.New("dialog failed")
				}
				if tc.save {
					return destination, nil
				}
				return "", nil
			})
			wantPath := ""
			if tc.keep {
				wantPath = source
			}
			if tc.save {
				wantPath = destination + ".mp4"
			}
			if tc.dialogErr || tc.corrupt {
				if err == nil || !strings.Contains(err.Error(), source) {
					t.Fatal("recovery path missing", err)
				}
				wantPath = source
			} else if err != nil || got != wantPath {
				t.Fatal("unexpected finish result", got, err)
			}
			if wantPath != "" {
				data, err := os.ReadFile(wantPath)
				if err != nil || string(data) != string(payload) {
					t.Fatal("recording damaged or lost", err)
				}
			}
			if tc.save || (!tc.keep && !tc.dialogErr && !tc.corrupt) {
				if _, err := os.Stat(source); !os.IsNotExist(err) {
					t.Fatal("temporary recording retained", err)
				}
			}
			if a.recordingID != "" || a.recordingSaving || a.recordingFile != nil {
				t.Fatal("recording state was not released")
			}
		})
	}
}

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

func TestPrepareRecordingForEditor(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	a := NewApp()
	id, err := a.BeginRecording("Canvas.excalidraw", "mp4")
	if err != nil {
		t.Fatal(err)
	}
	// Large files bypass the bridge. Range reads must work before Export.
	payload := strings.Repeat("v", 11<<20)
	if err := a.AppendRecording(id, base64.StdEncoding.EncodeToString([]byte(payload))); err != nil {
		t.Fatal(err)
	}
	video, err := a.PrepareRecording(id)
	if err != nil {
		t.Fatal(err)
	}
	if a.recordingID != "" || a.recordingFile != nil {
		t.Fatal("editor still blocks window close or a new recording")
	}
	if _, err := a.PrepareRecording(id); err == nil {
		t.Fatal("stale recording accepted")
	}
	r := httptest.NewRequest(http.MethodGet, video.URL, nil)
	r.Header.Set("Range", "bytes=100-109")
	w := httptest.NewRecorder()
	PresentationMediaHandler(a).ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "vvvvvvvvvv" {
		t.Fatal(w.Code, w.Body.String())
	}
	unrelated := a.registerPresentationVideo(video.Path)
	if _, err := a.saveRecordingVideo(unrelated.Token, func(runtime.SaveDialogOptions) (string, error) {
		t.Fatal("unrelated video reached save")
		return "", nil
	}); err == nil {
		t.Fatal("non-recording token accepted")
	}
	saved := filepath.Join(home, "export.mp4")
	path, err := a.saveRecordingVideo(video.Token, func(runtime.SaveDialogOptions) (string, error) { return saved, nil })
	if err != nil || path != saved {
		t.Fatal(path, err)
	}
	info, err := os.Stat(saved)
	if err != nil || info.Size() != int64(len(payload)) {
		t.Fatal("saved bytes lost", err)
	}
	a.ReleasePresentationVideo(video.Token)
	w = httptest.NewRecorder()
	PresentationMediaHandler(a).ServeHTTP(w, r)
	if w.Code != 404 || a.recordingMedia[video.Token] != "" {
		t.Fatal("media token was not released")
	}
}
