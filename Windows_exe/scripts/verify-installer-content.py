"""Inspect the built NSIS artifact without installing it or touching user data."""
from pathlib import Path
import argparse
import hashlib
import json
import ntpath
import subprocess
import time


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    desktop = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', default=json.loads((desktop / 'package.json').read_text(encoding='utf-8'))['version'])
    parser.add_argument('--web-manifest', type=Path,
                        help='Frozen source SHA256 manifest captured before packaging; use when the workspace continues changing')
    parser.add_argument('--installer', type=Path, help='Explicit frozen installer to audit')
    parser.add_argument('--tested-payload', type=Path, help='Frozen executable directory used by acceptance tests')
    args = parser.parse_args()
    if not all(part.isdigit() for part in args.version.split('.')):
        raise ValueError('A numeric release version is required')
    installer = args.installer.resolve() if args.installer else desktop / 'dist' / f'Mineradio-{args.version}-Setup-x64.exe'
    tested_payload = args.tested_payload.resolve() if args.tested_payload else desktop / 'dist/win-unpacked'
    tool = desktop / 'node_modules/electron-winstaller/vendor/7z-x64.exe'
    target = desktop / 'verification' / f'installer-inspection-{args.version}-{time.time_ns()}'
    assert target.resolve().is_relative_to((desktop / 'verification').resolve())
    target.mkdir()

    def archive(*arguments):
        return subprocess.run([str(tool), *map(str, arguments)], check=True, capture_output=True,
                              text=True, encoding='utf-8', errors='replace', creationflags=subprocess.CREATE_NO_WINDOW).stdout

    archive('x', '-y', installer, '-o' + str(target), '$PLUGINSDIR\\app-64.7z')
    payload = target / '$PLUGINSDIR' / 'app-64.7z'
    archive('t', payload)  # CRC-check every embedded file, including runtimes/SDK.
    inventory = archive('l', '-slt', payload)
    (target / 'archive-inventory.txt').write_text(inventory, encoding='utf-8')
    members = [line[7:].replace('\\', '/') for line in inventory.splitlines() if line.startswith('Path = ')]
    members = [name for name in members if not ntpath.isabs(name)]
    unexpected = [name for name in members if any(part.lower() in {'tests', 'verification', '.git', '.env', 'config'}
                                                for part in name.split('/')) or name.lower().endswith(('/cookies', '/backend-ports.json'))]
    if unexpected:
        raise AssertionError(f'Unexpected test/user paths in installer: {unexpected}')
    selected = target / 'selected'
    critical = ['Mineradio.exe', 'resources/app.asar', 'resources/backend/MineradioBackend.exe']
    archive('x', '-y', payload, '-o' + str(selected), 'resources\\backend\\_internal\\web\\*',
            *[name.replace('/', '\\') for name in critical], '-r')
    embedded_web = (selected / 'resources/backend/_internal/web').resolve()
    if args.web_manifest:
        expected_web = json.loads(args.web_manifest.read_text(encoding='utf-8'))
        assert isinstance(expected_web, dict) and expected_web
        for name, digest in expected_web.items():
            embedded = (embedded_web / name).resolve()
            assert embedded.is_relative_to(embedded_web), name
            assert isinstance(digest, str) and len(digest) == 64
            assert embedded.is_file() and sha256(embedded) == digest, name
        assert len([p for p in embedded_web.rglob('*') if p.is_file()]) == len(expected_web)
        web_count = len(expected_web)
    else:
        source_web = desktop.parent / 'web'
        web_files = [path for path in source_web.rglob('*') if path.is_file()]
        for path in web_files:
            embedded = embedded_web / path.relative_to(source_web)
            assert embedded.is_file() and sha256(path) == sha256(embedded), str(path.relative_to(source_web))
        web_count = len(web_files)
    for name in critical:
        assert sha256(tested_payload / name) == sha256(selected / name), name
    report = {'ok': True, 'version': args.version, 'installer': installer.name, 'installerBytes': installer.stat().st_size,
              'installerSha256': sha256(installer), 'embeddedPayloadSha256': sha256(payload),
              'allEmbeddedFilesCrcVerified': True, 'archiveEntryCount': len(members),
              'webFilesMatchSource': web_count, 'webSourceIsFrozenSnapshot': bool(args.web_manifest),
              'sourceManifestSha256': sha256(args.web_manifest) if args.web_manifest else None,
              'binaryFilesMatchTestedPayload': critical,
              'unexpectedTestOrUserConfigPaths': unexpected}
    destination = desktop / 'verification' / f'installer-content-verification-{args.version}.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    installer.with_suffix(installer.suffix + '.sha256').write_text(report['installerSha256'] + '  ' + installer.name + '\n', encoding='ascii')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
