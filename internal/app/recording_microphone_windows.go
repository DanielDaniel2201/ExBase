package app

import (
	"bufio"
	"errors"
	"fmt"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// DirectShow captures the microphone directly, avoiding WebView2 permission
// requests which can remain pending indefinitely in desktop webviews.
func (a *App) StartRecordingMicrophone(id string) error {
	a.recordingMu.Lock()
	defer a.recordingMu.Unlock()
	encoder := a.recordingEncoder
	if id == "" || id != a.recordingID || encoder == nil || a.recordingSaving {
		return errors.New("recording is no longer active")
	}
	if encoder.audioProcess != nil {
		return errors.New("audio capture is already active")
	}
	output, _ := recordingCommand(encoder.ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy").CombinedOutput()
	deviceName := defaultRecordingMicrophone(string(output))
	if deviceName == "" {
		return errors.New("no microphone was found; connect one or disable Record microphone in General")
	}
	encoder.audioPath = a.recordingPath + ".audio.pcm"
	encoder.audioRaw = true
	// Disable console input: hidden Windows capture helpers otherwise can stall
	// reading keyboard commands. Raw PCM stays valid when the helper is stopped.
	command := recordingCommand(encoder.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-progress", "pipe:1", "-stats_period", "0.1", "-f", "dshow", "-i", "audio="+deviceName, "-vn", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1", "-f", "s16le", "-flush_packets", "1", encoder.audioPath)
	command.Stderr = &encoder.audioLog
	progress, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	if err := startRecordingCommand(command); err != nil {
		progress.Close()
		return err
	}
	encoder.audioProcess, encoder.audioDone = command, make(chan struct{})
	ready := make(chan struct{})
	go func() {
		scanner := bufio.NewScanner(progress)
		detected := false
		for scanner.Scan() {
			if !detected && strings.HasPrefix(scanner.Text(), "out_time_us=") {
				microseconds, _ := strconv.ParseInt(strings.TrimPrefix(scanner.Text(), "out_time_us="), 10, 64)
				if microseconds > 0 {
					encoder.audioOffset = time.Since(encoder.started).Seconds() - float64(microseconds)/1e6
					if encoder.audioOffset < 0 {
						encoder.audioOffset = 0
					}
					detected = true
					close(ready)
				}
			}
		}
		encoder.audioError = command.Wait()
		close(encoder.audioDone)
	}()
	select {
	case <-ready:
		return nil
	case <-encoder.audioDone:
		return fmt.Errorf("could not open the microphone: %s", encoder.audioLog.String())
	case <-time.After(5 * time.Second):
		command.Process.Kill()
		<-encoder.audioDone
		return errors.New("the microphone did not start; check Windows microphone privacy settings")
	}
}

func defaultRecordingMicrophone(devices string) string {
	defaultID := strings.ToLower(defaultCaptureEndpointID())
	name, first := "", ""
	pattern := regexp.MustCompile(`"([^"\r\n]+)" \(audio\)`)
	for _, line := range strings.Split(devices, "\n") {
		if match := pattern.FindStringSubmatch(line); len(match) == 2 {
			name = match[1]
			if first == "" {
				first = name
			}
		}
		if defaultID != "" && strings.Contains(strings.ToLower(line), defaultID) {
			return name
		}
	}
	return first
}

// Match the Windows default capture endpoint to DirectShow's wave_{GUID} alias.
// This follows the user's Windows input selection instead of picking a webcam
// or disconnected input simply because it was enumerated first.
func defaultCaptureEndpointID() string {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	ole := windows.NewLazySystemDLL("ole32.dll")
	initialized, _, _ := ole.NewProc("CoInitializeEx").Call(0, 0)
	if int32(initialized) >= 0 {
		defer ole.NewProc("CoUninitialize").Call()
	}
	class, _ := windows.GUIDFromString("{BCDE0395-E52F-467C-8E3D-C4579291692E}")
	iid, _ := windows.GUIDFromString("{A95664D2-9614-4F35-A746-DE8DB63617E6}")
	var enumerator, device, id uintptr
	result, _, _ := ole.NewProc("CoCreateInstance").Call(uintptr(unsafe.Pointer(&class)), 0, 1, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&enumerator)))
	if int32(result) < 0 || enumerator == 0 {
		return ""
	}
	call := func(object uintptr, index int, args ...uintptr) uintptr {
		table := *(*uintptr)(unsafe.Pointer(object))
		method := (*[16]uintptr)(unsafe.Pointer(table))[index]
		value, _, _ := syscall.SyscallN(method, append([]uintptr{object}, args...)...)
		return value
	}
	defer call(enumerator, 2)
	if int32(call(enumerator, 4, 1, 0, uintptr(unsafe.Pointer(&device)))) < 0 || device == 0 {
		return ""
	}
	defer call(device, 2)
	if int32(call(device, 5, uintptr(unsafe.Pointer(&id)))) < 0 || id == 0 {
		return ""
	}
	defer ole.NewProc("CoTaskMemFree").Call(id)
	text := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(id)))
	if offset := strings.LastIndex(text, "{"); offset >= 0 {
		return text[offset:]
	}
	return ""
}
