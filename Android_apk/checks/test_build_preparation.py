"""Verify SDK import boundaries and repeatable source staging without accounts."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'prepare.py'
spec = importlib.util.spec_from_file_location('android_prepare', SCRIPT)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def make_sdk(root):
    root.mkdir()
    native = root / 'libmetasec_ml.so'
    data = bytearray(64)
    data[:6] = b'\x7fELF\x02\x01'
    data[18:20] = b'\xb7\x00'
    native.write_bytes(data)
    dex = root / 'classes.dex'
    dex.write_bytes(b'dex\n035\x00' + bytes(64))
    manifest = {'schemaVersion': 1, 'source': 'synthetic fixture, not a real SDK',
                'config': dict(appId='fixture', license='synthetic', clientType=1, collectMode=1, channel='fixture'),
                'native': [{'path': native.name, 'sha256': prepare.sha256(native)}],
                'dex': [{'path': dex.name, 'sha256': prepare.sha256(dex)}]}
    (root / 'sdk-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    return manifest


class SDKValidation(unittest.TestCase):
    def test_missing_sdk_fails_before_staging_or_silent_capability_downgrade(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            target = Path(directory) / 'not-created'
            with self.assertRaisesRegex(ValueError, 'Full Qishui support requires'):
                prepare.prepare(target)
            self.assertFalse(target.exists())

    def test_valid_bundle_uses_only_explicit_config_and_hashed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'sdk'
            make_sdk(root)
            result = prepare.load_sdk(root)
            self.assertTrue(result['config']['configured'])
            self.assertEqual(len(result['native']), 1)
            self.assertEqual(len(result['dex']), 1)

    def test_tampered_artifact_and_extra_account_config_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'sdk'
            manifest = make_sdk(root)
            (root / 'classes.dex').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                prepare.load_sdk(root)
            manifest['config']['cookie'] = 'synthetic-cookie'
            (root / 'sdk-manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'config must contain only'):
                prepare.load_sdk(root)

    def test_manifest_cannot_read_outside_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'sdk'
            manifest = make_sdk(root)
            outside = Path(directory) / 'outside.dex'
            outside.write_bytes((root / 'classes.dex').read_bytes())
            manifest['dex'][0]['path'] = '../outside.dex'
            (root / 'sdk-manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'escaped'):
                prepare.load_sdk(root)

    def test_wrong_architecture_is_rejected_even_with_matching_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'sdk'
            manifest = make_sdk(root)
            path = root / 'libmetasec_ml.so'
            raw = bytearray(path.read_bytes())
            raw[18:20] = b'\x3e\x00'
            path.write_bytes(raw)
            manifest['native'][0]['sha256'] = prepare.sha256(path)
            (root / 'sdk-manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'ARM64'):
                prepare.load_sdk(root)


class WorkspaceSafety(unittest.TestCase):
    def test_unmanaged_existing_directory_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            sentinel = target / 'keep.txt'
            sentinel.write_text('user data')
            with self.assertRaisesRegex(ValueError, 'unmanaged'):
                prepare.workspace(target)
            self.assertEqual(sentinel.read_text(), 'user data')

    def test_generated_cleanup_cannot_escape_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = prepare.workspace(root / 'build')
            sentinel = root / 'keep.txt'
            sentinel.write_text('user data')
            with self.assertRaisesRegex(ValueError, 'escaped'):
                prepare.remove_generated(target, '../keep.txt')
            self.assertTrue(sentinel.exists())

    def test_repeated_staging_removes_stale_sources_assets_and_debug_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sdk = root / 'sdk'
            make_sdk(sdk)
            source_root = root / 'repository'
            source = source_root / 'Android_apk'
            files = ('settings.gradle', 'build.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat',
                     'gradle/wrapper/gradle-wrapper.properties', 'app/build.gradle',
                     'app/src/main/AndroidManifest.xml', 'app/src/main/java/old.java',
                     'app/src/main/res/old.xml', 'app/src/main/python/entry.py',
                     'app/src/main/assets/android-bridge.js', 'app/src/debug/old-debug.java')
            for name in files:
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture')
            for name in ('music_app/old.py', 'web/player/index.html', 'third_party/LICENSE'):
                path = source_root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture')
            (source_root / 'web/player/offline-assets.js').write_text('self.MINERADIO_OFFLINE = {"paths":[],"revision":"old"};')
            (source_root / 'web/player/service-worker.js').write_text('legacy worker')
            offline_loader = source_root / 'web/player/js/features/shell/offline-shell.js'
            offline_loader.parent.mkdir(parents=True)
            offline_loader.write_text('legacy offline loader')
            target = root / 'build'
            with patch.object(prepare, 'SOURCE', source), patch.object(prepare, 'ROOT', source_root), \
                    patch.object(prepare, 'passport_assets', return_value={'security_seed.html': b'fixture'}):
                first = prepare.prepare(target, sdk)
                (source / 'app/src/main/java/old.java').unlink()
                (source / 'app/src/main/res/old.xml').unlink()
                (source / 'app/src/debug/old-debug.java').unlink()
                (source_root / 'music_app/old.py').unlink()
                (source / 'app/src/main/assets/android-bridge.js').write_text('new bridge')
                second = prepare.prepare(target, sdk)
            for relative in ('app/src/main/java/old.java', 'app/src/main/res/old.xml',
                             'app/src/debug/old-debug.java', 'app/src/main/python/music_app/old.py'):
                self.assertFalse((target / relative).exists())
            self.assertTrue(json.loads((target / 'app/src/main/assets/bundle/sdk-config.json').read_text())['configured'])
            self.assertFalse(first['offlineShellCacheEnabled'])
            self.assertFalse(second['offlineShellCacheEnabled'])
            self.assertEqual((target / 'app/src/main/assets/bundle/web/player/android-bridge.js').read_text(), 'new bridge')
            self.assertFalse((target / 'app/src/main/assets/bundle/web/player/offline-assets.js').exists())
            self.assertFalse((target / 'app/src/main/assets/bundle/web/player/service-worker.js').exists())
            self.assertFalse((target / 'app/src/main/assets/bundle/web/player/js/features/shell/offline-shell.js').exists())

    def test_packaging_uses_max_dex_index_and_rejects_changed_staged_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sdk = root / 'sdk'
            make_sdk(sdk)
            target = prepare.workspace(root / 'build')
            (target / 'app/src/main/assets/bundle').mkdir(parents=True)
            prepare._stage_sdk(prepare.load_sdk(sdk), target)
            apk = target / 'app/build/outputs/apk/debug/app-debug.apk'
            apk.parent.mkdir(parents=True)
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('classes.dex', b'fixture')
                archive.writestr('classes3.dex', b'fixture')
            result = prepare.package('debug', target)
            with zipfile.ZipFile(result['unsignedApk']) as archive:
                self.assertEqual(archive.namelist(), ['classes.dex', 'classes3.dex', 'classes4.dex'])
            (target / 'sdk-artifacts/001.dex').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'changed since preparation'):
                prepare.package('debug', target)


if __name__ == '__main__':
    unittest.main()
