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


class WindowsWebRelease(unittest.TestCase):
    def test_embedded_ui_omits_offline_shell_and_replaces_stale_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            player = root / 'source/player'
            player.mkdir(parents=True)
            manifest = 'self.MINERADIO_OFFLINE = ' + json.dumps({'revision': 'legacy', 'paths': ['/', '/app.js']}) + ';\n'
            (player / 'offline-assets.js').write_text(manifest, encoding='utf-8')
            (player / 'service-worker.js').write_text('old worker', encoding='utf-8')
            (player / 'js/features/shell').mkdir(parents=True)
            (player / 'js/features/shell/offline-shell.js').write_text('old offline loader')
            (player / 'app.js').write_text('window.version=1;', encoding='utf-8')
            with patch.object(preparation, 'BUILD', root / 'build'):
                staged = preparation.prepare(root / 'source')
                self.assertFalse((staged / 'player/offline-assets.js').exists())
                self.assertFalse((staged / 'player/service-worker.js').exists())
                self.assertFalse((staged / 'player/js/features/shell/offline-shell.js').exists())
                (staged / 'player/obsolete.js').write_text('old', encoding='utf-8')
                (player / 'app.js').write_text('window.version=2;', encoding='utf-8')
                staged = preparation.prepare(root / 'source')
                self.assertEqual((staged / 'player/app.js').read_text(), 'window.version=2;')
                self.assertFalse((staged / 'player/obsolete.js').exists())
                self.assertFalse((staged / 'player/offline-assets.js').exists())
                self.assertFalse((staged / 'player/service-worker.js').exists())
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
