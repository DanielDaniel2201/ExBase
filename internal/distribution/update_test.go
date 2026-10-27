package distribution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersionOrdering(t *testing.T) {
	for _, test := range []struct {
		next, old string
		want      bool
	}{
		{"v0.1.10", "0.1.9", true}, {"0.2.0", "0.1.99", true}, {"0.1.1", "0.1.1", false},
		{"0.1.0", "0.1.2", false}, {"0.1.3", "dev", false}, {"bad", "0.1.0", false}, {"0.1.4-beta", "0.1.0", false},
	} {
		if got := newer(test.next, test.old); got != test.want {
			t.Errorf("newer(%q,%q) = %v", test.next, test.old, got)
		}
	}
}

func TestReleaseValidation(t *testing.T) {
	old := Version
	Version = "0.1.1"
	defer func() { Version = old }()
	valid := `{"tag_name":"v0.1.2","assets":[{"name":"ExBase-Setup.exe","browser_download_url":"https://github.com/DanielDaniel2201/ExBase/releases/download/v0.1.2/ExBase-Setup.exe","digest":"sha256:` + strings.Repeat("ab", 32) + `","size":100}]}`
	for _, test := range []struct {
		name, data string
		fail       bool
		available  bool
	}{
		{"valid", valid, false, true}, {"equal", strings.Replace(valid, "v0.1.2", "v0.1.1", 1), false, false},
		{"foreign repository", strings.ReplaceAll(valid, "DanielDaniel2201", "other"), true, false},
		{"HTTP URL", strings.Replace(valid, "https:", "http:", 1), true, false},
		{"missing digest", strings.Replace(valid, "sha256:", "", 1), true, false},
		{"oversized", strings.Replace(valid, `"size":100`, `"size":9999999999`, 1), true, false},
		{"missing asset", `{"tag_name":"v0.1.2","assets":[]}`, true, false},
		{"prerelease", strings.Replace(valid, `"assets":`, `"prerelease":true,"assets":`, 1), false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			r, err := readRelease(strings.NewReader(test.data))
			if (err != nil) != test.fail || r.Available != test.available {
				t.Fatalf("release=%+v err=%v", r, err)
			}
		})
	}
}

func TestDownloadVerification(t *testing.T) {
	payload := []byte("fixture-installer")
	digest := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, string(payload)) }))
	defer server.Close()
	for _, valid := range []bool{true, false} {
		r := Release{Available: true, URL: server.URL, Size: int64(len(payload)), Digest: hex.EncodeToString(digest[:])}
		if !valid {
			r.Digest = strings.Repeat("00", 32)
		}
		path, err := Download(context.Background(), r)
		if !valid {
			if err == nil || path != "" {
				t.Fatal("corrupt download accepted")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(filepath.Dir(path))
		data, err := os.ReadFile(path)
		if err != nil || string(data) != string(payload) {
			t.Fatal("download mismatch", err)
		}
	}
}
