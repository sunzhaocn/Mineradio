param([ValidateSet('debug','release')][string]$Variant='debug')
$ErrorActionPreference='Stop'
$apkSource=$PSScriptRoot
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot'
$env:PATH=$env:JAVA_HOME+'\bin;'+$env:PATH
# This host rejects AF_UNIX connections. JDK's PipeImpl falls back to TCP when
# its Unix socket directory is unavailable; keep the workaround process-local.
$env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=C:/Mineradio-No-Unix-Socket-Directory/absent'
$env:PYTHONIOENCODING='utf-8'
$env:MINERADIO_BUILD_PYTHON='C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12.15-windows-x86_64-none\python.exe'
$apkGradle=Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.14.3-all') -Filter gradle.bat -Recurse | Select-Object -First 1 -ExpandProperty FullName
if(-not $apkGradle){throw 'Gradle 8.14.3 is required'}
& python -B -X utf8 (Join-Path $apkSource 'prepare.py')
if($LASTEXITCODE -ne 0){throw 'Asset preparation failed'}
$apkBuild=Join-Path $env:LOCALAPPDATA 'MineradioAndroidBuild\project'
Push-Location $apkBuild
try { & $apkGradle ('assemble'+[cultureinfo]::InvariantCulture.TextInfo.ToTitleCase($Variant)) --console=plain --no-daemon; if($LASTEXITCODE -ne 0){throw 'Gradle failed'} }
finally { Pop-Location }
& python -B -X utf8 (Join-Path $apkSource 'prepare.py') $Variant
if($LASTEXITCODE -ne 0){throw 'SDK DEX packaging failed'}
$apkTools=Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools\35.0.0'
$apkLocal=Join-Path $apkSource '.local'
New-Item -ItemType Directory -Force -Path $apkLocal | Out-Null
$apkKey=Join-Path $apkLocal 'mineradio.keystore'
$apkPassword=Join-Path $apkLocal 'signing-password.txt'
$apkSign=Join-Path $apkBuild 'signing'
New-Item -ItemType Directory -Force -Path $apkSign | Out-Null
$apkAsciiKey=Join-Path $apkSign 'mineradio.keystore'
$apkAsciiPassword=Join-Path $apkSign 'password.txt'
if(-not (Test-Path -LiteralPath $apkKey)) {
    [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) | Set-Content -LiteralPath $apkPassword -NoNewline -Encoding ascii
    Copy-Item -LiteralPath $apkPassword -Destination $apkAsciiPassword -Force
    & keytool -genkeypair -keystore $apkAsciiKey -storepass:file $apkAsciiPassword -keypass:file $apkAsciiPassword -alias mineradio -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Mineradio Local Android, O=Mineradio, C=CN'
    if($LASTEXITCODE -ne 0){throw 'Signing key generation failed'}
    Copy-Item -LiteralPath $apkAsciiKey -Destination $apkKey -Force
} else {
    Copy-Item -LiteralPath $apkKey -Destination $apkAsciiKey -Force
    Copy-Item -LiteralPath $apkPassword -Destination $apkAsciiPassword -Force
}
$apkDist=Join-Path $apkSource 'dist'
New-Item -ItemType Directory -Force -Path $apkDist | Out-Null
$apkVersion = [regex]::Match((Get-Content -LiteralPath (Join-Path $apkSource 'app/build.gradle') -Raw), "versionName '([^']+)'").Groups[1].Value
if (-not $apkVersion) { throw 'Missing Android versionName' }
$apkFinal=Join-Path $apkDist ('Mineradio-'+$apkVersion+'-'+$Variant+'-arm64.apk')
& (Join-Path $apkTools 'zipalign.exe') -f -P 16 4 (Join-Path $apkBuild 'mineradio-with-sdk.apk') (Join-Path $apkBuild 'aligned.apk')
if($LASTEXITCODE -ne 0){throw 'APK alignment failed'}
& (Join-Path $apkTools 'apksigner.bat') sign --ks $apkAsciiKey --ks-key-alias mineradio --ks-pass ('file:'+$apkAsciiPassword) --out (Join-Path $apkBuild 'signed.apk') (Join-Path $apkBuild 'aligned.apk')
if($LASTEXITCODE -ne 0){throw 'APK signing failed'}
& (Join-Path $apkTools 'apksigner.bat') verify --verbose (Join-Path $apkBuild 'signed.apk')
if($LASTEXITCODE -ne 0){throw 'APK signature verification failed'}
Copy-Item -LiteralPath (Join-Path $apkBuild 'signed.apk') -Destination $apkFinal -Force
if ($Variant -eq 'release') {
    Copy-Item -LiteralPath $apkFinal -Destination (Join-Path $apkDist ('Mineradio-' + $apkVersion + '.apk')) -Force
}
Get-FileHash -LiteralPath $apkFinal -Algorithm SHA256 | Format-List
