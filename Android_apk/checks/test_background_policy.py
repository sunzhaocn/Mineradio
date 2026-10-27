"""Run the production service-start policy on the ordinary Java runtime."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BackgroundStartPolicy(unittest.TestCase):
    @unittest.skipUnless(shutil.which('javac') and shutil.which('java'), 'JDK needed for Android lifecycle policy check')
    def test_pending_start_reclamation_pause_and_retry(self):
        # The Android build uses an ASCII workspace too: Windows Java command
        # line decoding cannot reliably consume all Unicode checkout paths.
        with tempfile.TemporaryDirectory(prefix='mineradio-background-') as directory:
            target = Path(directory)
            files = [ROOT / 'app/src/main/java/dev/mineradio/android/PlaybackServiceGate.java',
                     ROOT / 'checks/PlaybackServiceGateCheck.java']
            copied = [shutil.copyfile(source, target / source.name) for source in files]
            result = subprocess.run(['javac', '-encoding', 'UTF-8', '-d', str(target), *map(str, copied)],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run(['java', '-cp', str(target), 'dev.mineradio.android.PlaybackServiceGateCheck'],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('10 lifecycle checks passed', result.stdout)


if __name__ == '__main__':
    unittest.main()
