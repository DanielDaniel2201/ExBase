package app

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const recordingFPS = 20

type mp4Encoder struct {
	command      *exec.Cmd
	input        io.WriteCloser
	log          bytes.Buffer
	started      time.Time
	frames       int
	lastFrame    []byte
	audioOffset  float64
	audioPath    string
	audioRaw     bool
	audioProcess *exec.Cmd
	audioDone    chan struct{}
	audioError   error
	audioLog     bytes.Buffer
	ffmpeg       string
}

func recordingFFmpeg() (string, error) {
	executable, _ := os.Executable()
	for _, path := range []string{filepath.Join(filepath.Dir(executable), "ffmpeg.exe"), filepath.Join(".tools", "ffmpeg", "ffmpeg.exe")} {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return filepath.Abs(path)
		}
	}
	if path, err := exec.LookPath("ffmpeg"); err == nil {
		return path, nil
	}
	return "", errors.New("the recording encoder is missing; keep ffmpeg.exe beside ExBase.exe")
}

func (a *App) BeginMP4Recording(name string) (string, error) {
	ffmpeg, err := recordingFFmpeg()
	if err != nil {
		return "", err
	}
	id, err := a.BeginRecording(name, "mp4")
	if err != nil {
		return "", err
	}
	a.recordingMu.Lock()
	a.recordingFile.Close()
	a.recordingFile = nil
	encoder := &mp4Encoder{ffmpeg: ffmpeg, started: time.Now()}
	encoder.command = recordingCommand(ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-vcodec", "png", "-framerate", "20", "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.recordingPath)
	encoder.command.Stderr = &encoder.log
	encoder.input, err = encoder.command.StdinPipe()
	if err == nil {
		err = startRecordingCommand(encoder.command)
	}
	if err == nil {
		a.recordingEncoder = encoder
	}
	a.recordingMu.Unlock()
	if err != nil {
		if encoder.input != nil {
			encoder.input.Close()
		}
		a.AbortRecording(id)
		return "", err
	}
	return id, nil
}

// PNG frames bypass WebView2's GPU canvas stream and hardware video encoder.
// Duplicate the previous frame to keep wall-clock timing under bridge backpressure.
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
	target := int(time.Since(encoder.started).Seconds()*recordingFPS) + 1
	for encoder.frames < target-1 && len(encoder.lastFrame) > 0 {
		if _, err := encoder.input.Write(encoder.lastFrame); err != nil {
			return fmt.Errorf("video encoding failed: %w", err)
		}
		encoder.frames++
	}
	if _, err := encoder.input.Write(data); err != nil {
		return fmt.Errorf("video encoding failed: %w", err)
	}
	encoder.frames++
	encoder.lastFrame = data
	return nil
}

func (a *App) finalizeMP4Locked() error {
	encoder := a.recordingEncoder
	if encoder == nil {
		return nil
	}
	a.recordingEncoder = nil
	target := int(time.Since(encoder.started).Seconds()*recordingFPS) + 1
	for encoder.frames < target && len(encoder.lastFrame) > 0 {
		if _, err := encoder.input.Write(encoder.lastFrame); err != nil {
			break
		}
		encoder.frames++
	}
	encoder.input.Close()
	if encoder.audioProcess != nil {
		select {
		case <-encoder.audioDone:
		default:
			encoder.audioProcess.Process.Kill()
			<-encoder.audioDone
			encoder.audioError = nil
		}
	}
	err := encoder.command.Wait()
	if encoder.audioProcess != nil {
		if encoder.audioError != nil {
			return fmt.Errorf("microphone capture failed; video kept at %s: %s: %w", a.recordingPath, encoder.audioLog.String(), encoder.audioError)
		}
	}
	if err != nil || encoder.frames == 0 {
		return fmt.Errorf("video encoding failed: %v %s", err, encoder.log.String())
	}
	if encoder.audioPath != "" {
		audioPath, muxPath := encoder.audioPath, a.recordingPath+".mux.mp4"
		args := []string{"-hide_banner", "-loglevel", "error", "-y", "-i", a.recordingPath}
		if encoder.audioRaw {
			args = append(args, "-f", "s16le", "-ar", "48000", "-ac", "1")
		}
		args = append(args, "-itsoffset", fmt.Sprintf("%.6f", encoder.audioOffset), "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-af", "apad", "-t", fmt.Sprintf("%.6f", float64(encoder.frames)/recordingFPS), "-movflags", "+faststart", muxPath)
		command := recordingCommand(encoder.ffmpeg, args...)
		if output, err := command.CombinedOutput(); err != nil {
			return fmt.Errorf("audio encoding failed; recovery files kept: %s: %w", output, err)
		}
		if err := os.Rename(muxPath, a.recordingPath); err != nil {
			return err
		}
		os.Remove(audioPath)
	}
	return nil
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
