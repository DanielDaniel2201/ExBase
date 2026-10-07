package app

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) CaptureApplicationFrame() (string, error) {
	return captureApplicationWindow()
}

// Write each recorder chunk to disk so long recordings don't accumulate in RAM.
func (a *App) BeginRecording(name, format string) (string, error) {
	if format != "mp4" && format != "webm" {
		return "", errors.New("unsupported recording format")
	}
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	if a.recordingID != "" {
		return "", errors.New("a recording is already active")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".exbase", "recordings")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(dir, "recording-"+time.Now().Format("20060102-150405")+"-*."+format)
	if err != nil {
		return "", err
	}
	a.recordingFile, a.recordingPath = file, file.Name()
	a.recordingID = filepath.Base(file.Name())
	name = strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	if name == "" || name == "." {
		name = "ExBase"
	}
	a.recordingName = name + "-" + time.Now().Format("20060102-150405") + "." + format
	return a.recordingID, nil
}

func (a *App) AppendRecording(id, encoded string) error {
	if len(encoded) > 24*1024*1024 {
		return errors.New("recording chunk is too large")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 {
		return errors.New("invalid recording chunk")
	}
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	if id == "" || id != a.recordingID || a.recordingFile == nil {
		return errors.New("recording is no longer active")
	}
	_, err = a.recordingFile.Write(data)
	return err
}

func (a *App) AbortRecording(id string) error {
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	if id == "" || id != a.recordingID || a.recordingSaving {
		return errors.New("recording is no longer active")
	}
	if a.recordingFile != nil {
		a.recordingFile.Close()
		a.recordingFile = nil
	}
	encodeErr := a.finalizeMP4Locked()
	info, err := os.Stat(a.recordingPath)
	if os.IsNotExist(err) {
		a.recordingID = ""
		return nil
	}
	// Keep any captured frames as a recovery file, including after a write error.
	if err == nil && info.Size() == 0 {
		err = os.Remove(a.recordingPath)
	}
	a.recordingID = ""
	if encodeErr != nil && err == nil && info.Size() > 0 {
		return encodeErr
	}
	return err
}

func (a *App) FinishRecording(id string) (string, error) {
	return a.finishRecording(id, func(options runtime.SaveDialogOptions) (string, error) {
		return runtime.SaveFileDialog(a.ctx, options)
	})
}

// PrepareRecording closes the encoder before exposing a seekable local video.
// The editor owns the selected media token; native recording is no longer active.
func (a *App) PrepareRecording(id string) (PresentationVideo, error) {
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	if id == "" || id != a.recordingID || a.recordingSaving {
		return PresentationVideo{}, errors.New("recording is no longer active")
	}
	if err := a.finalizeMP4Locked(); err != nil {
		return PresentationVideo{}, err
	}
	if a.recordingFile != nil {
		info, err := a.recordingFile.Stat()
		if err != nil || info.Size() == 0 {
			return PresentationVideo{}, errors.New("no video frames were captured")
		}
		if err := a.recordingFile.Sync(); err != nil {
			return PresentationVideo{}, err
		}
		if err := a.recordingFile.Close(); err != nil {
			return PresentationVideo{}, err
		}
		a.recordingFile = nil
	}
	video := a.registerPresentationVideo(a.recordingPath)
	a.presentationMu.Lock()
	if a.recordingMedia == nil {
		a.recordingMedia = map[string]string{}
	}
	a.recordingMedia[video.Token] = a.recordingName
	a.presentationMu.Unlock()
	a.recordingID = ""
	return video, nil
}

// Save an already finalized recording through the same cancellation policy.
func (a *App) SaveRecordingVideo(token string) (string, error) {
	return a.saveRecordingVideo(token, func(options runtime.SaveDialogOptions) (string, error) {
		return runtime.SaveFileDialog(a.ctx, options)
	})
}

func (a *App) saveRecordingVideo(token string, dialog func(runtime.SaveDialogOptions) (string, error)) (string, error) {
	a.presentationMu.Lock()
	source := a.presentationMedia[token]
	name := a.recordingMedia[token]
	a.presentationMu.Unlock()
	if source == "" || name == "" {
		return "", errors.New("recording is no longer available")
	}
	a.recordingMu.Lock()
	if a.recordingID != "" {
		a.recordingMu.Unlock()
		return "", errors.New("a recording is already active")
	}
	a.recordingID, a.recordingPath, a.recordingName = filepath.Base(source), source, name
	id := a.recordingID
	a.recordingMu.Unlock()
	return a.finishRecording(id, dialog)
}

func (a *App) finishRecording(id string, saveDialog func(runtime.SaveDialogOptions) (string, error)) (string, error) {
	a.recordingMu.Lock()
	if id == "" || id != a.recordingID || a.recordingSaving {
		a.recordingMu.Unlock()
		return "", errors.New("recording is no longer active")
	}
	if err := a.finalizeMP4Locked(); err != nil {
		a.recordingMu.Unlock()
		return "", fmt.Errorf("recording kept at %s: %w", a.recordingPath, err)
	}
	if a.recordingFile != nil {
		info, err := a.recordingFile.Stat()
		if err != nil || info.Size() == 0 {
			a.recordingMu.Unlock()
			return "", errors.New("no video frames were captured; the recording was not saved")
		}
		err = a.recordingFile.Sync()
		closeErr := a.recordingFile.Close()
		a.recordingFile = nil
		if err == nil {
			err = closeErr
		}
		if err != nil {
			a.recordingMu.Unlock()
			return "", err
		}
	}
	source, name := a.recordingPath, a.recordingName
	extension := filepath.Ext(source)
	a.recordingSaving = true
	a.recordingMu.Unlock()
	defer func() { a.recordingMu.Lock(); a.recordingSaving = false; a.recordingID = ""; a.recordingMu.Unlock() }()
	path, err := saveDialog(runtime.SaveDialogOptions{
		Title: "Save recording", DefaultFilename: name,
		Filters: []runtime.FileFilter{{DisplayName: strings.ToUpper(strings.TrimPrefix(extension, ".")) + " video", Pattern: "*" + extension}},
	})
	if err != nil {
		return "", fmt.Errorf("recording kept at %s: %w", source, err)
	}
	if path == "" {
		settings, err := a.LoadGeneralSettings()
		if err != nil {
			return "", fmt.Errorf("recording kept at %s: %w", source, err)
		}
		if settings.KeepRecordingOnCancel {
			return source, nil
		}
		if err := os.Remove(source); err != nil {
			return "", fmt.Errorf("recording could not be discarded; kept at %s: %w", source, err)
		}
		return "", nil
	}
	if !strings.EqualFold(filepath.Ext(path), extension) {
		path += extension
	}
	if filepath.Clean(path) == filepath.Clean(source) {
		return source, nil
	}
	if err := copyRecording(source, path); err != nil {
		return "", fmt.Errorf("recording kept at %s: %w", source, err)
	}
	if err := os.Remove(source); err != nil {
		return path, fmt.Errorf("video saved; recovery copy could not be removed: %w", err)
	}
	return path, nil
}

func copyRecording(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.CreateTemp(filepath.Dir(destination), ".exbase-recording-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(output.Name())
	_, err = io.Copy(output, input)
	if err == nil {
		err = output.Sync()
	}
	closeErr := output.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(output.Name(), destination)
}

func BeforeClose(a *App, ctx context.Context) bool {
	a.recordingMu.Lock()
	active := a.recordingID != ""
	a.recordingMu.Unlock()
	if active {
		runtime.EventsEmit(ctx, "recording:close-requested")
	}
	return active
}

// SetRecordingWebcam configures webcam overlay for recording
func (a *App) SetRecordingWebcam(x, y, size int, circle bool) error {
	return setRecordingWebcam(x, y, size, circle)
}

// DisableRecordingWebcam turns off webcam overlay
func (a *App) DisableRecordingWebcam() error {
	return disableRecordingWebcam()
}
