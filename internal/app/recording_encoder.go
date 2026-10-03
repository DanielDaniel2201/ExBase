package app

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image/png"
	"os"
)

type mp4Encoder struct {
	frames     int
	microphone bool
}

func (a *App) BeginMP4Recording(name string, microphone bool) (string, error) {
	id, err := a.BeginRecording(name, "mp4")
	if err != nil {
		return "", err
	}
	a.recordingMu.Lock()
	a.recordingFile.Close()
	a.recordingFile = nil
	err = nativeRecordingBegin(a.recordingPath, microphone)
	if err == nil {
		a.recordingEncoder = &mp4Encoder{microphone: microphone}
	} else {
		os.Remove(a.recordingPath)
	}
	a.recordingMu.Unlock()
	if err != nil {
		a.AbortRecording(id)
		return "", err
	}
	return id, nil
}

// Canvas PNGs are decoded with WIC and fed to the Windows H.264 encoder.
func (a *App) AppendRecordingFrame(id, encoded string) error {
	if len(encoded) > 16*1024*1024 {
		return errors.New("recording frame is too large")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return errors.New("invalid recording frame")
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != 1920 || config.Height != 1080 {
		return errors.New("invalid recording frame dimensions")
	}
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	encoder := a.recordingEncoder
	if id == "" || id != a.recordingID || encoder == nil || a.recordingSaving {
		return errors.New("recording is no longer active")
	}
	if err := nativeRecordingFrame(data); err != nil {
		return err
	}
	encoder.frames++
	return nil
}

func (a *App) StartRecordingMicrophone(id string) error {
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	encoder := a.recordingEncoder
	if id == "" || id != a.recordingID || encoder == nil || !encoder.microphone || a.recordingSaving {
		return errors.New("recording is no longer active")
	}
	return nativeRecordingMicrophone()
}

func (a *App) finalizeMP4Locked() error {
	encoder := a.recordingEncoder
	if encoder == nil {
		return nil
	}
	a.recordingEncoder = nil
	err := nativeRecordingFinish()
	if encoder.frames == 0 {
		os.Remove(a.recordingPath)
		return errors.New("no video frames were captured; the recording was not saved")
	}
	return err
}

// Finalize without a save dialog so native diagnostics can verify the exact bytes.
func (a *App) FinalizeRecording(id string) (string, error) {
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	if id == "" || id != a.recordingID || a.recordingSaving {
		return "", errors.New("recording is no longer active")
	}
	if err := a.finalizeMP4Locked(); err != nil {
		return "", err
	}
	return a.recordingPath, nil
}
