"""Embedded OpenSSL keeps CA and hostname verification enabled."""
import http.server
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'src'))
sys.path.insert(0, str(PROJECT / 'src/mineradio/vendor'))
from mineradio import tls


class PrivateTrust(unittest.TestCase):
    def test_bundled_roots_replace_an_unusable_environment_without_disabling_verification(self):
        import certifi
        with tempfile.TemporaryDirectory() as directory:
            # Match the ASCII App-container paths used on iOS. OpenSSL's
            # Windows environment reader cannot open our Unicode checkout path.
            bundle = Path(directory) / 'cacert.pem'
            shutil.copyfile(certifi.where(), bundle)
            with patch.dict(os.environ, {'SSL_CERT_FILE': 'missing-app-cert.pem'}), patch.object(tls, '_installed', None), patch.object(certifi, 'where', return_value=str(bundle)):
                result = tls.install()
                context = ssl.create_default_context()
                self.assertTrue(result['ready'])
                self.assertGreaterEqual(context.cert_store_stats()['x509_ca'], 100)
                self.assertTrue(context.check_hostname)
                self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
                self.assertTrue(Path(os.environ['SSL_CERT_FILE']).is_file())

    @unittest.skipUnless(shutil.which('openssl'), 'OpenSSL CLI needed to create a one-use test server')
    def test_an_untrusted_local_tls_server_is_still_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            certificate = Path(directory) / 'server.crt'
            key = Path(directory) / 'server.key'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-subj', '/CN=localhost', '-keyout', str(key), '-out', str(certificate)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass
            server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(certificate), str(key))
            server.socket = context.wrap_socket(server.socket, server_side=True)
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            try:
                with patch.dict(os.environ), patch.object(tls, '_installed', None):
                    tls.install()
                    with self.assertRaises(urllib.error.URLError) as failure:
                        urllib.request.urlopen('https://localhost:' + str(server.server_port), timeout=3)
                    self.assertIsInstance(failure.exception.reason, ssl.SSLCertVerificationError)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
