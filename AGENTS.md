# ExBase

ExBase is a minimal local Excalidraw editor built with Go and Wails that can open, edit, and save `.excalidraw` files.

## Development

The project uses Go 1.27.1 and Wails v2.15.0 from `.tools`. Run in PowerShell:

```powershell
$env:GOROOT = (Resolve-Path '.tools\go').Path
$env:GOPATH = (Resolve-Path '.tools\gopath').Path
$env:PATH = "$env:GOROOT\bin;$(Resolve-Path '.tools\bin').Path;$env:PATH"
.\.tools\bin\wails.exe dev
```

Use `wails dev` while developing for frontend hot reload. Run `.\.tools\bin\wails.exe build` for final production verification; the executable is generated at `build\bin\ExBase.exe`.

Recording uses Windows Graphics Capture for the application window, WASAPI for the microphone, and Media Foundation for H.264/AAC MP4 encoding. The Windows pre-build hook compiles `internal/app/native/recording.cpp` with Visual Studio C++ Build Tools and the Windows SDK, using the static C++ runtime. This small native module is embedded in `ExBase.exe` and extracted to the user's cache when recording is first used. Distribute only `ExBase.exe`; no FFmpeg or separate runtime installation is required. Before running backend tests on a fresh checkout, run `powershell -File scripts/build-recording.ps1`. Window capture requires Windows 10 1903 or later and available Windows media components.

## AI credentials and debugging

ExBase uses the official remote Excalidraw MCP Server at `https://mcp.excalidraw.com/mcp`.

The API key is stored locally in `~/.exbase/auth.json`; AI trajectory logs are stored in `~/.exbase/sessions/*.jsonl`. When debugging AI behavior, inspect the relevant session log first. Never output real API keys or authentication headers, or commit credentials to Git.

## UI conventions

Extend the existing neutral gray palette, compact layout, and Lucide icon style. The chat entry appears only inside an open Excalidraw canvas. Avoid introducing extra toolbars or a new theme.

## Code layout

- `main.go` starts Wails; root `app.go` preserves the `main.App` binding.
- `internal/app` coordinates AI, canvas callbacks, session logs, and slide export.
- `internal/workspace` owns folder history and document operations.
- `internal/settings` owns general settings and prompt templates.
- `internal/fileio` provides safe file replacement shared by settings and export.
- Tests live alongside the implementation; `go test ./...` runs all backend tests.
