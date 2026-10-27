"""Exercise importer boundaries with synthetic DEX/ELF data, never private APKs."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'extract_sdk.py'
spec = importlib.util.spec_from_file_location('android_extract_sdk', SCRIPT)
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


def dex_fixture(descriptors=(), *, defined=True):
    count = len(descriptors)
    string_offset = 112
    type_offset = string_offset + count * 4
    class_offset = type_offset + count * 4
    data = bytearray(class_offset + (count * 32 if defined else 0))
    data[:8] = b'dex\n035\0'
    struct.pack_into('<4I', data, 56, count, string_offset, count, type_offset)
    struct.pack_into('<2I', data, 96, count if defined else 0, class_offset)
    for index, descriptor in enumerate(descriptors):
        encoded = descriptor.encode('ascii')
        assert len(encoded) < 128
        struct.pack_into('<I', data, string_offset + 4 * index, len(data))
        struct.pack_into('<I', data, type_offset + 4 * index, index)
        if defined:
            struct.pack_into('<I', data, class_offset + 32 * index, index)
        data.extend(bytes([len(encoded)]) + encoded + b'\0')
    struct.pack_into('<III', data, 32, len(data), 112, 0x12345678)
    return data


def inputs(root, *, definitions=True, machine=b'\xb7\0', extra_config=None):
    native = bytearray(64)
    native[:6] = b'\x7fELF\x02\x01'
    native[18:20] = machine
    apk = root / 'synthetic.apk'
    with zipfile.ZipFile(apk, 'w') as archive:
        archive.writestr(extract.NATIVE, native)
        for i, name in enumerate(extract.DEX_NAMES):
            archive.writestr(name, dex_fixture(extract.REQUIRED_CLASSES if i == 0 else (), defined=definitions))
        archive.writestr('assets/unrelated.bin', b'not needed')
        archive.writestr('../must-not-extract.txt', b'not needed')
    config = root / 'config.json'
    config.write_text(json.dumps(dict(appId='fixture', license='synthetic',
                                     clientType=1, collectMode=1, channel='fixture',
                                     **(extra_config or {}))), encoding='utf-8')
    return apk, config, root / 'bundle'


class ImportBoundaries(unittest.TestCase):
    def test_import_preserves_order_hashes_and_only_selected_members(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, config, output = inputs(Path(directory))
            with patch.object(extract, 'APK_SHA256', extract.sha256(apk)):
                extract.extract_sdk(apk, config, output)
            manifest = json.loads((output / 'sdk-manifest.json').read_text())
            self.assertEqual([x['path'] for x in manifest['dex']], ['dex/' + n for n in extract.DEX_NAMES])
            for item in manifest['native'] + manifest['dex']:
                self.assertEqual(extract.sha256(output / item['path']), item['sha256'])
            self.assertEqual(len(list(output.rglob('*.*'))), 24)
            self.assertFalse((output.parent / 'must-not-extract.txt').exists())
            provenance = json.loads((output / 'provenance.json').read_text())
            self.assertEqual(set(provenance['requiredClassDefinitions']), set(extract.REQUIRED_CLASSES))

    def test_unknown_apk_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, config, output = inputs(Path(directory))
            with self.assertRaisesRegex(ValueError, 'Unsupported APK'):
                extract.extract_sdk(apk, config, output)
            self.assertFalse(output.exists())

    def test_account_fields_rejected_without_echoing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, config, output = inputs(Path(directory), extra_config={'cookie': 'DO_NOT_ECHO'})
            with self.assertRaises(ValueError) as failure:
                extract.extract_sdk(apk, config, output)
            self.assertNotIn('DO_NOT_ECHO', str(failure.exception))
            self.assertFalse(output.exists())

    def test_references_without_definitions_do_not_pass_compatibility_check(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, config, output = inputs(Path(directory), definitions=False)
            with patch.object(extract, 'APK_SHA256', extract.sha256(apk)):
                with self.assertRaisesRegex(ValueError, 'lacks required adapter class definitions'):
                    extract.extract_sdk(apk, config, output)
            self.assertFalse(output.exists())

    def test_wrong_native_architecture_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, config, output = inputs(Path(directory), machine=b'\x3e\0')
            with patch.object(extract, 'APK_SHA256', extract.sha256(apk)):
                with self.assertRaisesRegex(ValueError, 'ARM64'):
                    extract.extract_sdk(apk, config, output)
            self.assertFalse(output.exists())

    def test_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            apk, config, output = inputs(Path(directory))
            output.mkdir()
            marker = output / 'keep.txt'
            marker.write_text('keep')
            with self.assertRaisesRegex(ValueError, 'new directory'):
                extract.extract_sdk(apk, config, output)
            self.assertEqual(marker.read_text(), 'keep')

    def test_public_repository_output_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            apk, config, output = inputs(root)
            with patch.object(extract, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'private SDK output'):
                    extract.extract_sdk(apk, config, output)
            self.assertFalse(output.exists())

    def test_dex_table_outside_file_rejected(self):
        data = dex_fixture(('Lexample/Fixture;',))
        struct.pack_into('<I', data, 100, len(data))
        with self.assertRaisesRegex(ValueError, 'outside the file'):
            extract.dex_classes(data)

    def test_dex_class_index_outside_type_table_rejected(self):
        data = dex_fixture(('Lexample/Fixture;',))
        offset = struct.unpack_from('<I', data, 100)[0]
        struct.pack_into('<I', data, offset, 50)
        with self.assertRaisesRegex(ValueError, 'class type index'):
            extract.dex_classes(data)


if __name__ == '__main__':
    unittest.main()
