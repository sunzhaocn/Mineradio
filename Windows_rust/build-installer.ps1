param(
    [switch]$Isolated,
    [string]$MakeNsis
)

$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$root = Split-Path -Parent $project
$manifest = Get-Content -LiteralPath (Join-Path $project 'Cargo.toml') -Raw
$version = [regex]::Match($manifest, '(?m)^version\s*=\s*"(\d+\.\d+\.\d+)"').Groups[1].Value
if (!$version) { throw 'Cargo.toml 缺少三段式 Windows 版本号' }

if (!$MakeNsis) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) {
        $MakeNsis = $command.Source
    } else {
        $cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'
        if (Test-Path -LiteralPath $cache -PathType Container) {
            $MakeNsis = Get-ChildItem -LiteralPath $cache -Recurse -Filter makensis.exe -File |
                Select-Object -First 1 -ExpandProperty FullName
        }
    }
}
if (!$MakeNsis -or !(Test-Path -LiteralPath $MakeNsis -PathType Leaf)) {
    throw '找不到 makensis.exe。请通过 -MakeNsis 提供 NSIS 程序路径。'
}

$cargo = Get-Command cargo.exe -ErrorAction SilentlyContinue
$cargoPath = if ($cargo) { $cargo.Source } else { Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe' }
foreach ($relative in @('Windows_exe\build\tools\ffmpeg.exe','Windows_exe\build\tools\node.exe',
                        'Windows_exe\sdk\bdms.node','Windows_exe\sdk\metasecml.dll')) {
    if (!(Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
        throw "缺少现有 Windows 运行组件 $relative"
    }
}

Push-Location -LiteralPath $project
try {
    $buildArgs = @('build','--release','--locked')
    if ($Isolated) { $buildArgs += @('--features','preview') }
    & $cargoPath @buildArgs
    if ($LASTEXITCODE -ne 0) { throw 'Rust 构建失败' }
    $dist = Join-Path $project 'dist'
    New-Item -Path $dist -ItemType Directory -Force | Out-Null
    $suffix = if ($Isolated) { 'Test-x64' } else { 'Setup-x64' }
    $setup = Join-Path $dist "Mineradio-$version-Rust-$suffix.exe"
    $binary = Join-Path $project 'target\release\MineradioRust.exe'
    $compilerArgs = @('/V2', "/DSOURCE_ROOT=$root", "/DAPP_VERSION=$version", "/DAPP_BINARY=$binary", "/DSETUP_FILE=$setup")
    if ($Isolated) { $compilerArgs += '/DISOLATED=1' }
    $compilerArgs += (Join-Path $project 'installer.nsi')
    & $MakeNsis @compilerArgs
    if ($LASTEXITCODE -ne 0) { throw 'Windows 安装包构建失败' }
    $installer = Get-Item -LiteralPath $setup
    if (!$Isolated) {
        $sha = [Security.Cryptography.SHA512]::Create()
        try {
            $stream = [IO.File]::OpenRead($setup)
            try {
                $sha512 = [Convert]::ToBase64String($sha.ComputeHash($stream))
            } finally {
                $stream.Dispose()
            }
        } finally {
            $sha.Dispose()
        }
        # This manifest lets installed Electron releases migrate to the Rust installer.
        $manifestText = @"
version: $version
files:
  - url: $($installer.Name)
    sha512: $sha512
    size: $($installer.Length)
path: $($installer.Name)
sha512: $sha512
"@
        [IO.File]::WriteAllText((Join-Path $dist 'latest.yml'), "$manifestText`n", [Text.UTF8Encoding]::new($false))
        $releaseManifest = [ordered]@{
            version = $version
            size = $installer.Length
            sha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Join-Path $dist 'mineradio-windows-update.json'), "$releaseManifest`n", [Text.UTF8Encoding]::new($false))
    }
    $installer
} finally {
    Pop-Location
}
