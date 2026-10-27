"""Stage Android sources with an explicitly supplied, verified SDK bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import zipfile

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parent

MARKER = '.mineradio-source-workspace'
CONFIG_FIELDS = ('appId', 'license', 'clientType', 'collectMode', 'channel')


def default_workspace():
    return Path(os.environ.get('MINERADIO_ANDROID_WORKSPACE') or
                Path(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir()) /
                'MineradioAndroidBuild/source-project')


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def workspace(value):
    target = Path(value).resolve()
    if not str(target).isascii():
        raise ValueError('Android build workspace must use an ASCII path; pass --workspace')
    if target == ROOT or ROOT.is_relative_to(target) or target.is_relative_to(SOURCE):
        raise ValueError('Build workspace must be separate from the Android source tree')
    if target.exists() and any(target.iterdir()) and not (target / MARKER).is_file():
        raise ValueError('Refusing to overwrite an unmanaged build directory')
    target.mkdir(parents=True, exist_ok=True)
    (target / MARKER).write_text('Mineradio generated Android sources\n', encoding='utf-8')
    return target


def remove_generated(target, relative):
    path = target / relative
    resolved = path.resolve()
    if not resolved.is_relative_to(target.resolve()) or resolved == target.resolve() or path.is_symlink():
        raise ValueError('Generated path escaped its managed workspace')
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def replace_tree(source, target, relative, *, ignore=()):
    remove_generated(target, relative)
    if source.is_dir():
        shutil.copytree(source, target / relative,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', *ignore))


def _bundle_file(root, value):
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise ValueError('SDK artifact must be a relative file path')
    path = (root / value).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('SDK artifact escaped the supplied bundle')
    return path


def load_sdk(value=None):
    """Only explicit, hashed artifacts are accepted; no private runtime discovery."""
    if not value:
        raise ValueError('Full Qishui support requires --sdk-bundle or MINERADIO_ANDROID_SDK_BUNDLE; use extract_sdk.py with your installed app first')
    root = Path(value).resolve(strict=True)
    manifest = json.loads((root / 'sdk-manifest.json').read_text(encoding='utf-8-sig'))
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1:
        raise ValueError('SDK manifest schemaVersion must be 1')
    config = manifest.get('config')
    if not isinstance(config, dict) or set(config) != set(CONFIG_FIELDS):
        raise ValueError('SDK config must contain only appId, license, clientType, collectMode and channel')
    for name in ('appId', 'license', 'channel'):
        if not isinstance(config[name], str) or not config[name] or len(config[name]) > 8192 or any(ord(c) < 32 for c in config[name]):
            raise ValueError('SDK config text is invalid')
    for name in ('clientType', 'collectMode'):
        if type(config[name]) is not int or not 0 <= config[name] <= 2147483647:
            raise ValueError('SDK config numeric field is invalid')
    source = manifest.get('source', '')
    if not isinstance(source, str) or not source or len(source) > 2048:
        raise ValueError('SDK manifest must identify its source')
    result = {'config': {'configured': True, **config}, 'source': source}
    seen = set()
    for kind in ('native', 'dex'):
        items = manifest.get(kind)
        if not isinstance(items, list) or not 1 <= len(items) <= 64:
            raise ValueError('SDK bundle needs bounded native and ordered dex artifact lists')
        artifacts = []
        names = set()
        for item in items:
            if not isinstance(item, dict) or set(item) != {'path', 'sha256'}:
                raise ValueError('Each SDK artifact needs path and sha256')
            digest = item['sha256']
            if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
                raise ValueError('Invalid SDK artifact digest')
            path = _bundle_file(root, item['path'])
            if path in seen or path.name in names or not 1 <= path.stat().st_size <= 128 * 1024 * 1024:
                raise ValueError('SDK artifact is duplicated, empty or oversized')
            seen.add(path)
            names.add(path.name)
            if sha256(path) != digest:
                raise ValueError('SDK artifact SHA-256 mismatch: ' + path.name)
            with path.open('rb') as stream:
                header = stream.read(24)
            if kind == 'dex' and not re.fullmatch(rb'dex\n[0-9]{3}\x00', header[:8]):
                raise ValueError('SDK dex artifact has an invalid header')
            if kind == 'native' and (not path.name.endswith('.so') or header[:6] != b'\x7fELF\x02\x01' or header[18:20] != b'\xb7\x00'):
                raise ValueError('SDK native artifact must be an ARM64 little-endian ELF library')
            artifacts.append({'path': path, 'sha256': digest})
        result[kind] = artifacts
    if not any(item['path'].name == 'libmetasec_ml.so' for item in result['native']):
        raise ValueError('SDK bundle must include libmetasec_ml.so for the existing adapter')
    return result


def _stage_sdk(sdk, target):
    remove_generated(target, 'app/src/main/jniLibs')
    remove_generated(target, 'sdk-artifacts')
    provenance = {'configured': True, 'source': sdk['source'], 'native': [], 'dex': []}
    for kind in ('native', 'dex'):
        for index, artifact in enumerate(sdk[kind], 1):
            relative = ('app/src/main/jniLibs/arm64-v8a/' + artifact['path'].name if kind == 'native'
                        else 'sdk-artifacts/%03d.dex' % index)
            output = target / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(artifact['path'], output)
            provenance[kind].append({'path': relative, 'sha256': artifact['sha256']})
    for relative in ('app/src/main/assets/sdk-config.json', 'app/src/main/assets/bundle/sdk-config.json'):
        (target / relative).write_text(json.dumps(sdk['config'], ensure_ascii=True), encoding='utf-8')
    (target / 'sdk-provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')


def passport_assets():
    sys.path.insert(0, str(ROOT))
    from music_app.auth.qishui.browser import _security_assets
    return _security_assets()


def prepare(target=None, sdk_bundle=None, android_sdk=None):
    sdk = load_sdk(sdk_bundle or os.environ.get('MINERADIO_ANDROID_SDK_BUNDLE'))
    target = workspace(target or default_workspace())
    for name in ('settings.gradle', 'build.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat'):
        shutil.copy2(SOURCE / name, target / name)
    replace_tree(SOURCE / 'gradle', target, 'gradle')
    for folder in ('java', 'res', 'python', 'assets'):
        replace_tree(SOURCE / 'app/src/main' / folder, target, 'app/src/main/' + folder,
                     ignore=('bundle', 'sdk-config.json'))
    replace_tree(SOURCE / 'app/src/debug', target, 'app/src/debug')
    shutil.copy2(SOURCE / 'app/build.gradle', target / 'app/build.gradle')
    shutil.copy2(SOURCE / 'app/src/main/AndroidManifest.xml', target / 'app/src/main/AndroidManifest.xml')
    replace_tree(ROOT / 'music_app', target, 'app/src/main/python/music_app')
    bundle = 'app/src/main/assets/bundle'
    web_source = Path(os.environ.get('MINERADIO_BUILD_WEB_SNAPSHOT') or ROOT / 'web').resolve(strict=True)
    replace_tree(web_source, target, bundle + '/web', ignore=('*.map', '*.bak', '*.log', '.DS_Store'))
    shutil.copy2(SOURCE / 'app/src/main/assets/android-bridge.js', target / bundle / 'web/player/android-bridge.js')
    for name in ('service-worker.js', 'offline-assets.js', 'js/features/shell/offline-shell.js'):
        (target / bundle / 'web/player' / name).unlink(missing_ok=True)
    replace_tree(ROOT / 'third_party', target, bundle + '/third_party')
    passport = target / 'app/src/main/assets/passport'
    passport.mkdir(parents=True, exist_ok=True)
    for name, data in passport_assets().items():
        if name in ('security_seed.html', 'security_host.html', 'bdms.js', 'sdk-glue.js', 'react.js', 'react-dom.js'):
            (passport / name).write_bytes(data)
    _stage_sdk(sdk, target)
    android_sdk = android_sdk or os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not android_sdk and os.environ.get('LOCALAPPDATA'):
        candidate = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk'
        if candidate.is_dir():
            android_sdk = candidate
    local_properties = target / 'local.properties'
    if android_sdk:
        local_properties.write_text('sdk.dir=' + Path(android_sdk).resolve().as_posix() + '\n', encoding='utf-8')
    elif local_properties.exists():
        local_properties.unlink()
    info = {'workspace': str(target), 'qishuiSdkConfigured': True,
            'accountFilesIncluded': False, 'sdkArtifactsVerified': True, 'offlineShellCacheEnabled': False}
    print(json.dumps(info))
    return info


def package(variant, target=None):
    target = Path(target or default_workspace()).resolve(strict=True)
    if not (target / MARKER).is_file() or variant not in ('debug', 'release'):
        raise ValueError('Run preparation in a managed workspace before packaging')
    source = target / ('app/build/outputs/apk/' + variant + '/app-' + variant + ('-unsigned' if variant == 'release' else '') + '.apk')
    provenance = json.loads((target / 'sdk-provenance.json').read_text(encoding='utf-8'))
    for kind in ('native', 'dex'):
        for artifact in provenance[kind]:
            path = _bundle_file(target, artifact['path'])
            if sha256(path) != artifact['sha256']:
                raise ValueError('Staged SDK changed since preparation')
    output = target / 'mineradio-unsigned.apk'
    shutil.copy2(source, output)
    with zipfile.ZipFile(output, 'a') as archive:
        indexes = [int(match.group(1) or 1) for name in archive.namelist()
                   if (match := re.fullmatch(r'classes([0-9]*)\.dex', name))]
        count = max(indexes, default=0)
        for index, artifact in enumerate(provenance['dex'], count + 1):
            archive.write(target / artifact['path'], 'classes%d.dex' % index, compress_type=zipfile.ZIP_DEFLATED)
    result = {'baseDexCount': len(indexes), 'sdkDexCount': len(provenance['dex']), 'unsignedApk': str(output)}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('variant', nargs='?', choices=('debug', 'release'), help='Package an already built APK')
    parser.add_argument('--workspace', type=Path, default=default_workspace())
    parser.add_argument('--sdk-bundle', type=Path, help='Explicit SDK directory produced by extract_sdk.py')
    parser.add_argument('--android-sdk', type=Path)
    args = parser.parse_args()
    if args.variant:
        package(args.variant, args.workspace)
    else:
        prepare(args.workspace, args.sdk_bundle, args.android_sdk)
