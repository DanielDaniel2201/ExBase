$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$encoderPath = Join-Path $projectRoot '.tools\ffmpeg\ffmpeg.exe'
$licensePath = Join-Path $projectRoot '.tools\ffmpeg\LICENSE.txt'
if (!(Test-Path -LiteralPath $encoderPath)) {
    throw 'Recording requires FFmpeg with libx264 and AAC. Place ffmpeg.exe and LICENSE.txt in .tools\ffmpeg before building.'
}
$destinationPath = Join-Path $projectRoot 'build\bin\ffmpeg.exe'
# HMR can rebuild while an encoder is running. Skip identical binaries so
# Windows file locking does not prevent Wails from loading the new app version.
if (!(Test-Path -LiteralPath $destinationPath) -or (Get-FileHash -LiteralPath $encoderPath).Hash -ne (Get-FileHash -LiteralPath $destinationPath).Hash) {
    Copy-Item -LiteralPath $encoderPath -Destination $destinationPath
}
if (Test-Path -LiteralPath $licensePath) {
    Copy-Item -LiteralPath $licensePath -Destination (Join-Path $projectRoot 'build\bin\FFmpeg-LICENSE.txt')
}
