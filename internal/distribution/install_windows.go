package distribution

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const installKey = `Software\ExBase`
const appPathKey = `Software\Microsoft\Windows\CurrentVersion\App Paths\ExBase.exe`
const uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\ExBase`

func samePath(a, b string) bool {
	expanded, err := registry.ExpandString(strings.Trim(strings.TrimSpace(a), `"`))
	if err != nil {
		return false
	}
	if strings.EqualFold(filepath.Clean(expanded), filepath.Clean(b)) {
		return true
	}
	// PATH entries may use directory junctions to avoid non-ASCII profile paths.
	infoA, errA := os.Stat(expanded)
	infoB, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(infoA, infoB)
}

func changePath(value, dir string, remove bool) (string, bool) {
	parts := strings.Split(value, ";")
	if !remove {
		for _, p := range parts {
			if p != "" && samePath(p, dir) {
				return value, false
			}
		}
		if value == "" {
			return dir, true
		}
		return strings.TrimRight(value, ";") + ";" + dir, true
	}
	kept := make([]string, 0, len(parts))
	changed := false
	for _, p := range parts {
		if p != "" && samePath(p, dir) {
			changed = true
		} else {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, ";"), changed
}

func executableDir() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(path), nil
}

func Installed() bool {
	if Version == "dev" {
		return false
	}
	dir, err := executableDir()
	if err != nil {
		return false
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, installKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	saved, _, err := k.GetStringValue("InstallDir")
	return err == nil && samePath(saved, dir)
}

func environmentPath(dir string, remove bool) (bool, error) {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return false, err
	}
	defer k.Close()
	value, kind, err := k.GetStringValue("Path")
	if errors.Is(err, registry.ErrNotExist) {
		value, kind, err = "", registry.EXPAND_SZ, nil
	}
	if err != nil {
		return false, err
	}
	next, changed := changePath(value, dir, remove)
	if !changed {
		return false, nil
	}
	if kind == registry.EXPAND_SZ {
		err = k.SetExpandStringValue("Path", next)
	} else {
		err = k.SetStringValue("Path", next)
	}
	if err != nil {
		return false, err
	}
	msg, _ := windows.UTF16PtrFromString("Environment")
	windows.NewLazySystemDLL("user32.dll").NewProc("SendMessageTimeoutW").Call(0xffff, 0x001a, 0, uintptr(unsafe.Pointer(msg)), 2, 2000, 0)
	return true, nil
}

func Register() error {
	dir, err := executableDir()
	if err != nil {
		return err
	}
	if strings.ContainsAny(dir, ";\r\n") {
		return errors.New("installation path cannot contain semicolons or line breaks")
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, installKey, registry.ALL_ACCESS)
	if err != nil {
		return err
	}
	defer k.Close()
	previous, _, _ := k.GetStringValue("InstallDir")
	if previous != "" && !samePath(previous, dir) {
		return errors.New("uninstall the existing copy before changing installation directory")
	}
	if previous != "" {
		dir = previous
	}
	added, err := environmentPath(dir, false)
	if err != nil {
		return err
	}
	owned, _, _ := k.GetIntegerValue("PathAdded")
	if added {
		owned = 1
	}
	if err = k.SetDWordValue("PathAdded", uint32(owned)); err != nil {
		return err
	}
	if err = k.SetStringValue("InstallDir", dir); err != nil {
		return err
	}
	entries := map[string]map[string]string{
		appPathKey:   {"": filepath.Join(dir, "ExBase.exe"), "Path": dir},
		uninstallKey: {"DisplayName": "ExBase", "DisplayVersion": Version, "Publisher": "ExBase", "InstallLocation": dir, "DisplayIcon": filepath.Join(dir, "ExBase.exe"), "UninstallString": `"` + filepath.Join(dir, "Uninstall.exe") + `"`, "QuietUninstallString": `"` + filepath.Join(dir, "Uninstall.exe") + `" /S`},
	}
	for path, values := range entries {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
		if err != nil {
			return err
		}
		for name, value := range values {
			if err = key.SetStringValue(name, value); err != nil {
				key.Close()
				return err
			}
		}
		if path == uninstallKey {
			err = key.SetDWordValue("NoModify", 1)
			if err == nil {
				err = key.SetDWordValue("NoRepair", 1)
			}
		}
		key.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func Unregister() error {
	dir, err := executableDir()
	if err != nil {
		return err
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, installKey, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	saved, _, readErr := k.GetStringValue("InstallDir")
	owned, _, _ := k.GetIntegerValue("PathAdded")
	k.Close()
	if readErr != nil || !samePath(saved, dir) {
		return errors.New("installation registration belongs to another directory")
	}
	if owned != 0 {
		if _, err := environmentPath(dir, true); err != nil {
			return err
		}
	}
	for _, path := range []string{appPathKey, uninstallKey, installKey} {
		if err := registry.DeleteKey(registry.CURRENT_USER, path); err != nil && !errors.Is(err, registry.ErrNotExist) {
			return err
		}
	}
	return nil
}

func LaunchInstaller(path string) error {
	if !Installed() {
		return errors.New("updates are only available in the installed release")
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, installKey, registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	dir, _, err := k.GetStringValue("InstallDir")
	if err != nil {
		return err
	}
	cmd := exec.Command(path)
	// NSIS requires /D to be last, with no quotes even when the directory contains spaces.
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CmdLine: windows.ComposeCommandLine([]string{path, "/S", fmt.Sprintf("/WAITPID=%d", os.Getpid())}) + " /D=" + dir}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
