param([switch]$Check)
$ErrorActionPreference = 'Stop'
$buildLock = New-Object Threading.Mutex($false, 'Local\ExBaseNativeRecordingBuild')
$lockHeld = $false
try {
    $lockHeld = $buildLock.WaitOne(60000)
    if (!$lockHeld) { throw 'Another native recording build did not finish.' }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $sourcePath = Join-Path $projectRoot 'internal\app\native\recording.cpp'
    $outputPath = Join-Path $projectRoot 'internal\app\native\recording.dll'

    # Check if Visual Studio is available first
    $vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $hasVisualStudio = $false
    $visualStudioPath = $null

    if (Test-Path -LiteralPath $vswherePath) {
        $visualStudioPath = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        $hasVisualStudio = [bool]$visualStudioPath
    }

    # If no Visual Studio, check if we have an existing DLL
    if (!$hasVisualStudio) {
        if (Test-Path -LiteralPath $outputPath) {
            Write-Host "Visual Studio not found, using existing recording.dll"
        } else {
            throw 'Building native recording requires Visual Studio C++ Build Tools and the Windows 10/11 SDK.'
        }
        return
    }

    # Only proceed with build if we have Visual Studio
    $needsBuild = !(Test-Path -LiteralPath $outputPath)
    if (!$needsBuild) {
        $builtAt = (Get-Item -LiteralPath $outputPath).LastWriteTimeUtc
        $needsBuild = $builtAt -le (Get-Item -LiteralPath $sourcePath).LastWriteTimeUtc -or $builtAt -le (Get-Item -LiteralPath $PSCommandPath).LastWriteTimeUtc
    }
    if (!$needsBuild -and !$Check) { return }

    $environmentScript = Join-Path $visualStudioPath 'Common7\Tools\VsDevCmd.bat'
    # Only the compiler environment uses cmd. No filesystem operations cross shells.
    $compilerEnvironment = & $env:ComSpec /d /s /c "`"`"$environmentScript`" -arch=amd64 >nul && set`""
    foreach ($line in $compilerEnvironment) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
    $nativeBuildPath = Join-Path $projectRoot '.tools\recording-build'
    New-Item -ItemType Directory -Path $nativeBuildPath -Force | Out-Null
    $libraries = @('mfplat.lib', 'mfreadwrite.lib', 'mfuuid.lib', 'ole32.lib', 'windowsapp.lib', 'd3d11.lib', 'dxgi.lib', 'windowscodecs.lib', 'user32.lib')
    if ($needsBuild) {
        $compiledLibraryPath = Join-Path $nativeBuildPath 'recording.dll'
        & cl.exe /nologo /std:c++17 /EHsc /O2 /MT /LD /DUNICODE /D_UNICODE $sourcePath "/Fo$nativeBuildPath\recording.obj" /link "/OUT:$compiledLibraryPath" "/IMPLIB:$nativeBuildPath\recording.lib" $libraries
        if ($LASTEXITCODE -ne 0) { throw 'Native recording compilation failed.' }
        # Publish atomically; HMR and binding generation must never embed a partial DLL.
        $temporaryLibraryPath = "$outputPath.tmp"
        Copy-Item -LiteralPath $compiledLibraryPath -Destination $temporaryLibraryPath
        if (Test-Path -LiteralPath $outputPath) { [IO.File]::Replace($temporaryLibraryPath, $outputPath, (Join-Path $nativeBuildPath 'recording.previous.dll')) }
        else { [IO.File]::Move($temporaryLibraryPath, $outputPath) }
    }
    if ($Check) {
        $checkSourcePath = Join-Path $projectRoot 'internal\app\native\recording.check.cpp'
        & cl.exe /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE $checkSourcePath "/Fo$nativeBuildPath\recording.check.obj" /link "/OUT:$nativeBuildPath\recording-check.exe" "/IMPLIB:$nativeBuildPath\recording-check.lib" $libraries
        if ($LASTEXITCODE -ne 0) { throw 'Native recording check compilation failed.' }
        & "$nativeBuildPath\recording-check.exe" fixture "$nativeBuildPath\tone.mp4"
        if ($LASTEXITCODE -ne 0) { throw 'Native MP4 audio/video integration check failed.' }
        $presentationCheck = & "$nativeBuildPath\recording-check.exe" presentation "$nativeBuildPath\presentation.mp4" "$nativeBuildPath\tone.mp4"
        if ($LASTEXITCODE -ne 0) { throw 'Native narrated replay export check failed.' }
        $presentationResult = $presentationCheck | ConvertFrom-Json
        if ($presentationResult.frames -ne 40 -or $presentationResult.audioPeak -lt 1000 -or $presentationResult.audioSamples -lt 94000 -or $presentationResult.audioSamples -gt 98000) { throw 'Narrated export changed frame duration or lost the original audio.' }
        $presentationCheck
    }
} finally {
    if ($lockHeld) { $buildLock.ReleaseMutex() }
    $buildLock.Dispose()
}
