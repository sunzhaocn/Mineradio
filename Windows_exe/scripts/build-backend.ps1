param(
    [switch]$SkipDependencyInstall,
    [switch]$SkipBrowser
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot '..'))
$venvPython = Join-Path $desktopRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & python -m venv (Join-Path $desktopRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the build Python environment.' }
}
if (-not $SkipDependencyInstall) {
    & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $sourceRoot 'requirements.txt') 'pyinstaller==6.22.3'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to install backend build dependencies.' }
}
$env:MINERADIO_BUILD_BROWSER = ''
if (-not $SkipBrowser) {
    $browserCache = Join-Path $env:LOCALAPPDATA 'ms-playwright'
    $browserCandidates = @(Get-ChildItem -LiteralPath $browserCache -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^chromium-(\d+)$' } |
        Sort-Object { [int]($_.Name -replace '^chromium-', '') } -Descending)
    foreach ($candidate in $browserCandidates) {
        $browserDirectory = Join-Path $candidate.FullName 'chrome-win64'
        if (Test-Path -LiteralPath (Join-Path $browserDirectory 'chrome.exe')) {
            $env:MINERADIO_BUILD_BROWSER = $browserDirectory
            break
        }
    }
    if (-not $env:MINERADIO_BUILD_BROWSER) {
        & $venvPython -m playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Unable to install the bundled login browser.' }
        $browserExecutable = & $venvPython -c 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()'
        if ($LASTEXITCODE -ne 0) { throw 'Unable to locate the login browser.' }
        $env:MINERADIO_BUILD_BROWSER = Split-Path -Parent $browserExecutable.Trim()
    }
}
Push-Location -LiteralPath $desktopRoot
try {
    & $venvPython -m PyInstaller --noconfirm --distpath (Join-Path $desktopRoot 'build/backend') --workpath (Join-Path $desktopRoot 'build/pyinstaller') (Join-Path $desktopRoot 'backend.spec')
    if ($LASTEXITCODE -ne 0) { throw 'Backend packaging failed.' }
    $output = Join-Path $desktopRoot 'build/backend/MineradioBackend/MineradioBackend.exe'
    if (-not (Test-Path -LiteralPath $output)) { throw 'Backend executable was not created.' }
    Write-Output $output
} finally {
    Pop-Location
    Remove-Item Env:MINERADIO_BUILD_BROWSER -ErrorAction SilentlyContinue
}
