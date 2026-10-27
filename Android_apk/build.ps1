param(
    [ValidateSet('debug','release')][string]$Variant='debug',
    [string]$SdkBundle=$env:MINERADIO_ANDROID_SDK_BUNDLE,
    [string]$Workspace=$env:MINERADIO_ANDROID_WORKSPACE,
    [string]$JavaHome=$env:JAVA_HOME,
    [string]$Python312=$env:MINERADIO_BUILD_PYTHON,
    [string]$AndroidSdk=$env:ANDROID_HOME,
    [string]$GradlePath,
    [switch]$Unsigned
)
$ErrorActionPreference='Stop'
$apkSource=$PSScriptRoot
if (-not $SdkBundle) { throw 'Provide -SdkBundle (or MINERADIO_ANDROID_SDK_BUNDLE) from extract_sdk.py. Full Qishui support is required; it will not be silently disabled.' }
if (-not $Workspace) { $Workspace=Join-Path $env:LOCALAPPDATA 'MineradioAndroidBuild/source-project' }
if (-not $JavaHome) {
    $apkJava=Get-Command java -ErrorAction SilentlyContinue
    if ($apkJava) { $JavaHome=Split-Path -Parent (Split-Path -Parent $apkJava.Source) }
    if (-not $JavaHome) {
        $JavaHome=Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles 'Eclipse Adoptium') -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) { throw 'Install JDK 17+ and set JAVA_HOME or pass -JavaHome.' }
$env:JAVA_HOME=$JavaHome
$env:PATH=(Join-Path $JavaHome 'bin')+';'+$env:PATH
if (-not $Python312) {
    $apkLauncher=Get-Command py -ErrorAction SilentlyContinue
    if ($apkLauncher) {
        $apkPythonOutput=& $apkLauncher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0) { $Python312=([string]$apkPythonOutput).Trim() }
    }
    if (-not $Python312) {
        $apkUv=Get-Command uv -ErrorAction SilentlyContinue
        if ($apkUv) {
            $apkPythonOutput=& $apkUv.Source python find --no-python-downloads 3.12 2>$null
            if ($LASTEXITCODE -eq 0) { $Python312=([string]$apkPythonOutput).Trim() }
        }
    }
}
if (-not $Python312 -or -not (Test-Path -LiteralPath $Python312)) { throw 'Install Python 3.12 and pass -Python312 or set MINERADIO_BUILD_PYTHON.' }
& $Python312 -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'The Android build requires Python 3.12.' }
$env:MINERADIO_BUILD_PYTHON=$Python312
$env:PYTHONIOENCODING='utf-8'
if (-not $AndroidSdk) { $AndroidSdk=$env:ANDROID_SDK_ROOT }
if (-not $AndroidSdk) { $AndroidSdk=Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$apkTools=Join-Path $AndroidSdk 'build-tools/35.0.0'
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms/android-36/android.jar')) -or
    -not (Test-Path -LiteralPath (Join-Path $apkTools 'zipalign.exe'))) { throw 'Install Android SDK platform 36 and Build Tools 35.0.0; pass -AndroidSdk if needed.' }
& $Python312 -B -X utf8 (Join-Path $apkSource 'prepare.py') --workspace $Workspace --sdk-bundle $SdkBundle --android-sdk $AndroidSdk
if ($LASTEXITCODE -ne 0) { throw 'Asset preparation failed' }
$apkBuild=[IO.Path]::GetFullPath($Workspace)
$apkGradle=if ($GradlePath) { [IO.Path]::GetFullPath($GradlePath) } else { Join-Path $apkBuild 'gradlew.bat' }
Push-Location -LiteralPath $apkBuild
try {
    & $apkGradle ('assemble'+[cultureinfo]::InvariantCulture.TextInfo.ToTitleCase($Variant)) --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Gradle failed' }
} finally { Pop-Location }
& $Python312 -B -X utf8 (Join-Path $apkSource 'prepare.py') $Variant --workspace $apkBuild
if ($LASTEXITCODE -ne 0) { throw 'Verified SDK DEX packaging failed' }
$apkDist=Join-Path $apkSource 'dist'
New-Item -ItemType Directory -Force -Path $apkDist | Out-Null
$apkVersion=[regex]::Match((Get-Content -LiteralPath (Join-Path $apkSource 'app/build.gradle') -Raw), "versionName '([^']+)'").Groups[1].Value
if (-not $apkVersion) { throw 'Missing Android versionName' }
& (Join-Path $apkTools 'zipalign.exe') -f -P 16 4 (Join-Path $apkBuild 'mineradio-unsigned.apk') (Join-Path $apkBuild 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed' }
if ($Unsigned) {
    $apkFinal=Join-Path $apkDist ('Mineradio-'+$apkVersion+'-'+$Variant+'-unsigned-arm64.apk')
    Copy-Item -LiteralPath (Join-Path $apkBuild 'aligned.apk') -Destination $apkFinal -Force
} else {
    $apkLocal=Join-Path $apkSource '.local'
    New-Item -ItemType Directory -Force -Path $apkLocal | Out-Null
    $apkKey=Join-Path $apkLocal 'mineradio.keystore'
    $apkPassword=Join-Path $apkLocal 'signing-password.txt'
    $apkSign=Join-Path $apkBuild 'signing'
    New-Item -ItemType Directory -Force -Path $apkSign | Out-Null
    $apkAsciiKey=Join-Path $apkSign 'mineradio.keystore'
    $apkAsciiPassword=Join-Path $apkSign 'password.txt'
    if (-not (Test-Path -LiteralPath $apkKey)) {
        $apkRandom=New-Object byte[] 32
        $apkGenerator=[System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $apkGenerator.GetBytes($apkRandom) } finally { $apkGenerator.Dispose() }
        [Convert]::ToBase64String($apkRandom) | Set-Content -LiteralPath $apkPassword -NoNewline -Encoding ascii
        Copy-Item -LiteralPath $apkPassword -Destination $apkAsciiPassword -Force
        & (Join-Path $JavaHome 'bin/keytool.exe') -genkeypair -keystore $apkAsciiKey -storepass:file $apkAsciiPassword -keypass:file $apkAsciiPassword -alias mineradio -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Mineradio Local Android, O=Mineradio, C=CN'
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed' }
        Copy-Item -LiteralPath $apkAsciiKey -Destination $apkKey -Force
    } else {
        if (-not (Test-Path -LiteralPath $apkPassword)) { throw 'Existing signing key password file is missing. Restore it to retain update compatibility.' }
        Copy-Item -LiteralPath $apkKey -Destination $apkAsciiKey -Force
        Copy-Item -LiteralPath $apkPassword -Destination $apkAsciiPassword -Force
    }
    $apkFinal=Join-Path $apkDist ('Mineradio-'+$apkVersion+'-'+$Variant+'-arm64.apk')
    & (Join-Path $apkTools 'apksigner.bat') sign --ks $apkAsciiKey --ks-key-alias mineradio --ks-pass ('file:'+$apkAsciiPassword) --out (Join-Path $apkBuild 'signed.apk') (Join-Path $apkBuild 'aligned.apk')
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    & (Join-Path $apkTools 'apksigner.bat') verify --verbose (Join-Path $apkBuild 'signed.apk')
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    Copy-Item -LiteralPath (Join-Path $apkBuild 'signed.apk') -Destination $apkFinal -Force
    if ($Variant -eq 'release') { Copy-Item -LiteralPath $apkFinal -Destination (Join-Path $apkDist ('Mineradio-'+$apkVersion+'.apk')) -Force }
}
Get-FileHash -LiteralPath $apkFinal -Algorithm SHA256 | Format-List
