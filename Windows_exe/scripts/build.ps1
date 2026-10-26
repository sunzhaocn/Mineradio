param(
    [switch]$SkipBackend,
    [switch]$SkipDependencyInstall,
    [switch]$DirectoryOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$env:PYTHONIOENCODING = 'utf-8'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
if (-not $SkipDependencyInstall) {
    & npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/electron/dist/electron.exe'))) {
    & node (Join-Path $projectRoot 'node_modules/electron/install.js')
    if ($LASTEXITCODE -ne 0) { throw 'Electron runtime installation failed' }
}
& python -B -X utf8 (Join-Path $PSScriptRoot 'prepare-tools.py')
if ($LASTEXITCODE -ne 0) { throw 'Runtime staging failed' }
& python -B -X utf8 (Join-Path $PSScriptRoot 'prepare-sdk.py')
if ($LASTEXITCODE -ne 0) { throw 'SDK staging failed' }
if (-not $SkipBackend) {
    & (Join-Path $PSScriptRoot 'build-backend.ps1') -SkipDependencyInstall:$SkipDependencyInstall
    if ($LASTEXITCODE -ne 0) { throw 'Python backend build failed' }
}
$target = if ($DirectoryOnly) { 'dir' } else { 'nsis' }
& (Join-Path $projectRoot 'node_modules/.bin/electron-builder.cmd') --win $target --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'Electron packaging failed' }
Write-Host "Build complete: $projectRoot\dist"
