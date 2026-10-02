package app

import (
	"encoding/base64"
	"testing"
)

func TestSlideExport(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("<!doctype html>"))
	if data, err := decodeSlideExport("html", encoded); err != nil || string(data) != "<!doctype html>" {
		t.Fatal(string(data), err)
	}
	if _, err := decodeSlideExport("exe", encoded); err == nil {
		t.Fatal("unsupported export format accepted")
	}
	if _, err := decodeSlideExport("pptx", "broken base64"); err == nil {
		t.Fatal("invalid export accepted")
	}
	if _, err := decodeSlideExport("html", ""); err == nil {
		t.Fatal("empty export accepted")
	}
}
