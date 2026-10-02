package fileio

import (
	"os"
	"path/filepath"
)

// Keep the previous file intact until the complete replacement is ready.
func Replace(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".exbase-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
