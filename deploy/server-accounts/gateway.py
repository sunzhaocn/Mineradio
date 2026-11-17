"""Manage server accounts and return them to authorized Mineradio devices."""
from base64 import b64encode
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit

from music_app.core import request_credentials
from music_app.core import server_accounts as api
from music_app.web import auth_data

ASSETS = Path(__file__).resolve().parent
LISTEN_PORT = 18883
STATE = Path('/var/lib/mineradio-accounts')
FILES = {
    '': ('index.html', 'text/html; charset=utf-8'),
    'accounts.js': ('accounts.js', 'text/javascript; charset=utf-8'),
}
PROVIDERS = auth_data.PROVIDERS


class AccountStore:
    def __init__(self, directory):
        self.path = directory / 'accounts.json'
        self.lock = threading.Lock()

    def _read(self):
        try:
            with self.path.open(encoding='utf-8') as source:
                return request_credentials.normalize(json.load(source)), str(self.path.stat().st_mtime_ns)
        except FileNotFoundError:
            return {}, 'empty'

    def read(self):
        with self.lock:
            return self._read()

    def save(self, provider, entry):
        with self.lock:
            data, _ = self._read()
            key = PROVIDERS[provider]
            if entry is None:
                data.pop(key, None)
            else:
                normalized = request_credentials.normalize({key: entry})
                value = normalized.get(key)
                if not value or not auth_data._configured_cookie(provider, value['cookie']):
                    raise ValueError('Cookie 缺少此平台的登录字段')
                data.update(normalized)
            encoded = json.dumps(data, ensure_ascii=True, separators=(',', ':')).encode('ascii')
            if len(encoded) > api.MAX_BODY - 1024:
                raise ValueError('账号资料总长度超出服务器限制')
            auth_data._atomic_write(self.path, encoded)


class Gateway(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(12)

    def log_message(self, *_args):
        pass

    def reply(self, code, body, content_type, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "
                         "connect-src 'self'; frame-ancestors 'none'; form-action 'self'")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        if self.close_connection:
            self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)

    def json(self, code, data, extra=None):
        body = json.dumps(data, ensure_ascii=True, separators=(',', ':')).encode('utf-8')
        self.reply(code, body, 'application/json; charset=utf-8', extra)

    def authorized(self, administrator):
        expected = self.server.admin_header if administrator else self.server.device_header
        if hmac.compare_digest(self.headers.get('Authorization', '').encode('utf-8'), expected):
            return True
        self.close_connection = True
        extra = {'WWW-Authenticate': 'Basic realm="Mineradio Server Accounts", charset="UTF-8"'} if administrator else None
        self.json(401, {'error': 'auth_required', 'message': '需要 Mineradio 服务器授权。'}, extra)
        return False

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        try:
            parsed = urlsplit(self.path)
            if parsed.path.startswith(api.ADMIN):
                if self.authorized(administrator=True):
                    self.admin(parsed.path[len(api.ADMIN):])
            elif parsed.path == api.CREDENTIALS and not parsed.query and self.command == 'GET':
                if self.authorized(administrator=False):
                    entries, revision = self.server.store.read()
                    self.json(200, {'credentials': entries, 'revision': revision})
            else:
                self.close_connection = True
                self.json(404, {'error': 'route_missing'})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except ValueError as error:
            self.close_connection = True
            self.json(400, {'error': 'invalid_request', 'message': str(error)})
        except OSError:
            self.close_connection = True
            self.json(503, {'error': 'service_unavailable', 'message': '服务器账号资料暂时无法读取。'})

    def read_form(self):
        lengths = self.headers.get_all('Content-Length', [])
        if (self.headers.get_content_type() != 'application/json' or self.headers.get('Transfer-Encoding')
                or len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,5}', lengths[0])):
            raise ValueError('请提交有效的 JSON 请求')
        length = int(lengths[0])
        if not 1 <= length <= api.MAX_BODY:
            raise ValueError('请求内容过长')
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw) if len(raw) == length else None
        except (UnicodeError, RecursionError, json.JSONDecodeError):
            raise ValueError('服务器账号表单格式无效') from None
        if not isinstance(data, dict):
            raise ValueError('请选择音乐平台')
        return data

    def admin(self, path):
        if self.command == 'GET':
            if path in FILES:
                name, mime = FILES[path]
                return self.reply(200, (ASSETS / name).read_bytes(), mime)
            if path == 'api/accounts':
                entries, _ = self.server.store.read()
                return self.json(200, {provider: {'configured': key in entries} for provider, key in PROVIDERS.items()})
            if path == 'api/device-key':
                return self.reply(200, self.server.device_key.encode('ascii') + b'\n', 'application/octet-stream',
                                  {'Content-Disposition': 'attachment; filename="' + api.KEY_FILE + '"'})
        if self.command != 'POST' or path not in ('api/save', 'api/remove'):
            self.close_connection = True
            return self.json(404, {'error': 'route_missing'})
        if self.headers.get('Origin') != api.PUBLIC_ORIGIN:
            self.close_connection = True
            return self.json(403, {'error': 'origin_forbidden'})
        data = self.read_form()
        provider = data.get('provider')
        if not isinstance(provider, str) or provider not in PROVIDERS:
            raise ValueError('请选择音乐平台')
        entry = None
        if path == 'api/save':
            entry = {'cookie': data.get('cookie', '')}
            if provider == 'qishui' and data.get('device_id'):
                ids = {name: data.get(name, '') for name in ('device_id', 'install_id')}
                if not all(isinstance(value, str) and re.fullmatch(r'[0-9]{0,25}', value) for value in ids.values()):
                    raise ValueError('设备 ID 与安装 ID 应使用数字')
                entry['session_config'] = {'query': {key: value for key, value in ids.items() if value}}
        self.server.store.save(provider, entry)
        return self.json(200, {'ok': True})


def main():
    admin = (STATE / 'admin-password').read_text(encoding='ascii').strip()
    device = (STATE / api.KEY_FILE).read_text(encoding='ascii').strip()
    if len(admin) < 24 or not api.KEY_PATTERN.fullmatch(device):
        raise ValueError('Missing Mineradio account gateway keys')
    with ThreadingHTTPServer(('127.0.0.1', LISTEN_PORT), Gateway) as server:
        server.store = AccountStore(STATE)
        server.admin_header = b'Basic ' + b64encode(('mineradio:' + admin).encode('ascii'))
        server.device_key = device
        server.device_header = ('Bearer ' + device).encode('ascii')
        server.serve_forever()


if __name__ == '__main__':
    main()
