param([string]$Executable)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Executable) {
    $releaseVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    $Executable = Join-Path $projectRoot "dist/Mineradio-$releaseVersion-Windows-x64.exe"
}
$Executable = [System.IO.Path]::GetFullPath($Executable)
$verificationRoot = Join-Path $projectRoot 'verification'
New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
$runId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$smokePath = Join-Path $verificationRoot "portable-smoke-$runId.json"
$envChanges = @{
    MINERADIO_STARTUP_QA_HIDDEN = '1'
    MINERADIO_STARTUP_QA_USER_DATA = (Join-Path $verificationRoot 'portable-profile')
    MINERADIO_STARTUP_QA_EXIT_MS = '8000'
    MINERADIO_SMOKE_REPORT = $smokePath
    MINERADIO_NO_DESKTOP_SHORTCUT = '1'
    PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
}
$originalEnvironment = @{}
foreach ($name in $envChanges.Keys) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $envChanges[$name], 'Process')
}
try {
    $portableProcess = Start-Process -FilePath $Executable -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(150)
    while (-not (Test-Path -LiteralPath $smokePath)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Portable startup report timed out' }
        $portableProcess.Refresh()
        if ($portableProcess.HasExited) { throw "Portable launcher exited before the player was ready: $($portableProcess.ExitCode)" }
        Start-Sleep -Milliseconds 300
    }
    $smoke = Get-Content -LiteralPath $smokePath -Raw | ConvertFrom-Json
    if (-not $smoke.ok -or -not $smoke.packaged -or -not $smoke.localAuthInstalled) { throw 'Portable renderer or backend failed' }
    $backend = Get-CimInstance Win32_Process -Filter "ProcessId=$($smoke.backendPid)"
    $backendPath = if ($backend) { $backend.ExecutablePath } else { '' }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($smoke.ports.api)/health" -TimeoutSec 15
    if (-not $health.platforms.qishui.sdk_available -or -not $health.platforms.qishui.node_available -or -not $health.platforms.qishui.ffmpeg_available) {
        throw 'A bundled dependency is unavailable in the portable executable'
    }
    Wait-Process -Id $portableProcess.Id -Timeout 60 -ErrorAction SilentlyContinue
    $portableProcess.Refresh()
    if (-not $portableProcess.HasExited) { throw 'Portable launcher did not exit after its smoke test' }
    Start-Sleep -Milliseconds 500
    $backendExited = -not (Get-Process -Id $smoke.backendPid -ErrorAction SilentlyContinue)
    if (-not $backendExited) { throw 'Portable backend remained after application exit' }
    $result = [ordered]@{
        ok = $true
        executable = [System.IO.Path]::GetFileName($Executable)
        size = (Get-Item -LiteralPath $Executable).Length
        sha256 = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
        launcherExitCode = $portableProcess.ExitCode
        moduleCount = $smoke.moduleCount
        bridgeFunctions = $smoke.bridgeFunctionCount
        extractedBackend = $backendPath
        qishui = $health.platforms.qishui
        backendExited = $backendExited
        originalWebServiceStillRunning = [bool](Get-NetTCPConnection -State Listen -LocalPort 18080 -ErrorAction SilentlyContinue)
    }
    $json = $result | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText((Join-Path $verificationRoot 'portable-acceptance.json'), $json, [System.Text.UTF8Encoding]::new($false))
    Write-Output $json
} finally {
    foreach ($name in $envChanges.Keys) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
}
