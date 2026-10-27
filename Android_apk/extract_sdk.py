"""Import the known-compatible Qishui APK into a private, reproducible SDK bundle.

Only the native signer and original DEX files are copied. Account data is never
read. The complete DEX set preserves the existing adapter's dependencies; this
is not a claim that all of those classes form a minimal SDK.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = 'com.luna.music'
VERSION = '21.3.0'
VERSION_CODE = 100213030
APK_SHA256 = '1e4643ff6a1283dfee235700f0a1a6f996807cd49a5f6f4aa1449af409bb9097'
SIGNER_SHA256 = '6491ec50293dd3dee7a03b74800e09af118fdd0f008725d08b911f850b7d79f4'
NATIVE = 'lib/arm64-v8a/libmetasec_ml.so'
DEX_NAMES = tuple('classes' + (str(i) if i > 1 else '') + '.dex' for i in range(1, 22))
CONFIG_FIELDS = {'appId', 'license', 'clientType', 'collectMode', 'channel'}
MAX_ARTIFACT_SIZE = 128 * 1024 * 1024
REQUIRED_CLASSES = (
    'Lcom/bytedance/frameworks/baselib/network/http/NetworkParams;',
    'Lcom/luna/common/util/ContextUtil;',
    'Lcom/bytedance/mobsec/metasec/ml/MSConfig;',
    'Lcom/bytedance/mobsec/metasec/ml/MSConfig$Builder;',
    'Lcom/bytedance/mobsec/metasec/ml/MSManagerUtils;',
    'Lms/bd/c/i3;', 'Lms/bd/c/k3;', 'Lms/bd/c/v2;',
)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(path):
    if path.stat().st_size > 65536:
        raise ValueError('SDK configuration is oversized')
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(config, dict) or set(config) != CONFIG_FIELDS:
        raise ValueError('Config must contain only appId, license, clientType, collectMode and channel; never supply account cookies or tokens')
    for name in ('appId', 'license', 'channel'):
        value = config[name]
        if not isinstance(value, str) or not value or len(value) > 8192 or any(ord(c) < 32 for c in value):
            raise ValueError('Invalid SDK text field: ' + name)
    for name in ('clientType', 'collectMode'):
        if type(config[name]) is not int or not 0 <= config[name] <= 2147483647:
            raise ValueError('Invalid SDK numeric field: ' + name)
    return config


def dex_classes(data):
    """Read defined classes, not incidental class-name strings or references."""
    if len(data) < 112 or not re.fullmatch(rb'dex\n[0-9]{3}\x00', data[:8]):
        raise ValueError('Invalid DEX header')
    if struct.unpack_from('<III', data, 32) != (len(data), 112, 0x12345678):
        raise ValueError('Invalid DEX size, header size or byte order')
    strings, string_offset, types, type_offset = struct.unpack_from('<4I', data, 56)
    classes, class_offset = struct.unpack_from('<2I', data, 96)
    for count, offset, width in ((strings, string_offset, 4), (types, type_offset, 4),
                                 (classes, class_offset, 32)):
        if (count and offset < 112) or offset + count * width > len(data):
            raise ValueError('DEX table is outside the file')
    result = set()
    for index in range(classes):
        type_index = struct.unpack_from('<I', data, class_offset + index * 32)[0]
        if type_index >= types:
            raise ValueError('Invalid DEX class type index')
        string_index = struct.unpack_from('<I', data, type_offset + type_index * 4)[0]
        if string_index >= strings:
            raise ValueError('Invalid DEX descriptor string index')
        pos = struct.unpack_from('<I', data, string_offset + string_index * 4)[0]
        for _ in range(5):
            if pos >= len(data):
                raise ValueError('Truncated DEX string length')
            byte = data[pos]
            pos += 1
            if not byte & 128:
                break
        else:
            raise ValueError('Invalid DEX string length')
        end = data.find(b'\0', pos, min(pos + 16384, len(data)))
        if end < 0:
            raise ValueError('Unterminated DEX class descriptor')
        # Required adapter names are ASCII. Other MUTF-8 class names need not be
        # decoded to establish whether these exact definitions exist.
        result.add(data[pos:end])
    return result


def extract_sdk(apk_path, config_path, output_path):
    apk = Path(apk_path).resolve(strict=True)
    config = load_config(Path(config_path).resolve(strict=True))
    output = Path(output_path).resolve()
    if output.exists():
        raise ValueError('Output must be a new directory; existing files are never replaced')
    if output.is_relative_to(ROOT) and not any(output.is_relative_to(path) for path in
                                             (ROOT / 'runtime', ROOT / 'Android_apk/.local')):
        raise ValueError('Inside the repository, private SDK output must stay in runtime/ or Android_apk/.local/')
    if apk.stat().st_size > 512 * 1024 * 1024 or sha256(apk) != APK_SHA256:
        raise ValueError('Unsupported APK: this adapter is verified only for the pinned Qishui 21.3.0 artifact; do not bypass the digest check for another release')

    manifest = {'schemaVersion': 1,
                'source': f'{PACKAGE} {VERSION} ({VERSION_CODE}); APK SHA-256 {APK_SHA256}',
                'config': config, 'native': [], 'dex': []}
    class_locations = {}
    with zipfile.ZipFile(apk) as archive:
        members = archive.namelist()
        if len(set(members)) != len(members):
            raise ValueError('APK contains duplicate ZIP members')
        if {name for name in members if re.fullmatch(r'classes(?:[2-9]|[1-9][0-9]+)?\.dex', name)} != set(DEX_NAMES):
            raise ValueError('APK DEX inventory does not match the compatible profile')
        for name in (NATIVE, *DEX_NAMES):
            if not 1 <= archive.getinfo(name).file_size <= MAX_ARTIFACT_SIZE:
                raise ValueError('APK artifact is empty or oversized: ' + name)
            data = archive.read(name)
            if name == NATIVE:
                if data[:6] != b'\x7fELF\x02\x01' or data[18:20] != b'\xb7\x00':
                    raise ValueError('SDK native library must be ARM64 little-endian ELF')
                kind, relative = 'native', 'native/libmetasec_ml.so'
            else:
                definitions = dex_classes(data)
                for required in REQUIRED_CLASSES:
                    if required.encode('ascii') in definitions:
                        if required in class_locations:
                            raise ValueError('Required SDK class has duplicate definitions')
                        class_locations[required] = name
                kind, relative = 'dex', 'dex/' + name
            manifest[kind].append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest()})
        missing = sorted(set(REQUIRED_CLASSES) - class_locations.keys())
        if missing:
            raise ValueError('APK lacks required adapter class definitions: ' + ', '.join(missing))

        # Validate all inputs before creating output. Explicit members and fixed
        # destination names prevent ZIP paths from becoming filesystem paths.
        output.mkdir(parents=True, exist_ok=False)
        for kind, names in (('native', (NATIVE,)), ('dex', DEX_NAMES)):
            for name, item in zip(names, manifest[kind]):
                target = output / item['path']
                target.parent.mkdir(exist_ok=True)
                data = archive.read(name)
                if hashlib.sha256(data).hexdigest() != item['sha256']:
                    raise ValueError('APK changed while importing; discard the incomplete output')
                target.write_bytes(data)

    provenance = {
        'package': PACKAGE, 'versionName': VERSION, 'versionCode': VERSION_CODE,
        'apkSha256': APK_SHA256,
        'signature': {'status': 'matches-known-verified-apk', 'certificateSha256': SIGNER_SHA256,
                      'verification': 'Pinned source APK passed Android apksigner 35.0.0 verification; importer verifies the exact APK digest, not its signature again.'},
        'requiredClassDefinitions': class_locations,
        'dexPolicy': 'All 21 original DEX files retained unchanged for compatibility; minimal dependency closure is not proven.',
        'scope': 'One ARM64 native library and original DEX files only. No app resources, user data or account state extracted.',
        'limits': 'Static compatibility checks do not prove successful SDK initialization, login or playback on a device.',
    }
    (output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    (output / 'sdk-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', required=True, help='Local, unmodified Qishui 21.3.0 base APK')
    parser.add_argument('--config', required=True, help='Explicit SDK-only JSON configuration (never account state)')
    parser.add_argument('--output', required=True, help='New private bundle directory, excluded from version control')
    args = parser.parse_args()
    try:
        output = extract_sdk(args.apk, args.config, args.output)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print('SDK import failed: ' + str(error), file=sys.stderr)
        return 1
    print(f'Imported compatible SDK bundle (1 ARM64 library, {len(DEX_NAMES)} original DEX files).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
