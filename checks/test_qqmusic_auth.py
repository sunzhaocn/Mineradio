"""QQ Music login regressions using synthetic replies, never real accounts."""
import http.cookiejar
import io
import json
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from music_app.auth.qqmusic import adapter, extra, mobile


class QQMusicAuth(unittest.TestCase):
    def setUp(self):
        self.state = {"jar": http.cookiejar.CookieJar(), "uuid": "synthetic-qr",
                      "expires_at": time.time() + 60, "method": "wechat"}

    def qq_exchange(self, data):
        replies = [
            adapter._Response(302, {}, b""),
            adapter._Response(302, {"Location": "https://y.qq.com/portal/wx_redirect.html?code=synthetic-code"}, b""),
            adapter._Response(200, {}, json.dumps({"code": 0, "req": {"code": 0, "data": data}}).encode()),
        ]
        with patch.object(adapter, "_request", side_effect=replies), patch.object(adapter, "_cookie", return_value="synthetic-p-skey"):
            return adapter._authorize(self.state, "https://ssl.ptlogin2.graph.qq.com/check_sig?uin=123456&ptsigx=synthetic-ticket")

    def test_qq_rejects_non_string_music_key(self):
        for key in (True, 12345, {"unexpected": "object"}, ["unexpected-list"]):
            with self.subTest(key=key):
                with self.assertRaises(adapter.AuthError) as caught:
                    self.qq_exchange({"musicid": "123456", "musickey": key})
                self.assertEqual(caught.exception.code, "qqmusic_exchange_failed")
        self.assertNotIn("authorized", self.state)

    def test_qq_and_wechat_reject_cookie_control_characters(self):
        for key in ("key\x00suffix", "key\tsuffix", "key\x7fsuffix"):
            with self.subTest(flow="qq", key=key), self.assertRaises(adapter.AuthError):
                self.qq_exchange({"musicid": "123456", "musickey": key})
            with self.subTest(flow="wechat", key=key), self.assertRaises(adapter.AuthError):
                extra._authorized(self.state, adapter, {"musicid": "123456", "musickey": key}, 1)
        self.assertNotIn("authorized", self.state)

    def test_wechat_invalid_music_id_is_a_safe_auth_error(self):
        for identifier in ("²", "１２３４５", "0", "9" * 5000):
            with self.subTest(identifier=identifier[:20]):
                with self.assertRaises(adapter.AuthError) as caught:
                    extra._authorized(self.state, adapter, {"musicid": identifier, "musickey": "synthetic-key"}, 1)
                self.assertEqual(caught.exception.code, "qqmusic_music_credentials_missing")

    def test_valid_qq_and_wechat_credentials_keep_identity_and_login_type(self):
        data = {"musicid": 123456, "musickey": "synthetic-key", "nickname": "Fixture User",
                "openid": "synthetic-openid", "expired_at": 12345, "refresh_token": False}
        for login_type, exchange in ((2, self.qq_exchange), (1, lambda value: extra._authorized(self.state, adapter, value, 1))):
            with self.subTest(login_type=login_type):
                result = exchange(data)
                self.assertEqual(result["status"], "authorized")
                self.assertEqual(result["account"]["name"], "Fixture User")
                self.assertEqual(result["credentials"]["musicid"], "123456")
                self.assertEqual(result["credentials"]["login_type"], login_type)
                self.assertNotIn("refresh_token", result["credentials"])
                self.assertIn("tmeLoginType=" + str(login_type), result["cookie"])

    def test_wechat_pending_and_terminal_replies_do_not_require_login_code(self):
        for code, expected in ((408, "waiting"), (404, "scanned"), (402, "expired"), (403, "cancelled")):
            with self.subTest(code=code), patch.object(extra.urllib.request, "urlopen", return_value=io.BytesIO(f"window.wx_errcode={code};".encode())):
                self.assertEqual(extra.check_session(self.state, adapter)["status"], expected)

    def test_wechat_confirmation_requires_code(self):
        with patch.object(extra.urllib.request, "urlopen", return_value=io.BytesIO(b"window.wx_errcode=405;")):
            with self.assertRaises(adapter.AuthError):
                extra.check_session(self.state, adapter)
        self.assertNotIn("authorized", self.state)

    def test_wechat_exchange_retry_reuses_confirmed_ticket(self):
        first = io.BytesIO(b"window.wx_errcode=405; window.wx_code='synthetic-ticket';")
        failure = adapter.AuthError(502, "qqmusic_network_error", "Retry fixture")
        data = {"musicid": "123456", "musickey": "synthetic-key"}
        with patch.object(extra.urllib.request, "urlopen", return_value=first) as poll, patch.object(extra, "_cgi", side_effect=[failure, data]) as exchange:
            with self.assertRaises(adapter.AuthError):
                extra.check_session(self.state, adapter)
            result = extra.check_session(self.state, adapter)
            self.assertEqual(result["status"], "authorized")
            self.assertEqual(poll.call_count, 1)
            self.assertEqual(exchange.call_count, 2)
            self.assertEqual(exchange.call_args.args[3]["code"], "synthetic-ticket")

    def test_mobile_rejects_non_string_music_key(self):
        state = {"jar": http.cookiejar.CookieJar(), "mobile_stop": threading.Event()}
        with self.assertRaises(mobile.AuthError):
            mobile._authorized(state, {"musicid": "123456", "musickey": 12345})
        self.assertNotIn("authorized", state)

    def test_mobile_accepts_valid_wechat_credentials_and_stops_listener(self):
        state = {"jar": http.cookiejar.CookieJar(), "mobile_stop": threading.Event(),
                 "mobile_ticket": {"token": "synthetic-temporary-key"}}
        result = mobile._authorized(state, {"musicid": 123456, "musickey": "W_X_synthetic-key", "bindAccountType": 1})
        self.assertEqual(result["status"], "authorized")
        self.assertEqual(result["credentials"]["login_type"], 1)
        self.assertEqual(result["credentials"]["bindAccountType"], 1)
        self.assertIn("qqmusic_key=W_X_synthetic-key", result["cookie"])
        self.assertNotIn("mobile_ticket", state)
        self.assertTrue(state["mobile_stop"].is_set())

    def test_wechat_expiration_does_not_poll(self):
        self.state["expires_at"] = 0
        with patch.object(extra.urllib.request, "urlopen", side_effect=AssertionError("Expired QR must not poll")):
            self.assertEqual(extra.check_session(self.state, adapter)["status"], "expired")

    def test_wechat_connection_reset_returns_safe_auth_error(self):
        with patch.object(extra.urllib.request, "urlopen", side_effect=ConnectionResetError("Synthetic reset")):
            with self.assertRaises(adapter.AuthError) as caught:
                extra.check_session(self.state, adapter)
        self.assertEqual(caught.exception.code, "qqmusic_wechat_network_error")
        self.assertNotIn("Synthetic reset", str(caught.exception))

    def test_wechat_http_error_closes_response(self):
        body = io.BytesIO(b"synthetic upstream error")
        failure = extra.urllib.error.HTTPError("https://lp.open.weixin.qq.com/", 503, "Unavailable", {}, body)
        with patch.object(extra.urllib.request, "urlopen", side_effect=failure):
            with self.assertRaises(adapter.AuthError):
                extra.check_session(self.state, adapter)
        self.assertTrue(body.closed)

    def test_wechat_long_poll_timeout_remains_waiting(self):
        for failure in (TimeoutError(), extra.urllib.error.URLError(TimeoutError())):
            with self.subTest(failure=type(failure).__name__), patch.object(extra.urllib.request, "urlopen", side_effect=failure):
                self.assertEqual(extra.check_session(self.state, adapter)["status"], "waiting")

    def test_ios_missing_png_dependency_has_actionable_error(self):
        with patch("music_app.platform_runtime.is_ios", return_value=True), patch.dict(sys.modules, {"png": None}):
            with self.assertRaises(mobile.AuthError) as caught:
                mobile._prepare_qr_image(b"synthetic-png")
        self.assertEqual(caught.exception.code, "qqmusic_qr_image_dependency")


if __name__ == "__main__":
    unittest.main()
