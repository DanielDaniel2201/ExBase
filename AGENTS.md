# ExBase

ExBase is a minimal local Excalidraw editor built with Go and Wails that can open, edit, and save `.excalidraw` files.

## Build

The project uses Go 1.27.1 and Wails v2.15.0 from `.tools`. Run in PowerShell:

```powershell
$env:GOROOT = (Resolve-Path '.tools\go').Path
$env:GOPATH = (Resolve-Path '.tools\gopath').Path
$env:PATH = "$env:GOROOT\bin;$(Resolve-Path '.tools\bin').Path;$env:PATH"
.\.tools\bin\wails.exe build
```

The executable is generated at `build\bin\ExBase.exe`.
