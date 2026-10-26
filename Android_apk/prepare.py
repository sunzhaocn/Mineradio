"""Prepare an ASCII build workspace, excluding all desktop/user credentials."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import sys
import zipfile

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parent
PROBE = ROOT / 'runtime/android-portability/com.luna.music-21.3.0'
TARGET = Path(os.environ['LOCALAPPDATA']) / 'MineradioAndroidBuild/project'


def prepare():
    for name in ('settings.gradle', 'build.gradle', 'gradle.properties'):
        TARGET.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE / name, TARGET / name)
    for folder in ('java', 'res', 'python', 'assets'):
        if folder == 'java':
            # A removed source must not survive the incremental staging copy
            # and silently remain in the next APK's DEX.
            staged_java = (TARGET / 'app/src/main/java').resolve()
            if not staged_java.is_relative_to(TARGET.resolve()):
                raise RuntimeError('Java staging directory escaped the Android build workspace')
            for old in staged_java.rglob('*.java'):
                resolved = old.resolve()
                if not resolved.is_relative_to(staged_java):
                    raise RuntimeError('Java staging file escaped its managed directory')
                if not (SOURCE / 'app/src/main/java' / old.relative_to(staged_java)).is_file():
                    old.unlink()
        shutil.copytree(SOURCE / 'app/src/main' / folder, TARGET / 'app/src/main' / folder,
                        dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'bundle', 'sdk-config.json'))
    if (SOURCE / 'app/src/debug').is_dir():
        shutil.copytree(SOURCE / 'app/src/debug', TARGET / 'app/src/debug', dirs_exist_ok=True)
    shutil.copy2(SOURCE / 'app/build.gradle', TARGET / 'app/build.gradle')
    shutil.copy2(SOURCE / 'app/src/main/AndroidManifest.xml', TARGET / 'app/src/main/AndroidManifest.xml')
    staged_python = (TARGET / 'app/src/main/python/music_app').resolve()
    if not staged_python.is_relative_to(TARGET.resolve()):
        raise RuntimeError('Python staging directory escaped the Android build workspace')
    if staged_python.is_dir():
        shutil.rmtree(staged_python)
    shutil.copytree(ROOT / 'music_app', TARGET / 'app/src/main/python/music_app', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    bundle = TARGET / 'app/src/main/assets/bundle'
    # A release may consume the already verified desktop web snapshot so
    # concurrent workspace edits cannot split the two shipped frontends.
    web_source = Path(os.environ.get('MINERADIO_BUILD_WEB_SNAPSHOT') or ROOT / 'web').resolve(strict=True)
    staged_web = (bundle / 'web').resolve()
    if not staged_web.is_relative_to(TARGET.resolve()):
        raise RuntimeError('Web staging directory escaped the Android build workspace')
    if staged_web.is_dir():
        shutil.rmtree(staged_web)
    shutil.copytree(web_source, bundle / 'web', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('*.map', '*.bak', '*.log', '__pycache__', '.DS_Store'))
    shutil.copy2(SOURCE / 'app/src/main/assets/android-bridge.js', bundle / 'web/player/android-bridge.js')
    shutil.copytree(ROOT / 'third_party', bundle / 'third_party', dirs_exist_ok=True)
    passport = SOURCE / '.local/passport'
    required = ('security_seed.html', 'security_host.html', 'bdms.js', 'sdk-glue.js', 'react.js', 'react-dom.js')
    if not all((passport / name).is_file() for name in required):
        sys.path.insert(0, str(ROOT))
        from music_app.auth.qishui.browser import _security_assets
        data = _security_assets()  # Existing pinned archive hash is checked before use.
        passport.mkdir(parents=True, exist_ok=True)
        for name in required:
            (passport / name).write_bytes(data[name])
    shutil.copytree(passport, TARGET / 'app/src/main/assets/passport', dirs_exist_ok=True)
    assets = TARGET / 'app/src/main/assets'
    config = json.loads((PROBE / 'full-verification/probe-runtime-config.json').read_text(encoding='utf-8-sig'))
    config = {key: config[key] for key in ('appId', 'license', 'clientType', 'collectMode', 'channel')}
    (assets / 'sdk-config.json').write_text(json.dumps(config), encoding='utf-8')
    native = TARGET / 'app/src/main/jniLibs/arm64-v8a'
    native.mkdir(parents=True, exist_ok=True)
    shutil.copy2(PROBE / 'native-analysis/libmetasec_ml.so', native / 'libmetasec_ml.so')
    sdk = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk'
    (TARGET / 'local.properties').write_text('sdk.dir=' + sdk.as_posix() + '\n', encoding='utf-8')
    print(json.dumps({'workspace': str(TARGET), 'sdkSourceVerified': True, 'accountFilesIncluded': False}))


def package(variant):
    input_apk = TARGET / ('app/build/outputs/apk/' + variant + '/app-' + variant + ('-unsigned' if variant == 'release' else '') + '.apk')
    output = TARGET / 'mineradio-with-sdk.apk'
    shutil.copy2(input_apk, output)
    hashes = []
    with zipfile.ZipFile(PROBE / 'base.apk') as source, zipfile.ZipFile(output, 'a') as dest:
        count = sum(1 for name in dest.namelist() if name.startswith('classes') and name.endswith('.dex') and '/' not in name)
        for index in range(1, 22):
            name = 'classes' + (str(index) if index > 1 else '') + '.dex'
            data = source.read(name)
            dest.writestr('classes' + str(count + index) + '.dex', data, compress_type=zipfile.ZIP_DEFLATED)
            hashes.append({'original': name, 'packaged': 'classes' + str(count + index) + '.dex', 'sha256': hashlib.sha256(data).hexdigest()})
    (TARGET / 'sdk-provenance.json').write_text(json.dumps({'originalDexFiles': hashes, 'originalNativeModified': False}, indent=2), encoding='utf-8')
    print(json.dumps({'baseDexCount': count, 'originalDexCount': len(hashes), 'unsignedApk': str(output)}))


if __name__ == '__main__':
    if len(sys.argv) > 1: package(sys.argv[1])
    else: prepare()
