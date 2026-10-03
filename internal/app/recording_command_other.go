//go:build !windows

package app

import "os/exec"

func recordingCommand(path string, args ...string) *exec.Cmd { return exec.Command(path, args...) }

func startRecordingCommand(command *exec.Cmd) error { return command.Start() }
