//go:build !windows

package app

import "errors"

func (a *App) StartRecordingMicrophone(id string) error {
	return errors.New("native microphone recording is currently supported on Windows")
}
