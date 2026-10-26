"""Do not promote a signing-only probe when music reads or login pages fail."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from smoke_simulator import integration_check_errors


class ProbeGateTests(unittest.TestCase):
    def complete(self):
        return dict(media={'passed': True}, passport={'qrCreated': True}, signer={'signed': True},
                    officialLogin={name: {'pageLoaded': True} for name in ('netease', 'qq', 'kugou')},
                    guestAPI={name: {'accepted': True} for name in ('charts', 'search')})

    def test_signature_and_qr_cannot_mask_failed_or_missing_music_reads(self):
        probe = self.complete()
        probe['guestAPI'] = {'charts': {'accepted': False}}
        self.assertEqual(integration_check_errors(probe), ['qishui_charts', 'qishui_search'])

    def test_created_native_window_does_not_prove_a_loaded_official_page(self):
        probe = self.complete()
        probe['officialLogin']['qq'] = {'manualLogin': True, 'pageLoaded': False}
        self.assertEqual(integration_check_errors(probe), ['qq_official_page'])

    def test_all_actual_probe_results_are_required(self):
        self.assertEqual(integration_check_errors(self.complete()), [])
        self.assertEqual(len(integration_check_errors({})), 8)


if __name__ == '__main__':
    unittest.main()
