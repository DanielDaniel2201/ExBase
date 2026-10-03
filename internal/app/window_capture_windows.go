//go:build windows

package app

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

var captureUser32 = syscall.NewLazyDLL("user32.dll")
var captureGDI32 = syscall.NewLazyDLL("gdi32.dll")
var captureEnumWindows = captureUser32.NewProc("EnumWindows")
var captureWindowPID = captureUser32.NewProc("GetWindowThreadProcessId")
var captureWindowClass = captureUser32.NewProc("GetClassNameW")
var captureVisible = captureUser32.NewProc("IsWindowVisible")
var captureIconic = captureUser32.NewProc("IsIconic")
var captureClientRect = captureUser32.NewProc("GetClientRect")
var capturePrintWindow = captureUser32.NewProc("PrintWindow")
var captureCreateDC = captureGDI32.NewProc("CreateCompatibleDC")
var captureDeleteDC = captureGDI32.NewProc("DeleteDC")
var captureCreateDIB = captureGDI32.NewProc("CreateDIBSection")
var captureSelectObject = captureGDI32.NewProc("SelectObject")
var captureDeleteObject = captureGDI32.NewProc("DeleteObject")
var captureFlush = captureGDI32.NewProc("GdiFlush")

type captureWindowSearch struct {
	pid    uint32
	window uintptr
}

// Allocate the callback once: syscall.NewCallback callbacks cannot be freed.
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

type captureBitmapInfo struct {
	Size                             uint32
	Width, Height                    int32
	Planes, BitCount                 uint16
	Compression, SizeImage           uint32
	XPixelsPerMeter, YPixelsPerMeter int32
	ColorsUsed, ColorsImportant      uint32
}

func captureApplicationWindow() (string, error) {
	// GDI contexts belong to the OS thread that creates them.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	search := captureWindowSearch{pid: uint32(os.Getpid())}
	captureEnumWindows.Call(captureWindowCallback, uintptr(unsafe.Pointer(&search)))
	if search.window == 0 {
		return "", errors.New("could not find ExBase's own window")
	}
	minimised, _, _ := captureIconic.Call(search.window)
	if minimised != 0 {
		return "", nil
	} // Preserve the last frame while minimised.
	var rect struct{ Left, Top, Right, Bottom int32 }
	result, _, _ := captureClientRect.Call(search.window, uintptr(unsafe.Pointer(&rect)))
	if result == 0 {
		return "", errors.New("could not read the ExBase window size")
	}
	width, height := int(rect.Right-rect.Left), int(rect.Bottom-rect.Top)
	if width <= 0 || height <= 0 {
		return "", nil
	}
	if width > 8192 || height > 8192 || width*height > 32*1024*1024 {
		return "", errors.New("the application window is too large to record")
	}
	dc, _, _ := captureCreateDC.Call(0)
	if dc == 0 {
		return "", errors.New("could not create a window capture context")
	}
	defer captureDeleteDC.Call(dc)
	info := captureBitmapInfo{Size: uint32(unsafe.Sizeof(captureBitmapInfo{})), Width: int32(width), Height: -int32(height), Planes: 1, BitCount: 32}
	var pixels uintptr
	bitmap, _, _ := captureCreateDIB.Call(dc, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&pixels)), 0, 0)
	if bitmap == 0 || pixels == 0 {
		return "", errors.New("could not allocate a window capture bitmap")
	}
	defer captureDeleteObject.Call(bitmap)
	previous, _, _ := captureSelectObject.Call(dc, bitmap)
	if previous == 0 || previous == ^uintptr(0) {
		return "", errors.New("could not select the window capture bitmap")
	}
	defer captureSelectObject.Call(dc, previous)
	// Capture this process's client area, including WebView2's composited content.
	// PW_CLIENTONLY | PW_RENDERFULLCONTENT never samples the desktop or another app.
	result, _, _ = capturePrintWindow.Call(search.window, dc, 0x1|0x2)
	if result == 0 {
		return "", errors.New("could not capture the ExBase window")
	}
	captureFlush.Call()
	source := unsafe.Slice((*byte)(unsafe.Pointer(pixels)), width*height*4)
	frame := image.NewRGBA(image.Rect(0, 0, width, height))
	for offset := 0; offset < len(source); offset += 4 {
		frame.Pix[offset], frame.Pix[offset+1], frame.Pix[offset+2], frame.Pix[offset+3] = source[offset+2], source[offset+1], source[offset], 255
	}
	var encoded bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&encoded, frame); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes()), nil
}
