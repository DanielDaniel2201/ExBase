package app

import (
	"encoding/base64"
	"errors"
	"exbase/internal/fileio"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func decodeSlideExport(format, encoded string) ([]byte, error) {
	if format != "pptx" && format != "html" {
		return nil, errors.New("choose PPT or HTML export")
	}
	if len(encoded) > 256*1024*1024 {
		return nil, errors.New("export is too large (maximum 192 MB)")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 {
		return nil, errors.New("invalid export data")
	}
	return data, nil
}

func (a *App) ExportSlides(name, format, encoded string) (string, error) {
	data, err := decodeSlideExport(format, encoded)
	if err != nil {
		return "", err
	}
	name = strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export slides",
		DefaultFilename: name + "." + format,
		Filters:         []runtime.FileFilter{{DisplayName: strings.ToUpper(format), Pattern: "*." + format}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), "."+format) {
		path += "." + format
	}
	if err := fileio.Replace(path, data); err != nil {
		return "", err
	}
	return path, nil
}
