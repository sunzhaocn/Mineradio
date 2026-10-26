"""Host checks for protocol equivalence, embedded routes and native export data.

These checks intentionally do not claim to validate WebKit or iOS hardware.
"""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
APP = PROJECT / 'src/mineradio'
sys.path[:0] = [str(PROJECT / 'src'), str(APP / 'vendor'), str(APP / 'bundle/python')]
os.environ['MINERADIO_IOS'] = '1'
_data = tempfile.TemporaryDirectory()
os.environ['MINERADIO_ROOT'] = _data.name
os.environ['MINERADIO_RESOURCE_ROOT'] = str(APP / 'bundle')

from Crypto.Cipher import AES as ReferenceAES, PKCS1_v1_5 as ReferenceRSA
from Crypto.PublicKey import RSA as ReferenceKey
from music_app.ios_crypto import AES, RSA, PKCS1_v1_5
from mineradio.exports import ExportStore


class CryptoTests(unittest.TestCase):
    def test_nist_cbc_vector_and_streaming(self):
        key = bytes.fromhex('2b7e151628aed2a6abf7158809cf4f3c')
        iv = bytes.fromhex('000102030405060708090a0b0c0d0e0f')
        plain = bytes.fromhex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51')
        expected = bytes.fromhex('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2')
        cipher = AES.new(key, AES.MODE_CBC, iv)
        self.assertEqual(cipher.encrypt(plain[:16]) + cipher.encrypt(plain[16:]), expected)
        self.assertEqual(AES.new(key, AES.MODE_CBC, iv).decrypt(expected), plain)

    def test_all_key_sizes_match_existing_backend(self):
        for size in (16, 24, 32):
            for mode in (AES.MODE_CBC, AES.MODE_ECB):
                key, data = bytes(range(size)), bytes(range(128))
                options = {'iv': bytes(range(16))} if mode == AES.MODE_CBC else {}
                expected = ReferenceAES.new(key, mode, **options).encrypt(data)
                self.assertEqual(AES.new(key, mode, **options).encrypt(data), expected)
                self.assertEqual(AES.new(key, mode, **options).decrypt(expected), data)

    def test_reject_partial_blocks(self):
        with self.assertRaises(ValueError):
            AES.new(b'0'*16, AES.MODE_CBC, b'1'*16).encrypt(b'incomplete')

    def test_public_key_padding_interoperates(self):
        key = ReferenceKey.generate(1024)
        public = RSA.import_key(key.public_key().export_key())
        cipher = PKCS1_v1_5.new(public).encrypt(b'mineradio-ios-protocol')
        self.assertEqual(ReferenceRSA.new(key).decrypt(cipher, None), b'mineradio-ios-protocol')

    def test_netease_protocol_uses_embedded_crypto(self):
        from music_app.providers.netease.transport import ne__aes
        key, plain = b'0CoJUm6Qyw8W8jud', b'{"csrf_token":""}'
        padding = 16-len(plain)%16
        expected = ReferenceAES.new(key, ReferenceAES.MODE_CBC, b'0102030405060708').encrypt(plain+bytes([padding])*padding)
        self.assertEqual(base64.b64decode(ne__aes(plain, key)), expected)

    def test_qr_generation_without_pillow(self):
        import png
        from music_app.auth.router import _image
        image = base64.b64decode(_image('https://example.org/test').split(',', 1)[1])
        width, height, _, _ = png.Reader(bytes=image).read()
        self.assertEqual(width, height)
        from music_app.auth.qqmusic.mobile import _prepare_qr_image
        padded, url = _prepare_qr_image(image)
        new_width, new_height, _, _ = png.Reader(bytes=padded).read()
        self.assertEqual((new_width, new_height), (width+50, height+50))


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = ExportStore(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_roundtrip_and_path_confinement(self):
        data = bytes(range(256))*384
        token = self.store.begin('../../outside\\music.flac', len(data))
        for offset in range(0, len(data), self.store.MAX_CHUNK):
            self.store.append(token, offset, base64.b64encode(data[offset:offset+self.store.MAX_CHUNK]).decode())
        output = self.store.finish(token)
        self.assertEqual(output.read_bytes(), data)
        self.assertTrue(output.resolve().is_relative_to(Path(self.temporary.name).resolve()))
        self.store.remove(output)
        self.assertFalse(output.exists())

    def test_incomplete_and_replayed_chunks_rejected(self):
        token = self.store.begin('music.mp3', 6)
        self.store.append(token, 0, 'YWJj')
        with self.assertRaises(ValueError):
            self.store.append(token, 0, 'YWJj')
        with self.assertRaises(ValueError):
            self.store.finish(token)
        self.store.cancel(token)
        self.assertFalse(list(Path(self.temporary.name).rglob('*')))

    def test_limits(self):
        with self.assertRaises(ValueError):
            self.store.begin('huge', self.store.MAX_BYTES+1)
        token = self.store.begin('small', 1)
        with self.assertRaises(ValueError):
            self.store.append(token, 0, 'YWJj')
        self.store.cancel(token)


class EmbeddedServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from mineradio import backend
        cls.backend = backend
        cls.temporary = _data
        cls.port = backend.start(cls.temporary.name, api_port=0, web_port=0)
        cls.base = 'http://127.0.0.1:' + str(cls.port)

    @classmethod
    def tearDownClass(cls):
        cls.backend.stop()
        cls.temporary.cleanup()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=10) as response:
            return response.read()

    def test_phone_and_tablet_resources(self):
        phone = self.get('/?ios_layout=phone').decode()
        tablet = self.get('/?ios_layout=tablet').decode()
        self.assertIn('width=device-width', phone)
        self.assertIn('width=1100', tablet)
        self.assertIn('/ios-bridge.js', phone)
        self.assertNotIn('<!-- component:', phone)
        self.assertNotIn('webkitdirectory', phone)
        self.assertNotIn('fonts.googleapis.com', phone)
        self.assertIn(b'mineradioIOSReply', self.get('/ios-bridge.js'))

    def test_version_capabilities_and_signer(self):
        self.assertEqual(json.loads(self.get('/api/app/version'))['platform'], 'ios')
        caps = json.loads(self.get('/api/platform/capabilities'))
        self.assertFalse(caps['qishui']['available'])
        from music_app.providers.qishui.api import local_status
        self.assertFalse(local_status()['direct_playback'])
        from music_app.providers.qishui.client import signed_headers, QishuiError
        with self.assertRaises(QishuiError) as result:
            signed_headers('https://api.qishui.com/', {}, {})
        self.assertEqual(result.exception.code, 'qishui_signing_failed')

    def test_private_routes_reject_remote_origin(self):
        request = urllib.request.Request(self.base+'/api/local/profile?provider=netease',
                                         headers={'Origin': 'https://other.example'})
        with self.assertRaises(urllib.error.HTTPError) as result:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(result.exception.code, 403)
        result.exception.close()

    def test_health_is_device_local(self):
        self.assertEqual(json.loads(self.get('/__health'))['ok'], True)
        self.assertEqual(self.backend.start(self.temporary.name), self.port)


if __name__ == '__main__':
    unittest.main(verbosity=2)
