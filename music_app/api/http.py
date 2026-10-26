"""HTTP 报文、跨域限制与登录正文校验。"""

import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler
from music_app.api import params as api_params
from music_app.api import router as api_router
from music_app.auth import router as auth_router
from music_app.paths import WEB_ROOT
from music_app.core import request_credentials
from music_app.core import request_lifecycle


class Handler(BaseHTTPRequestHandler):
    """HTTP 传输适配器；业务由 dispatch_request 处理，这里只处理报文、gzip、CORS 和断连。"""

    server_version = "musicapi/2.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        """将访问日志写到标准输出并及时刷新，便于在终端查看请求。"""
        path = urllib.parse.urlparse(getattr(self, "path", "")).path
        message = "%s %s %s" % (self.command, path, args[1] if len(args) > 1 else "")
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), message))
        sys.stdout.flush()

    def _login_origin(self):
        """扫码凭据只面向本机客户端与本机网页；与音乐资源的公开 CORS 分开。"""

        def local(host):
            return host in ("localhost", "127.0.0.1", "::1")

        try:
            host = urllib.parse.urlsplit("//" + self.headers.get("Host", "")).hostname
            origin = self.headers.get("Origin")
            if not local(self.client_address[0]) or not local(host):
                return False
            if origin:
                parsed = urllib.parse.urlsplit(origin)
                if (
                    parsed.scheme not in ("http", "https")
                    or not local(parsed.hostname)
                    or parsed.username
                    or parsed.password
                ):
                    return False
            return True
        except ValueError:
            return False

    def handle_one_request(self):
        """客户端提前断开很常见，别把它当异常打到 stderr。"""
        try:
            return BaseHTTPRequestHandler.handle_one_request(self)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def _send(self, code, obj, headers=None):
        """统一发送 JSON/字节响应；大于 512 字节且客户端接受时启用 gzip。

        Content-Length 必须按压缩后的字节数计算；headers 供重定向附加 Location。
        CORS 沿用旧配置；客户端提前断开时结束连接，避免重复写入。
        """
        request_lifecycle.check()
        raw = (
            obj
            if isinstance(obj, bytes)
            else json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )
        gz = len(raw) > 512 and "gzip" in (self.headers.get("Accept-Encoding") or "").lower()
        if gz:
            raw = gzip.compress(raw, 6)
        self.send_response(code)
        self.send_header(
            "Content-Type", (headers or {}).get("Content-Type", "application/json; charset=utf-8")
        )
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        is_login = bool(auth_router.route(urllib.parse.urlparse(self.path).path))
        if is_login:
            self.send_header("Cache-Control", "no-store")
            self.send_header("Pragma", "no-cache")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            if self._login_origin() and self.headers.get("Origin"):
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type" if is_login else "*")
        for k, v in (headers or {}).items():
            if k.lower() != "content-type":
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def do_OPTIONS(self):
        """响应浏览器跨域预检；204 不包含响应正文。"""
        if auth_router.route(urllib.parse.urlparse(self.path).path) and (not self._login_origin()):
            return self._send(
                403, {"code": "login_local_only", "msg": "扫码登录接口仅供本机客户端和本机网页调用"}
            )
        self._send(204, b"")

    def do_GET(self):
        """解析 URL → 调用业务路由 → 将 JSON 或 302 重定向写回客户端。"""
        request_url = urllib.parse.urlparse(self.path)
        params = api_params.RequestParams(request_url.query)
        try:
            credentials = request_credentials.parse_request(self.headers, params, 'qishui' if request_url.path == '/qishui/audio' else None)
        except ValueError:
            return self._send(400, {'code': 'request_credentials_invalid', 'msg': '请求凭据格式错误，请检查客户端登录资料'})
        if auth_router.route(request_url.path) and (not self._login_origin()):
            return self._send(
                403, {"code": "login_local_only", "msg": "扫码登录接口仅供本机客户端和本机网页调用"}
            )
        if request_url.path == "/qishui/audio":
            from music_app.providers.qishui.playback import serve_audio

            with request_credentials.bind(credentials):
                return serve_audio(self, params.one("id"), params.one("quality"))
        try:
            cancellable = not auth_router.route(request_url.path) and (params.flag('playback') or
                request_url.path in ('/lyric', '/album', '/album/detail', '/api/album'))
            with request_credentials.bind(credentials), request_lifecycle.api_read(getattr(self, 'connection', None),
                    self.headers.get(request_lifecycle.TICKET_HEADER, '') if cancellable else '', enabled=cancellable,
                    loopback=getattr(self, 'client_address', ('',))[0] in ('127.0.0.1', '::1')):
                status_code, body = api_router.dispatch_request(request_url.path, params, credentials=credentials)
        except request_lifecycle.RequestCancelled:
            self.close_connection = True
            return
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True
            return
        except (OSError, ValueError, TimeoutError):
            return self._send(502, {'error_code': 502, 'msg': '音乐平台返回异常，请稍后重试', 'songs': []})
        if status_code == 302:
            return self._send(302, b"", {"Location": body["_location"]})
        return self._send(status_code, body)

    def do_POST(self):
        """手机号登录只接受有界 JSON；口令、验证码和手机号不进入 URL 或日志。"""
        request_url = urllib.parse.urlparse(self.path)
        route = auth_router.route(request_url.path)

        def reject(status, code, message):
            self.close_connection = True
            return self._send(status, {"code": code, "msg": message})

        if not route or route[0] not in ("phone_session", "sms_send", "phone_login"):
            return reject(405, "login_method_invalid", "当前路径不支持 POST 登录")
        if not self._login_origin():
            return reject(403, "login_local_only", "登录接口仅供本机客户端和本机网页调用")
        if request_url.query:
            return reject(400, "login_body_required", "手机号和登录资料只能通过 JSON 请求体提交")
        if self.headers.get_content_type() != "application/json":
            return reject(415, "login_json_required", "请使用 application/json 请求体")
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1:
            return reject(400, "login_length_invalid", "请提供有效的 JSON 请求长度")
        try:
            if not re.fullmatch("[0-9]{1,8}", lengths[0]):
                raise ValueError
            length = int(lengths[0])
        except (ValueError, TypeError):
            return reject(400, "login_length_invalid", "请提供有效的 JSON 请求长度")
        if length < 2 or length > 8192:
            return reject(413, "login_body_size", "登录请求体大小应为 2 至 8192 字节")

        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError
                result[key] = value
            return result

        try:
            previous_timeout = self.connection.gettimeout()
            self.connection.settimeout(15)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError
            payload = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
        except (ValueError, UnicodeError, RecursionError, OSError):
            return reject(400, "login_json_invalid", "登录 JSON 格式错误，请检查后重试")
        finally:
            self.connection.settimeout(previous_timeout)
        status, body = api_router.dispatch_request(
            request_url.path, api_params.RequestParams(""), method="POST", payload=payload
        )
        return self._send(status, body)

    def do_HEAD(self):
        request_url = urllib.parse.urlparse(self.path)
        if request_url.path == "/qishui/audio":
            from music_app.providers.qishui.playback import serve_audio

            params = api_params.RequestParams(request_url.query)
            try:
                credentials = request_credentials.parse_request(self.headers, params, 'qishui')
            except ValueError:
                return self._send(400, {'code': 'request_credentials_invalid', 'msg': '请求凭据格式错误'})
            with request_credentials.bind(credentials):
                return serve_audio(self, params.one("id"), params.one("quality"), head=True)
        return self._send(405, b"")
