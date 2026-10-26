param([string]$Executable)
$ErrorActionPreference = 'Stop'
$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Executable) {
    $releaseVersion = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
    $Executable = Join-Path $desktopRoot "dist/Mineradio-$releaseVersion-Windows-x64.exe"
}
$Executable = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable)) { throw 'Build the portable executable before running this check.' }
$runId = [Guid]::NewGuid().ToString('N')
$runRoot = Join-Path $desktopRoot "verification/multi-instance-$runId"
$profile = Join-Path $runRoot 'profile'
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $profile 'cache-settings.json'),
    (@{ version = 1; rootPath = (Join-Path $runRoot 'isolated-cache') } | ConvertTo-Json), $utf8)
$smokeAPath = Join-Path $runRoot 'startup-a.json'
$smokeBPath = Join-Path $runRoot 'startup-b.json'
$changes = @{
    MINERADIO_STARTUP_QA_HIDDEN = '1'
    MINERADIO_STARTUP_QA_USER_DATA = $profile
    MINERADIO_STARTUP_QA_EXIT_MS = $null
    MINERADIO_SMOKE_REPORT = $smokeAPath
    MINERADIO_NO_DESKTOP_SHORTCUT = '1'
    PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    ELECTRON_RUN_AS_NODE = $null
}
$original = @{}
foreach ($name in $changes.Keys) {
    $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($null -eq $changes[$name]) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
        [Environment]::SetEnvironmentVariable($name, $changes[$name], 'Process')
    }
}
$launcherA = $null
$launcherB = $null
$testAppProcessId = $null
$testBackendProcessId = $null
$runtimeA = $null
$result = [ordered]@{ ok = $false; executable = [System.IO.Path]::GetFileName($Executable) }
$eventIdentifier = "MineradioMultiInstance-$runId"
$eventSubscription = Register-CimIndicationEvent -Namespace root/cimv2 -Query "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName='Mineradio.exe'" -SourceIdentifier $eventIdentifier

function Wait-SmokeReport($Process, [string]$Path, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $Path)) {
        $Process.Refresh()
        if ($Process.HasExited) { throw "Portable A exited before its renderer was ready (launcher code $($Process.ExitCode))." }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Portable A startup timed out.' }
        Start-Sleep -Milliseconds 200
    }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

