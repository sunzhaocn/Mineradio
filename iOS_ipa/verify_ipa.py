"""Audit the real IPA structure, device architecture and shipped app payload."""
import json
from pathlib import Path, PurePosixPath
import plistlib
import struct
import sys
import zipfile


def verify(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip():
            raise ValueError('IPA ZIP checksum failure')
        names = archive.namelist()
        if any(PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts for name in names):
            raise ValueError('Unsafe archive path')
        plists = [n for n in names if n.startswith('Payload/') and n.count('/') == 2 and n.endswith('.app/Info.plist')]
        if len(plists) != 1:
            raise ValueError('Expected one iOS application in Payload')
        prefix = plists[0].removesuffix('Info.plist')
        info = plistlib.loads(archive.read(plists[0]))
        if set(info.get('UIDeviceFamily', [])) != {1, 2} or info.get('CFBundleSupportedPlatforms') != ['iPhoneOS']:
            raise ValueError('Not an iPhone/iPad device application')
        binary = archive.read(prefix + info['CFBundleExecutable'])
        # A single-architecture arm64 build must have a 64-bit Mach-O header.
        if len(binary) < 32 or struct.unpack_from('<II', binary) != (0xFEEDFACF, 0x0100000C):
            raise ValueError('Executable is not a device arm64 Mach-O')
        for suffix in ('mineradio/app.py', 'mineradio/backend.py',
                       'bundle/web/player/ios-bridge.js', 'bundle/python/music_app/api/server.py'):
            if not any(name.endswith(suffix) for name in names):
                raise ValueError('Missing application resource: ' + suffix)
        forbidden = ('signing-password.txt', 'mineradio.keystore', '.mobileprovision', '.p12', '.apk', '.node', '.exe', '.pyd')
        if any(name.lower().endswith(forbidden) for name in names):
            raise ValueError('Unexpected desktop binary, credentials or provisioning input in unsigned IPA')
        return dict(archiveValid=True, arm64=True, iPhone=True, iPad=True, signed=False, deviceValidated=False)


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1])), indent=2))
