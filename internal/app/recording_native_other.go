//go:build !windows

package app

import "errors"

func nativeRecordingBegin(string, bool) error      { return errors.New("MP4 recording requires Windows") }
func nativeRecordingFrame([]byte) error            { return errors.New("MP4 recording requires Windows") }
func nativeRecordingMicrophone() error             { return errors.New("microphone recording requires Windows") }
func nativeRecordingFinish() error                 { return nil }
func nativePresentationBegin(string, string) error { return errors.New("MP4 export requires Windows") }
func setRecordingWebcam(int, int, int, bool) error { return errors.New("webcam recording requires Windows") }
func disableRecordingWebcam() error                { return nil }
