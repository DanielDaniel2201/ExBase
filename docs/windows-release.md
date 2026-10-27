# Windows installation and updates

The installed application and development build are both named `ExBase.exe`.

- Development: run `wails dev` or `build\bin\ExBase.exe`. Normal builds report `dev` and never update themselves.
- Installation: run `ExBase-Setup.exe`, choose a writable directory (default `%LOCALAPPDATA%\Programs\ExBase`), and install for the current user. The installer adds that directory to the user PATH, registers App Paths and an uninstall entry, and creates only a Start menu entry. It never creates a desktop shortcut.
- Flow Launcher: refresh its program index after installing. Start menu and registry sources can discover ExBase; PATH indexing is not required. Open a new terminal to use `exbase`.
- PATH aliases through directory junctions resolve to the same installed release, including its update channel and original installation directory. If another local tool enforces a fixed PATH baseline, the installation directory must also be allowed in that tool; ExBase does not change external PATH policies.
- Updates: installed releases check GitHub on startup; Settings > General > Updates provides a manual check and Update and restart. Downloads must match GitHub's asset size and SHA-256 digest. The existing document-save and recording guards run before the installer starts replacing files.
- Upgrade: the installer waits for the old process, stages the new binary, retains `ExBase.previous.exe`, and restores it if publishing fails. It reuses the registered installation directory. To move an existing installation, uninstall and reinstall in the new location.
- Uninstall: use Windows Settings > Installed apps. Only known installed files, registration and the Start menu entry are removed; personal files, settings, credentials, recordings and workspace history remain. An installation does not isolate development settings from release settings.

## Building locally

Install NSIS once (`winget install --id NSIS.NSIS --exact`), then:

```powershell
powershell -NoProfile -File scripts/build-release.ps1 -Version 0.1.0
```

The script uses checkout-local Go/Wails when present, records the Git revision, temporarily sets Windows version metadata and restores `wails.json` in `finally`. Outputs are `build\bin\ExBase.exe` and `build\bin\ExBase-Setup.exe`. Run a normal `wails build` after release packaging to restore the local binary to the dev channel.

## Publishing

Every push to `main` runs `.github/workflows/release.yml` on a Windows runner with Visual Studio/Windows SDK. Native integration checks, Go tests and frontend tests must pass before packaging. A complete draft with both assets is uploaded before publication as the latest release. Versions are `0.1.<workflow run number>`; rerunning an already published version never overwrites its assets. Other branches do not publish releases. No runtime Git, Go, Node or GitHub token is required on the installed user's computer.

The first published release is needed to verify the real remote update path. The updater uses GitHub HTTPS metadata and digests; release signing is not configured. It downloads the full installer. Installer files are cached under the Windows temporary directory and may be removed by Windows cleanup. If an installer fails after ExBase exits, run the previous application or installer again; user data is untouched.
