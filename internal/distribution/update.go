package distribution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Release builds set these through -ldflags; ordinary builds stay on dev.
var Version = "dev"
var Commit = ""

const repository = "DanielDaniel2201/ExBase"
const assetName = "ExBase-Setup.exe"
const maxDownload = 512 << 20

type Info struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	Installed bool   `json:"installed"`
}

type Release struct {
	Version   string `json:"version"`
	Available bool   `json:"available"`
	URL       string `json:"-"`
	Digest    string `json:"-"`
	Size      int64  `json:"-"`
}

func newer(candidate, current string) bool {
	parse := func(value string) ([3]uint64, bool) {
		var result [3]uint64
		parts := strings.Split(strings.TrimPrefix(value, "v"), ".")
		if len(parts) != 3 {
			return result, false
		}
		for i, part := range parts {
			if part == "" || strings.Trim(part, "0123456789") != "" {
				return result, false
			}
			n, err := strconv.ParseUint(part, 10, 64)
			if err != nil {
				return result, false
			}
			result[i] = n
		}
		return result, true
	}
	a, ok := parse(candidate)
	b, valid := parse(current)
	if !ok || !valid {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

func request(ctx context.Context, client *http.Client, target string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ExBase/"+Version)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("update server returned HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

func Check(ctx context.Context) (Release, error) {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := request(ctx, client, "https://api.github.com/repos/"+repository+"/releases/latest")
	if err != nil {
		return Release{}, err
	}
	defer resp.Body.Close()
	return readRelease(io.LimitReader(resp.Body, 2<<20))
}

func readRelease(reader io.Reader) (Release, error) {
	var data struct {
		Tag        string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name   string `json:"name"`
			URL    string `json:"browser_download_url"`
			Digest string `json:"digest"`
			Size   int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(reader).Decode(&data); err != nil {
		return Release{}, err
	}
	r := Release{Version: strings.TrimPrefix(data.Tag, "v")}
	if data.Draft || data.Prerelease || !newer(r.Version, Version) {
		return r, nil
	}
	for _, asset := range data.Assets {
		if asset.Name != assetName {
			continue
		}
		u, err := url.Parse(asset.URL)
		digest, digestErr := hex.DecodeString(strings.TrimPrefix(asset.Digest, "sha256:"))
		if err != nil || u.Scheme != "https" || u.Host != "github.com" || !strings.HasPrefix(u.Path, "/"+repository+"/releases/download/") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(asset.Digest, "sha256:") || digestErr != nil || len(digest) != sha256.Size || asset.Size <= 0 || asset.Size > maxDownload {
			return Release{}, errors.New("release has an invalid installer URL, size or SHA-256 digest")
		}
		r.Available, r.URL, r.Digest, r.Size = true, asset.URL, strings.ToLower(hex.EncodeToString(digest)), asset.Size
		return r, nil
	}
	return Release{}, errors.New("release does not contain ExBase-Setup.exe")
}

func Download(ctx context.Context, release Release) (string, error) {
	if !release.Available {
		return "", errors.New("no update available")
	}
	resp, err := request(ctx, &http.Client{Timeout: 10 * time.Minute}, release.URL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	dir, err := os.MkdirTemp("", "ExBase-update-")
	if err != nil {
		return "", err
	}
	path := dir + string(os.PathSeparator) + assetName
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	hash := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(resp.Body, maxDownload+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || n != release.Size || hex.EncodeToString(hash.Sum(nil)) != release.Digest {
		os.RemoveAll(dir)
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		return "", errors.New("download failed size or SHA-256 verification; the installed version was not changed")
	}
	return path, nil
}
