"""Offline protocol/media equivalence; AVFoundation still needs an iOS run."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'iOS_ipa/src/mineradio/vendor'))
sys.path.insert(0, str(ROOT))

from Crypto.Cipher import AES as ReferenceAES
from music_app.ios_crypto import AES
from music_app.providers.qishui.media import cenc
from music_app.providers.qishui import media_ios
from tests.qishui.test_qishui_media import fixture


class CTRTests(unittest.TestCase):
    def test_nist_ctr_and_uneven_updates(self):
        key = bytes.fromhex('2b7e151628aed2a6abf7158809cf4f3c')
        initial = int('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff', 16)
        plain = bytes.fromhex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51')
        expected = bytes.fromhex('874d6191b620e3261bef6864990db6ce9806f66b7970fdff8617187bb9fffdff')
        cipher = AES.new(key, AES.MODE_CTR, nonce=b'', initial_value=initial)
        self.assertEqual(cipher.encrypt(plain[:3])+cipher.encrypt(plain[3:19])+cipher.encrypt(plain[19:]), expected)
        self.assertEqual(AES.new(key, AES.MODE_CTR, nonce=b'', initial_value=initial).decrypt(expected), plain)

    def test_ctr_matches_original_for_iv_widths_and_wrap(self):
        plain = bytes(range(251))*3
        for size in (16, 24, 32):
            for nonce in (b'', b'iv-eight', b'123456789012345'):
                limit = 1 << (8*(16-len(nonce)))
                for initial in (0, limit-2):
                    with self.subTest(key=size, nonce=len(nonce), initial=initial):
                        args = dict(nonce=nonce, initial_value=initial)
                        expected = ReferenceAES.new(bytes(range(size)), ReferenceAES.MODE_CTR, **args).encrypt(plain)
                        cipher = AES.new(bytes(range(size)), AES.MODE_CTR, **args)
                        self.assertEqual(cipher.encrypt(plain[:17])+cipher.encrypt(plain[17:]), expected)

    def test_cenc_ivs_and_subsamples_match_original_backend(self):
        for iv_size in (8, 16):
            for pairs in (None, [[(3, 8), (4, 22)], [(2, 3), (1, 17)]]):
                samples = [bytes(range(37)), bytes(range(23))]
                encrypted, key, expected = fixture(samples, iv_size=iv_size, pairs=pairs)
                with patch.object(cenc, '_AES', AES):
                    self.assertEqual(cenc.decrypt_mp4(encrypted, key), (expected, 'aac'))

    def test_rejects_invalid_counter_parameters(self):
        for options in (dict(nonce=b'0'*16), dict(initial_value=-1), dict(initial_value=1<<128),
                        dict(nonce=b'iv', initial_value=bytes(3))):
            with self.assertRaises(ValueError):
                AES.new(bytes(16), AES.MODE_CTR, **options)


class ContainerTests(unittest.TestCase):
    def test_aac_clear_metadata_preserves_layout_and_samples(self):
        encrypted, key, _ = fixture([bytes(range(37)), b'public fixture'])
        with patch.object(cenc, '_AES', AES):
            clear, _ = cenc.decrypt_mp4(encrypted, key)
        normalized = media_ios.clear_protection_metadata(clear)
        self.assertEqual(len(normalized), len(clear))
        _, _, tables, entry, children, ranges = media_ios.inspect_clear_mp4(normalized)
        self.assertNotIn(b'senc', {box.kind for box in tables})
        self.assertNotIn(b'sinf', {box.kind for box in children})
        self.assertEqual(entry.kind, b'mp4a')
        for start, end in ranges:
            self.assertEqual(normalized[start:end], clear[start:end])

    def test_encrypted_and_malformed_input_is_not_remuxed(self):
        encrypted, _, _ = fixture([b'public fixture'])
        with self.assertRaises(ValueError):
            media_ios.clear_protection_metadata(encrypted)
        with self.assertRaises(ValueError):
            media_ios.extract_clear_flac(b'not a media file')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is a host verification tool only')
    def test_real_encrypted_aac_decodes_identically(self):
        source = ROOT / 'Android_apk/app/src/debug/assets/bundle/web/player/fixture/encrypted-test.m4a'
        key = bytes.fromhex('00112233445566778899aabbccddeeff')
        with patch.object(cenc, '_AES', AES):
            clear, codec = cenc.decrypt_mp4(source.read_bytes(), key)
        self.assertEqual(codec, 'aac')
        with tempfile.TemporaryDirectory() as folder:
            normalized = Path(folder) / 'clear.m4a'
            normalized.write_bytes(media_ios.clear_protection_metadata(clear))
            original = subprocess.check_output(['ffmpeg', '-v', 'error', '-decryption_key', key.hex(),
                '-i', str(source), '-f', 's16le', '-acodec', 'pcm_s16le', '-'])
            actual = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(normalized),
                '-f', 's16le', '-acodec', 'pcm_s16le', '-'])
            self.assertGreater(len(actual), 0)
            self.assertEqual(actual, original)
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                '-of', 'json', str(normalized)], text=True))
            self.assertEqual(probe['streams'][0]['codec_name'], 'aac')

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg is a host verification tool only')
    def test_real_encrypted_flac_is_demuxed_without_transcoding(self):
        key = bytes.fromhex('00112233445566778899aabbccddeeff')
        source_filter = 'sine=frequency=440:sample_rate=48000:duration=1'
        with tempfile.TemporaryDirectory() as folder:
            encrypted = Path(folder) / 'encrypted.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', source_filter,
                '-c:a', 'flac', '-strict', '-2', '-encryption_scheme', 'cenc-aes-ctr',
                '-encryption_key', key.hex(), '-encryption_kid', '00'*16, str(encrypted)], check=True)
            with patch.object(cenc, '_AES', AES):
                clear, codec = cenc.decrypt_mp4(encrypted.read_bytes(), key)
            self.assertEqual(codec, 'flac')
            normalized = Path(folder) / 'clear.flac'
            normalized.write_bytes(media_ios.extract_clear_flac(clear))
            actual = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(normalized),
                '-f', 's16le', '-acodec', 'pcm_s16le', '-'])
            expected = subprocess.check_output(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', source_filter,
                '-f', 's16le', '-acodec', 'pcm_s16le', '-'])
            self.assertEqual(len(actual), 96000)
            self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
