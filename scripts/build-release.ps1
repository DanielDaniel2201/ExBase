param(
    [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = '0.1.0',
    [string]$Commit = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
$configPath = Join-Path $projectRoot 'wails.json'
$originalConfig = [IO.File]::ReadAllBytes($configPath)
try {
    if (Test-Path -LiteralPath '.tools\go\bin\go.exe') {
        $env:GOROOT = (Resolve-Path '.tools\go').Path
        $env:GOPATH = (Resolve-Path '.tools\gopath').Path
        $wailsBin = (Resolve-Path '.tools\bin').Path
        $env:PATH = "$env:GOROOT\bin;$wailsBin;$env:PATH"
    }
    $nsisDir = Join-Path ${env:ProgramFiles(x86)} 'NSIS'
    if (Test-Path -LiteralPath (Join-Path $nsisDir 'makensis.exe')) { $env:PATH = "$nsisDir;$env:PATH" }
    if (!(Get-Command makensis.exe -ErrorAction SilentlyContinue)) { throw 'Install NSIS first: winget install --id NSIS.NSIS --exact' }
    if (!$Commit) { $Commit = (& git rev-parse --short=12 HEAD); if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git revision.' } }
    if ($Commit -notmatch '^[a-fA-F0-9]{7,40}$') { throw 'Commit must be a Git SHA.' }
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $config | Add-Member -Force NoteProperty Info ([PSCustomObject]@{ companyName = 'ExBase'; productName = 'ExBase'; productVersion = $Version; copyright = 'ExBase'; comments = 'Local Excalidraw editor' })
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
    # The release-only flags keep normal wails build/dev binaries on the dev channel.
    & wails.exe build -nsis -installscope user -ldflags "-X exbase/internal/distribution.Version=$Version -X exbase/internal/distribution.Commit=$Commit"
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
    $installer = Join-Path $projectRoot 'build\bin\ExBase-Setup.exe'
    if (!(Test-Path -LiteralPath $installer)) { throw 'Installer was not generated.' }
    Write-Host "Release $Version ($Commit): $installer"
    Get-FileHash -Algorithm SHA256 -LiteralPath $installer
} finally {
    [IO.File]::WriteAllBytes($configPath, $originalConfig)
    Pop-Location
}
