"""Produce a standalone, prepared private-cloud build kit, never a fake IPA."""
import hashlib
import json
from pathlib import Path
import zipfile
import tomllib
from web_release import verify as verify_web_release

PROJECT = Path(__file__).resolve().parent
VERSION = tomllib.loads((PROJECT / 'pyproject.toml').read_text(encoding='utf-8'))['tool']['briefcase']['version']


def export():
    app = PROJECT / 'src/mineradio'
    if not (app / 'bundle/source-manifest.json').is_file() or not (app / 'vendor/pyaes/__init__.py').is_file():
        raise SystemExit('Run prepare.py first')
    manifest = json.loads((app / 'bundle/source-manifest.json').read_text(encoding='utf-8'))
    verify_web_release(app / 'bundle/web/player')
    for relative, expected in manifest['files'].items():
        source = None
        if relative.startswith('python/music_app/'):
            source = PROJECT.parent / relative.removeprefix('python/')
        elif relative.startswith('web/') and relative != 'web/player/offline-assets.js':
            source = PROJECT.parent / relative
        elif relative.startswith('third_party/') and not relative.startswith('third_party/VolMetaSecML/'):
            source = PROJECT.parent / relative
        if relative in ('web/player/ios-bridge.js', 'web/player/ios-layout.js', 'web/player/ios.css'):
            source = PROJECT / 'assets' / Path(relative).name
        if source is not None and source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise SystemExit('Shared source changed; run prepare.py --skip-deps before exporting: ' + relative)
    for name in ('ios-bridge.js', 'ios-layout.js', 'ios.css'):
        if (PROJECT / 'assets' / name).read_bytes() != (app / 'bundle/web/player' / name).read_bytes():
            raise SystemExit('Bridge assets changed; run prepare.py --skip-deps before exporting')
    dist = PROJECT / 'dist'
    dist.mkdir(exist_ok=True)
    output = dist / ('Mineradio-iOS-' + VERSION + '-local-source.zip')
    files = {}
    for name in ('pyproject.toml', 'LICENSE.txt', 'README.md', 'build_unsigned.py', 'build_simulator_smoke.py', 'verify_ipa.py',
                 'native_build.py', 'launch_screen.py', '云端构建.ps1', '开始云端构建.bat'):
        data = (PROJECT / name).read_bytes()
        files[name] = b'\xef\xbb\xbf' + data.decode('utf-8-sig').encode('utf-8') if name.endswith('.ps1') else data
    for directory in ('src', 'resources', 'native'):
        for path in sorted((PROJECT / directory).rglob('*')):
            if (path.is_file() and path.name != 'remote_app.py'
                    and not set(path.parts).intersection({'__pycache__', 'tests', 'node_modules'})
                    and path.suffix != '.pyc'):
                files[path.relative_to(PROJECT).as_posix()] = path.read_bytes()
    files['.github/workflows/ios-build.yml'] = (PROJECT / 'cloud-build.yml').read_bytes()
    # Generated app/vendor directories must be committed in this standalone kit.
    files['.gitignore'] = b'.venv/\nbuild/\ndist/\n__pycache__/\n*.pyc\n.DS_Store\n'
    files['.gitattributes'] = b'* -text\n'
    files['prepared-source.json'] = json.dumps(dict(version=VERSION, prepared=True,
        runtime='embedded-local', remoteBackendRequired=False,
        accountFilesIncluded=False, deviceValidated=False, platform='ios'), indent=2).encode()
    files['manifest.sha256'] = ('\n'.join(hashlib.sha256(data).hexdigest()+'  '+name
        for name, data in sorted(files.items()))+'\n').encode()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip():
            raise ValueError('Source archive checksum verification failed')
        for name, data in files.items():
            if archive.read(name) != data:
                raise ValueError('Source archive readback mismatch')
    print(json.dumps(dict(path=str(output), size=output.stat().st_size,
        sha256=hashlib.sha256(output.read_bytes()).hexdigest(), files=len(files),
        zipVerified=True, containsIPA=False, deviceValidated=False)))


if __name__ == '__main__':
    export()
