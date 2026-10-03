//go:build windows

package app

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

var captureUser32 = syscall.NewLazyDLL("user32.dll")
var captureEnumWindows = captureUser32.NewProc("EnumWindows")
var captureWindowPID = captureUser32.NewProc("GetWindowThreadProcessId")
var captureWindowClass = captureUser32.NewProc("GetClassNameW")
var captureVisible = captureUser32.NewProc("IsWindowVisible")
var captureIconic = captureUser32.NewProc("IsIconic")

type captureWindowSearch struct {
	pid    uint32
	window uintptr
}

// Allocate once: syscall.NewCallback callbacks cannot be freed.
var captureWindowCallback = syscall.NewCallback(func(window, parameter uintptr) uintptr {
	search := (*captureWindowSearch)(unsafe.Pointer(parameter))
	var pid uint32
	captureWindowPID.Call(window, uintptr(unsafe.Pointer(&pid)))
	if pid != search.pid {
		return 1
	}
	var class [64]uint16
	captureWindowClass.Call(window, uintptr(unsafe.Pointer(&class[0])), uintptr(len(class)))
	visible, _, _ := captureVisible.Call(window)
	if visible != 0 && syscall.UTF16ToString(class[:]) == "wailsWindow" {
		search.window = window
		return 0
	}
	return 1
})

func captureApplicationWindow() (string, error) {
	search := captureWindowSearch{pid: uint32(os.Getpid())}
	captureEnumWindows.Call(captureWindowCallback, uintptr(unsafe.Pointer(&search)))
	if search.window == 0 {
		return "", errors.New("could not find ExBase's own window")
	}
	minimised, _, _ := captureIconic.Call(search.window)
	if minimised != 0 {
		return "", nil
	} // Preserve the last frame while minimised.
	return nativeRecordingWindow(search.window)
}
