"""Run production Android download/validation code on the ordinary Java runtime."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AppUpdatePolicy(unittest.TestCase):
    @unittest.skipUnless(shutil.which('javac') and shutil.which('java'), 'JDK needed for Android updater checks')
    def test_release_origin_streaming_progress_and_integrity(self):
        with tempfile.TemporaryDirectory(prefix='mr-update-java-') as directory:
            target = Path(directory)
            production = ROOT / 'app/src/main/java/dev/mineradio/android'
            sources = [production / 'UpdatePolicy.java', production / 'UpdateTransfer.java',
                       ROOT / 'checks/UpdateTransferCheck.java']
            copied = [shutil.copyfile(source, target / source.name) for source in sources]
            compiled = subprocess.run(['javac', '-encoding', 'UTF-8', '-d', str(target), *map(str, copied)],
                                      capture_output=True, text=True, timeout=30)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            run = subprocess.run(['java', '-cp', str(target), 'dev.mineradio.android.UpdateTransferCheck'],
                                 capture_output=True, text=True, timeout=15)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('updater checks passed', run.stdout)


if __name__ == '__main__':
    unittest.main()
