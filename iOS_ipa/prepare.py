"""Stage an account-free iOS source snapshot; runnable on Windows and macOS."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
import io
import tomllib
from qishui_config import load_config
from web_release import refresh as refresh_web_release

PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT.parent
APP = PROJECT / 'src/mineradio'
VERSION = tomllib.loads((PROJECT / 'pyproject.toml').read_text(encoding='utf-8'))['tool']['briefcase']['version']
DEPENDENCIES = ['pyaes==1.6.1', 'rsa==4.9.1', 'pyasn1==0.6.1',
                'qrcode==8.2', 'pypng==0.20220715.0', 'paho-mqtt==2.1.0', 'certifi==2026.10.23']
ICON_SIZES = (20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 640, 1024, 1280, 1920)
SDK_URL = 'https://sf3-ttcdn-tos.pstatp.com/obj/volcengine/VolMetaSecML/4.3.9/VolMetaSecML.zip'
SDK_SHA256 = '06fe7eeaef17a76f61c6480299f22a9fa651770992ffda49ee970efaa513c1d5'
LIB_SHA256 = 'ccd447a70b69b593041efda9ccc675f8c60cc81dee61065a04977020231510d8'
VERIFY_URL = 'https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/1.0.0.427/index.js'
VERIFY_URLS = (VERIFY_URL,
    VERIFY_URL.replace('lf-rc1.yhgfb-cn-static.com', 'lf-rc2.yhgfb-cn-static.com'),
    VERIFY_URL.replace('lf-rc1.yhgfb-cn-static.com', 'lf-cdn-tos.bytescm.com'))
VERIFY_SHA256 = '34ab7e29bc9f638008074bf615570cb940815ca67e28ff2a29e22af24d721be2'


def prepare_signer():
    target = PROJECT / 'native/vendor/VolMetaSecML'
    library = target / 'libmetasec_ml.a'
    if not library.is_file() or hashlib.sha256(library.read_bytes()).hexdigest() != LIB_SHA256:
        with urllib.request.urlopen(SDK_URL, timeout=60) as response:
            data = response.read(100 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != SDK_SHA256:
            raise ValueError('Official iOS SDK ZIP hash mismatch')
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in ('libmetasec_ml.a', 'MSConfig.h', 'MSManager.h', 'LICENSE'):
                (target / name).write_bytes(archive.read('VolMetaSecML/' + name))
    if hashlib.sha256(library.read_bytes()).hexdigest() != LIB_SHA256:
        raise ValueError('Official iOS SDK library hash mismatch')
    (target.parent / 'provenance.json').write_text(json.dumps(dict(version='4.3.9',
        source=SDK_URL, archiveSHA256=SDK_SHA256, librarySHA256=LIB_SHA256,
        deviceArchitecture='arm64', simulatorArchitecture='x86_64'), indent=2), encoding='utf-8')


def replace_generated(source, destination):
    destination = Path(destination)
    # Never follow a link outside this dedicated project to remove build data.
    resolved = destination.resolve()
    if not resolved.is_relative_to(APP.resolve()) or destination.is_symlink():
        raise ValueError('Generated staging path escaped the app source directory')
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns('tests', '__pycache__', '*.pyc'))


def prepare_phone_security(passport):
    cache = PROJECT / 'build/passport-verify-sdk.js'
    if not cache.is_file() or hashlib.sha256(cache.read_bytes()).hexdigest() != VERIFY_SHA256:
        for index, url in enumerate(VERIFY_URLS):
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    raw = response.read(2 * 1024 * 1024)
                break
            except OSError:
                if index == len(VERIFY_URLS) - 1:
                    raise
        if hashlib.sha256(raw).hexdigest() != VERIFY_SHA256:
            raise ValueError('Official Passport verification SDK hash mismatch')
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(raw)
    (passport / 'verify-sdk.js').write_bytes(cache.read_bytes())
    shutil.copy2(PROJECT / 'assets/qishui-phone-security.js', passport / 'phone-security.js')
    (passport / 'verify-provenance.json').write_text(json.dumps(dict(
        source=VERIFY_URL, mirrors=VERIFY_URLS, sha256=VERIFY_SHA256, version='1.0.0.427'), indent=2), encoding='utf-8')


def prepare(skip_deps=False, qishui_config=None):
    public = load_config(qishui_config)
    prepare_signer()
    APP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mineradio-ios-') as staging:
        stage = Path(staging)
        bundle = stage / 'bundle'
        # Copy allowlisted source trees only. Config, runtime, SDKs, signing
        # materials, downloaded media and user account files are never inputs.
        for origin in (ROOT / 'music_app').rglob('*.py'):
            if '__pycache__' not in origin.parts:
                output = bundle / 'python/music_app' / origin.relative_to(ROOT / 'music_app')
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(origin, output)
        shutil.copytree(ROOT / 'web', bundle / 'web', ignore=shutil.ignore_patterns(
            '__pycache__', '*.pyc', '*.map', '*.bak', '*.log', '.DS_Store'))
        shutil.copytree(ROOT / 'third_party', bundle / 'third_party')
        sdk_notice = bundle / 'third_party/VolMetaSecML'
        sdk_notice.mkdir()
        shutil.copy2(PROJECT / 'native/vendor/VolMetaSecML/LICENSE', sdk_notice / 'LICENSE')
        shutil.copy2(PROJECT / 'native/vendor/provenance.json', sdk_notice / 'provenance.json')
        for name in ('ios-bridge.js', 'ios-layout.js', 'ios.css'):
            shutil.copy2(PROJECT / 'assets' / name, bundle / 'web/player' / name)
        web_revision = refresh_web_release(bundle / 'web/player')
        # A clean checkout must build without the original developer's runtime/.
        # Missing optional Qishui settings must not prevent local music or the
        # other platforms from starting. Never invent an app license.
        (bundle / 'sdk-config.json').write_text(json.dumps(public), encoding='utf-8')
        sys.path.insert(0, str(ROOT))
        from music_app.auth.qishui.browser import _security_assets
        passport = bundle / 'passport'
        passport.mkdir()
        assets = _security_assets()
        for name in ('security_seed.html', 'security_host.html', 'bdms.js', 'sdk-glue.js', 'react.js', 'react-dom.js'):
            (passport / name).write_bytes(assets[name])
        prepare_phone_security(passport)
        # The platform SDK is linked separately. Source preparation alone
        # never certifies its license, network callback or media runtime.
        hashes = {p.relative_to(bundle).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(bundle.rglob('*')) if p.is_file()}
        (bundle / 'source-manifest.json').write_text(json.dumps(
            {'version': VERSION, 'platform': 'ios', 'files': hashes,
             'runtime': 'embedded-local', 'remoteBackendRequired': False,
             'webRevision': web_revision,
             'qishuiConfigured': public['configured'],
             'qishuiPhoneLoginImplemented': True,
             'validationPending': ['qishuiNativeSigning', 'qishuiAccountFlow', 'physicalDevice'],
             'accountFilesIncluded': False}, ensure_ascii=False, indent=2), encoding='utf-8')
        replace_generated(bundle, APP / 'bundle')
        if not skip_deps:
            vendor = stage / 'vendor'
            subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
                '--no-compile', '--no-deps', '--target', str(vendor), *DEPENDENCIES], check=True)
            for path in list(vendor.rglob('__pycache__')):
                shutil.rmtree(path)
            for name in ('bin', 'Scripts'):
                if (vendor / name).is_dir():
                    shutil.rmtree(vendor / name)
            forbidden = [p for p in vendor.rglob('*') if p.is_file() and p.suffix.lower() in
                         ('.pyd', '.dll', '.so', '.dylib', '.exe')]
            if forbidden:
                raise ValueError('iOS protocol dependencies must contain only Python/data files')
            replace_generated(vendor, APP / 'vendor')
        elif not (APP / 'vendor/pyaes/__init__.py').is_file():
            raise ValueError('Run prepare.py without --skip-deps on the first preparation')
    from PIL import Image
    icon = PROJECT / 'resources'
    icon.mkdir(exist_ok=True)
    with Image.open(ROOT / 'Windows_exe/assets/icon.png') as image:
        image = image.convert('RGBA')
        opaque = Image.new('RGBA', image.size, '#111923')
        opaque.alpha_composite(image)
        for size in ICON_SIZES:
            opaque.convert('RGB').resize((size, size), Image.Resampling.LANCZOS).save(icon / f'icon-{size}.png')
    shutil.copy2(ROOT / 'third_party/mineradio/LICENSE', PROJECT / 'LICENSE.txt')
    print(json.dumps({'ready': True, 'files': len(hashes), 'accountFilesIncluded': False,
                      'needsMacOSBuild': True, 'deviceValidated': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-deps', action='store_true')
    parser.add_argument('--qishui-config', type=Path,
                        help='Optional authorized SDK settings; never account cookies or device state')
    args = parser.parse_args()
    prepare(args.skip_deps, args.qishui_config)
