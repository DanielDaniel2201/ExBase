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

## AI credentials and debugging

ExBase uses the official remote Excalidraw MCP Server at `https://mcp.excalidraw.com/mcp`.

The API key is stored locally in `~/.exbase/auth.json`; AI trajectory logs are stored in `~/.exbase/sessions/*.jsonl`. When debugging AI behavior, inspect the relevant session log first. Never output real API keys or authentication headers, or commit credentials to Git.

## UI conventions

Extend the existing neutral gray palette, compact layout, and Lucide icon style. The chat entry appears only inside an open Excalidraw canvas. Avoid introducing extra toolbars or a new theme.
