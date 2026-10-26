"""Build on a Mac/cloud runner; package a real arm64 app for personal signing."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import zipfile
import tomllib
from native_build import linker_settings
from launch_screen import install_blank_launch_screen

PROJECT = Path(__file__).resolve().parent
VERSION = tomllib.loads((PROJECT / 'pyproject.toml').read_text(encoding='utf-8'))['tool']['briefcase']['version']


def run(*args, log_path=None):
    if log_path is None:
        subprocess.run(args, cwd=PROJECT, check=True)
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open('w', encoding='utf-8') as output:
        result = subprocess.run(args, cwd=PROJECT, stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        print('\n'.join(log_path.read_text(encoding='utf-8', errors='replace').splitlines()[-100:]), flush=True)
        result.check_returncode()


def build():
    if sys.platform != 'darwin' or not shutil.which('xcodebuild'):
        raise SystemExit('IPA compilation requires macOS + Xcode. Use the included GitHub Actions workflow from Windows.')
    if not (PROJECT / 'src/mineradio/bundle/source-manifest.json').is_file():
        raise SystemExit('Run prepare.py first, or use the prepared source ZIP.')
    bundle = PROJECT / 'src/mineradio/bundle'
    manifest = json.loads((bundle / 'source-manifest.json').read_text(encoding='utf-8'))
    for relative, expected in manifest['files'].items():
        path = (bundle / relative).resolve()
        if not path.is_relative_to(bundle.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Prepared source hash mismatch: ' + relative)
    generated = PROJECT / 'build/mineradio/ios/xcode/Mineradio.xcodeproj'
    if generated.is_dir():
        run(sys.executable, '-m', 'briefcase', 'update', 'iOS', '--no-input')
    else:
        run(sys.executable, '-m', 'briefcase', 'create', 'iOS', '--no-input')
    products = PROJECT / 'build/device-products'
    print('Compiling the arm64 device application; full output is saved to device-build.log', flush=True)
    run('xcodebuild', '-project', str(generated), '-scheme', 'Mineradio',
        '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS',
        'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=',
        'EXPANDED_CODE_SIGN_IDENTITY=-', 'EXPANDED_CODE_SIGN_IDENTITY_NAME=ad-hoc',
        'TARGETED_DEVICE_FAMILY=1,2', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=NO',
        'CONFIGURATION_BUILD_DIR=' + str(products), *linker_settings('iphoneos', 'arm64'), 'build',
        log_path=PROJECT / 'dist/device-build.log')
    app = products / 'Mineradio.app'
    launch = install_blank_launch_screen(app, 'iphoneos')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if set(info.get('UIDeviceFamily', [])) != {1, 2}:
        raise RuntimeError('Build must support both iPhone and iPad')
    if info.get('CFBundleSupportedPlatforms') != ['iPhoneOS']:
        raise RuntimeError('A simulator build cannot be installed on an iPad')
    if not (app / info['CFBundleExecutable']).is_file():
        raise RuntimeError('Native app executable is missing')
    dist = PROJECT / 'dist'
    dist.mkdir(exist_ok=True)
    output = dist / ('Mineradio-' + VERSION + '-local-unsigned.ipa')
    # ditto preserves framework symlinks and Unix modes needed by iOS.
    payload = PROJECT / 'build/ipa-stage/Payload'
    payload.mkdir(parents=True, exist_ok=True)
    staged = payload / app.name
    if staged.exists():
        if not staged.resolve().is_relative_to((PROJECT / 'build/ipa-stage').resolve()):
            raise RuntimeError('IPA staging path escaped the build directory')
        shutil.rmtree(staged)
    run('ditto', str(app), str(staged))
    run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(payload), str(output))
    run(sys.executable, str(PROJECT / 'verify_ipa.py'), str(output))
    report = {'artifact': output.name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
              'signed': False, 'deviceValidated': False,
              'channel': 'ipad-local-preview', 'runtime': 'embedded-local',
              'remoteBackendRequired': False,
              'qishuiConfigured': bool(manifest.get('qishuiConfigured')),
              'qishuiPhoneLoginImplemented': True, 'qishuiAccountAuthorized': False, 'qishuiRuntimeValidated': False,
              'presentation': launch,
              'install': 'Sign and install with your own Apple account on Windows'}
    (dist / 'build-result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    build()
