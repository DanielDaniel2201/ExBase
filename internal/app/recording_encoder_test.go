package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestMP4Recording(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("native MP4 recording requires Windows")
	}
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	a := NewApp()
	id, err := a.BeginMP4Recording("recording-check.excalidraw", false)
	if err != nil {
		t.Fatal(err)
	}
	defer a.AbortRecording(id)
	if err := a.AppendRecordingFrame("stale", "!!"); err == nil {
		t.Fatal("invalid frame accepted")
	}
	frame := image.NewRGBA(image.Rect(0, 0, 1920, 1080))
	var encoded bytes.Buffer
	for _, fill := range []color.RGBA{{R: 255, A: 255}, {B: 255, A: 255}} {
		for y := 0; y < 1080; y++ {
			for x := 0; x < 1920; x++ {
				frame.SetRGBA(x, y, fill)
			}
		}
		encoded.Reset()
		if err := png.Encode(&encoded, frame); err != nil {
			t.Fatal(err)
		}
		if err := a.AppendRecordingFrame(id, base64.StdEncoding.EncodeToString(encoded.Bytes())); err != nil {
			t.Fatal(err)
		}
		time.Sleep(80 * time.Millisecond)
	}
	path, err := a.FinalizeRecording(id)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) < 1000 {
		t.Fatal("empty recording", err)
	}
	if filepath.Ext(path) != ".mp4" || !bytes.Contains(data[:64], []byte("ftyp")) {
		t.Fatal("invalid MP4 container")
	}
	if !bytes.Contains(data, []byte("avc1")) || !bytes.Contains(data, []byte("moov")) || !bytes.Contains(data, []byte("mdat")) {
		t.Fatal("MP4 was not finalized with H.264 video")
	}
	if err := a.AbortRecording(id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("finalized recovery file was lost", err)
	}
	// Empty cancellations must release the process and close guard.
	id, err = a.BeginMP4Recording("cancelled", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.AbortRecording(id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".exbase", "recordings", id)); !os.IsNotExist(err) {
		t.Fatal("empty cancellation retained", err)
	}
}
