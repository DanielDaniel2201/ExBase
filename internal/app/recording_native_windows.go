//go:build windows

package app

import (
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

//go:embed native/recording.dll
var recordingLibrary []byte

var nativeRecorder struct {
	once     sync.Once
	requests chan func()
	library  *windows.DLL
	err      error
}

// Media Foundation, WIC and WinRT objects stay on one COM-initialized thread.
func recordingNativeCall(action func() error) error {
	nativeRecorder.once.Do(func() {
		nativeRecorder.requests = make(chan func())
		initialized := make(chan struct{})
		go func() {
			runtime.LockOSThread()
			cache, err := os.UserCacheDir()
			if err == nil {
				hash := sha256.Sum256(recordingLibrary)
				dir := filepath.Join(cache, "ExBase", "native", fmt.Sprintf("%x", hash[:12]))
				err = os.MkdirAll(dir, 0700)
				path := filepath.Join(dir, "recording.dll")
				if err == nil {
					existing, readErr := os.ReadFile(path)
					if readErr != nil || sha256.Sum256(existing) != hash {
						var file *os.File
						file, err = os.CreateTemp(dir, "recording-*.dll")
						if err == nil {
							_, err = file.Write(recordingLibrary)
							closeErr := file.Close()
							if err == nil {
								err = closeErr
							}
							if err == nil {
								err = os.Rename(file.Name(), path)
							}
							os.Remove(file.Name())
						}
					}
				}
				if err == nil {
					nativeRecorder.library, err = windows.LoadDLL(path)
				}
				if err == nil {
					err = recordingNativeInvoke("RecordingInitialize")
				}
			}
			nativeRecorder.err = err
			close(initialized)
			for request := range nativeRecorder.requests {
				request()
			}
		}()
		<-initialized
	})
	if nativeRecorder.err != nil {
		return fmt.Errorf("Windows recording is unavailable: %w", nativeRecorder.err)
	}
	done := make(chan error, 1)
	nativeRecorder.requests <- func() { done <- action() }
	return <-done
}

// Keep pointers converted to uintptr alive and off movable Go stacks until the call returns.
//go:uintptrescapes
func recordingNativeInvoke(name string, args ...uintptr) error {
	procedure, err := nativeRecorder.library.FindProc(name)
	if err != nil {
		return err
	}
	result, _, _ := procedure.Call(args...)
	if int32(result) >= 0 {
		return nil
	}
	message, _ := nativeRecorder.library.FindProc("RecordingError")
	address, _, _ := message.Call()
	detail := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(address)))
	return fmt.Errorf("Windows recording failed (0x%08X): %s", uint32(result), detail)
}

func nativeRecordingBegin(path string, microphone bool) error {
	return recordingNativeCall(func() error {
		name, err := windows.UTF16PtrFromString(path)
		if err != nil {
			return err
		}
		audio := uintptr(0)
		if microphone {
			audio = 1
		}
		return recordingNativeInvoke("RecordingBegin", uintptr(unsafe.Pointer(name)), audio)
	})
}
func nativeRecordingFrame(data []byte) error {
	return recordingNativeCall(func() error {
		return recordingNativeInvoke("RecordingFrame", uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
	})
}
func nativeRecordingMicrophone() error {
	return recordingNativeCall(func() error { return recordingNativeInvoke("RecordingMicrophone") })
}
func nativeRecordingFinish() error {
	return recordingNativeCall(func() error { return recordingNativeInvoke("RecordingFinish") })
}
func nativeRecordingWindow(window uintptr) (string, error) {
	var encoded string
	err := recordingNativeCall(func() error {
		var data uintptr
		var size uint32
		if err := recordingNativeInvoke("RecordingWindow", window, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&size))); err != nil {
			return err
		}
		free, _ := nativeRecorder.library.FindProc("RecordingFree")
		defer free.Call(data)
		encoded = "data:image/png;base64," + base64.StdEncoding.EncodeToString(unsafe.Slice((*byte)(unsafe.Pointer(data)), int(size)))
		return nil
	})
	return encoded, err
}
