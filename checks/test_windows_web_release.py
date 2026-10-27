"""A new Windows install must replace old cached UI without touching user stores."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('windows_web_preparation', ROOT / 'Windows_exe/scripts/prepare-web.py')
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)
from iOS_ipa.web_release import verify


class WindowsWebRelease(unittest.TestCase):
    def test_changed_script_gets_new_offline_cache_and_removes_stale_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            player = root / 'source/player'
            player.mkdir(parents=True)
            manifest = 'self.MINERADIO_OFFLINE = ' + json.dumps({'revision': 'legacy', 'paths': ['/', '/app.js']}) + ';\n'
            (player / 'offline-assets.js').write_text(manifest, encoding='utf-8')
            (player / 'app.js').write_text('window.version=1;', encoding='utf-8')
            with patch.object(preparation, 'BUILD', root / 'build'):
                staged = preparation.prepare(root / 'source')
                revision1 = verify(staged / 'player', paths=())
                (staged / 'player/obsolete.js').write_text('old', encoding='utf-8')
                (player / 'app.js').write_text('window.version=2;', encoding='utf-8')
                staged = preparation.prepare(root / 'source')
                revision2 = verify(staged / 'player', paths=())
                self.assertNotEqual(revision1, revision2)
                self.assertFalse((staged / 'player/obsolete.js').exists())
                data = json.loads((staged / 'player/offline-assets.js').read_text().split(' = ', 1)[1].rstrip(';\n'))
                self.assertEqual(data['paths'], ['/', '/app.js'])
                self.assertEqual((player / 'offline-assets.js').read_text(), manifest)

    def test_unmanaged_staging_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'build/web-release'
            target.mkdir(parents=True)
            sentinel = target / 'keep.txt'
            sentinel.write_text('keep')
            with patch.object(preparation, 'BUILD', root / 'build'):
                with self.assertRaisesRegex(ValueError, 'unmanaged'):
                    preparation.prepare(root)
            self.assertEqual(sentinel.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
