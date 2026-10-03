//go:build !windows

package app

import "errors"

func captureApplicationWindow() (string, error) {
	return "", errors.New("application window recording is currently supported on Windows")
}