try {
    $launcherA = Start-Process -FilePath $Executable -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -PassThru
    $smokeA = Wait-SmokeReport $launcherA $smokeAPath 150
    if (-not $smokeA.ok -or -not $smokeA.moduleReady -or -not $smokeA.localAuthInstalled) {
        throw 'Portable A renderer/backend smoke check failed.'
    }
    $testBackendProcessId = [int]$smokeA.backendPid
    $backendRecord = Get-CimInstance Win32_Process -Filter "ProcessId=$testBackendProcessId"
    if (-not $backendRecord) { throw 'Portable A backend disappeared.' }
    $testAppProcessId = [int]$backendRecord.ParentProcessId
    $runtimeA = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $backendRecord.ExecutablePath) '../..'))
    $appRecord = Get-CimInstance Win32_Process -Filter "ProcessId=$testAppProcessId"
    if (-not $appRecord -or [System.IO.Path]::GetFullPath($appRecord.ExecutablePath) -ne (Join-Path $runtimeA 'Mineradio.exe')) {
        throw 'Could not prove ownership of the QA application process.'
    }
    if ($runtimeA -notmatch '\\ns[^\\]+\.tmp\\app$') {
        throw 'Portable A did not use a per-launch NSIS plugin directory.'
    }
    $baseline = @(Get-ChildItem -LiteralPath $runtimeA -File -Recurse | ForEach-Object {
        $_.FullName.Substring($runtimeA.Length + 1)
    })
    $critical = @('resources/backend/_internal/_overlapped.pyd',
        'resources/backend/_internal/playwright/driver/node.exe',
        'resources/backend/_internal/playwright/driver/package/cli.js',
        'resources/backend/_internal/web/player/js/module-manifest.json',
        'resources/backend/_internal/browser/chrome-win64/chrome.exe',
        'resources/qishui-sdk/bdms.node', 'resources/tools/node.exe', 'resources/tools/ffmpeg.exe')
    foreach ($relative in $critical) {
        if (-not (Test-Path -LiteralPath (Join-Path $runtimeA $relative))) { throw "A resource is missing before second launch: $relative" }
    }
    $pluginRootA = Split-Path -Parent $runtimeA
    $existingPlugins = @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue | ForEach-Object FullName)
    [Environment]::SetEnvironmentVariable('MINERADIO_SMOKE_REPORT', $smokeBPath, 'Process')
    $launcherB = Start-Process -FilePath $Executable -WorkingDirectory (Split-Path -Parent $Executable) -WindowStyle Hidden -PassThru
    $secondPluginRoots = @()
    $secondDeadline = [DateTime]::UtcNow.AddSeconds(120)
    do {
        $launcherB.Refresh()
        $secondPluginRoots = @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'ns*.tmp' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notin $existingPlugins } | ForEach-Object FullName)
        if ($launcherB.HasExited) { break }
        if ([DateTime]::UtcNow -gt $secondDeadline) { throw 'Second portable launcher did not exit through the single-instance path.' }
        Start-Sleep -Milliseconds 150
    } while ($true)
    if ($launcherB.ExitCode -ne 0) { throw "Second portable launcher failed: $($launcherB.ExitCode)" }
    $launcherA.Refresh()
    if ($launcherA.HasExited -or -not (Get-Process -Id $testBackendProcessId -ErrorAction SilentlyContinue)) {
        throw 'Portable A was stopped by the second launch.'
    }
    $missing = @($baseline | Where-Object { -not (Test-Path -LiteralPath (Join-Path $runtimeA $_)) })
    if ($missing.Count) { throw "Second launch removed $($missing.Count) resources from portable A." }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($smokeA.ports.api)/health" -TimeoutSec 10
    if (-not $health.ok) { throw 'Portable A health check failed after second-launch cleanup.' }
    $clientId = [Guid]::NewGuid().ToString('N')
    $body = @{ provider = 'qishui'; client_id = $clientId } | ConvertTo-Json -Compress
    $qrResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($smokeA.ports.web)/api/local/auth/session" -Method Post -ContentType 'application/json' -Headers @{ Origin = "http://127.0.0.1:$($smokeA.ports.web)" } -Body $body -TimeoutSec 40
    $qr = $qrResponse.Content | ConvertFrom-Json
    $hasQrImage = [bool]($qr.qr_image -and $qr.qr_image.StartsWith('data:image/png;base64,'))
    $hasOfficialQr = [bool]($qr.qr_url -and ([Uri]$qr.qr_url).Host -eq 'bff-pc.qishui.com')
    if ($qrResponse.StatusCode -ne 200 -or -not $hasQrImage -or -not $hasOfficialQr) {
        throw 'Qishui QR generation failed after second-launch cleanup.'
    }
    $result.runtimeA = $runtimeA
    $result.usesUniquePluginDirectory = $true
    $result.secondLauncherExitCode = $launcherB.ExitCode
    $result.secondInstanceStartedAnotherBackend = (Test-Path -LiteralPath $smokeBPath)
    $result.aResourcesBefore = $baseline.Count
    $result.aResourcesMissingAfterB = $missing.Count
    $result.healthAfterB = [bool]$health.ok
    $result.qishuiQrHttpStatus = $qrResponse.StatusCode
    $result.qishuiQrImagePresent = $hasQrImage
    $result.qishuiOfficialQrUrlPresent = $hasOfficialQr
    $result.scanned = $false
    [System.IO.File]::WriteAllText((Join-Path $runRoot 'checks-before-cleanup.json'),
        ($result | ConvertTo-Json -Depth 6), $utf8)
    # Kill only the main process proven above to belong to this disposable QA run.
    # The NSIS wrapper then observes exit and performs its own normal extraction cleanup.
    & taskkill.exe /PID $testAppProcessId /T /F 2>$null | Out-Null
    $result.testOwnedProcessCleanup = 'exact-main-pid-tree'
    $exitDeadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $launcherA.Refresh()
        if ($launcherA.HasExited) { break }
        if ([DateTime]::UtcNow -gt $exitDeadline) { throw 'Portable A wrapper did not clean up after its own main process exited.' }
        Start-Sleep -Milliseconds 250
    } while ($true)
    $result.firstLauncherExitCode = $launcherA.ExitCode
    $result.backendExited = -not [bool](Get-Process -Id $testBackendProcessId -ErrorAction SilentlyContinue)
    $result.firstRuntimeRemovedAfterWrapperExit = -not (Test-Path -LiteralPath $runtimeA)
    if (-not $result.backendExited) { throw 'Portable A backend remained after cleanup.' }
    if ($result.secondInstanceStartedAnotherBackend) { throw 'Second launch bypassed the single-instance lock.' }
    $result.ok = $true
} catch {
    $result.failure = $_.Exception.Message
    throw
} finally {
    # Only terminate PIDs captured from this script's disposable QA instance.
    if ($testAppProcessId -and $runtimeA) {
        $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$testAppProcessId" -ErrorAction SilentlyContinue
        if ($owned -and $owned.ExecutablePath -eq (Join-Path $runtimeA 'Mineradio.exe')) {
            & taskkill.exe /PID $testAppProcessId /T /F 2>$null | Out-Null
        }
    }
    foreach ($launcher in @($launcherB, $launcherA)) {
        if ($launcher) {
            $launcher.Refresh()
            if (-not $launcher.HasExited) { & taskkill.exe /PID $launcher.Id /T /F 2>$null | Out-Null }
        }
    }
    foreach ($name in $changes.Keys) {
        if ($null -eq $original[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
        else { [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process') }
    }
    $result.observedAppStarts = @(Get-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue | ForEach-Object {
        @{ processId = [int]$_.SourceEventArgs.NewEvent.ProcessID; parentProcessId = [int]$_.SourceEventArgs.NewEvent.ParentProcessID }
    })
    Unregister-Event -SourceIdentifier $eventIdentifier -ErrorAction SilentlyContinue
    if ($eventSubscription) { Remove-Job -Job $eventSubscription -Force -ErrorAction SilentlyContinue }
    $json = $result | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText((Join-Path $runRoot 'result.json'), $json, $utf8)
    [System.IO.File]::WriteAllText((Join-Path $desktopRoot 'verification/multi-instance-latest.json'), $json, $utf8)
    Write-Output $json
}
