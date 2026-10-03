package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMP4RecordingWithAudio(t *testing.T) {
	ffmpeg, err := recordingFFmpeg()
	if err != nil {
		t.Skip("FFmpeg integration check requires the recording encoder")
	}
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	a := NewApp()
	id, err := a.BeginMP4Recording("recording-check.excalidraw")
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
	audioPath := a.recordingPath + ".audio.wav"
	if output, err := recordingCommand(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-c:a", "pcm_s16le", audioPath).CombinedOutput(); err != nil {
		t.Fatalf("test audio failed: %s: %v", output, err)
	}
	a.recordingEncoder.audioPath = audioPath
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
	metadata, err := recordingCommand(ffmpeg, "-v", "error", "-i", path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-").CombinedOutput()
	if err != nil {
		t.Fatalf("video and audio did not decode: %s: %v", metadata, err)
	}
	pcm, err := recordingCommand(ffmpeg, "-v", "error", "-i", path, "-vn", "-f", "s16le", "pipe:1").Output()
	if err != nil || len(pcm) < 1000 || bytes.Equal(pcm, make([]byte, len(pcm))) {
		t.Fatal("audio is missing or silent", err)
	}
	if _, err := os.Stat(audioPath); !os.IsNotExist(err) {
		t.Fatal("audio scratch file was retained", err)
	}
	if err := a.AbortRecording(id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("finalized recovery file was lost", err)
	}
	// Empty cancellations must release the process and close guard.
	id, err = a.BeginMP4Recording("cancelled")
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
