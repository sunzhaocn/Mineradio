"""Regression coverage for the locale failure observed on a physical iPad."""
import locale
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ENTRY = Path(__file__).resolve().parents[1] / 'src/mineradio/__main__.py'


class StartupTests(unittest.TestCase):
    def run_entry(self, setlocale, main):
        fake = types.ModuleType('mineradio.app')
        fake.main = main
        return patch.dict(sys.modules, {'mineradio.app': fake}), patch.object(locale, 'setlocale', side_effect=setlocale)

    def test_unsupported_device_locale_reaches_main_loop(self):
        calls = []

        def device_locale(category, name):
            if name == '' and os.environ.get('LC_ALL') != 'C':
                raise locale.Error('unsupported locale setting')
            return 'C'

        def create_app():
            locale.setlocale(locale.LC_ALL, '')  # The failing Toga constructor.
            return types.SimpleNamespace(main_loop=lambda: calls.append('running'))

        modules, native_locale = self.run_entry(device_locale, create_app)
        with tempfile.TemporaryDirectory() as folder, patch.object(Path, 'home', return_value=Path(folder)), patch.dict(os.environ, {'LC_ALL': 'unavailable-iPad-locale'}), modules, native_locale:
            runpy.run_path(str(ENTRY), run_name='__main__')
            self.assertEqual(calls, ['running'])
            self.assertEqual(os.environ['LC_ALL'], 'C')

    def test_valid_locale_is_retained(self):
        app = types.SimpleNamespace(main_loop=lambda: None)
        modules, native_locale = self.run_entry(lambda category, name: 'valid', lambda: app)
        with tempfile.TemporaryDirectory() as folder, patch.object(Path, 'home', return_value=Path(folder)), patch.dict(os.environ, {'LC_ALL': 'valid'}), modules, native_locale:
            runpy.run_path(str(ENTRY), run_name='__main__')
            self.assertEqual(os.environ['LC_ALL'], 'valid')

    def test_early_constructor_failure_remains_diagnosable(self):
        def fail():
            raise RuntimeError('constructor regression probe')

        modules, native_locale = self.run_entry(lambda category, name: 'C', fail)
        with tempfile.TemporaryDirectory() as folder, patch.object(Path, 'home', return_value=Path(folder)), modules, native_locale:
            with self.assertRaisesRegex(RuntimeError, 'constructor regression probe'):
                runpy.run_path(str(ENTRY), run_name='__main__')
            report = (Path(folder) / 'Documents/Mineradio-startup-diagnostic.txt').read_text()
            self.assertIn('Stage: create application', report)
            self.assertIn('RuntimeError: constructor regression probe', report)


if __name__ == '__main__':
    unittest.main()
