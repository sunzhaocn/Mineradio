"""登录 HTTP 边界：本机同源检查与严格 JSON 请求解析。"""
import ipaddress
import json
import os
import re
from urllib.parse import urlsplit


class LocalAuthError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code

def _error(status=400, code='login_input_invalid', message='登录请求格式错误，请重新操作'):
    return LocalAuthError(status, code, message)

def assert_local_request(handler, *, allow_query=False):
    """仅同源本机请求可接触登录接口；拒绝远程、DNS 重绑定和跨站调用。"""
    try:
        if not ipaddress.ip_address(handler.client_address[0]).is_loopback:
            raise ValueError
        parsed = urlsplit(handler.path)
        if parsed.query and not allow_query:
            raise ValueError
        if len(handler.headers.get_all('Host', [])) != 1 or len(handler.headers.get_all('Origin', [])) > 1:
            raise ValueError
        host = handler.headers.get('Host', '')
        authority = urlsplit('http://' + host)
        public_origin = os.environ.get('MINERADIO_PUBLIC_ORIGIN', '').rstrip('/')
        if public_origin:
            public = urlsplit(public_origin)
            # Only a loopback reverse proxy may reach this branch. Never trust
            # X-Forwarded-Host supplied by an Internet client.
            if (public.scheme != 'https' or not public.hostname or public.path or
                    public.query or public.fragment or public.username or public.password):
                raise ValueError
            origin = handler.headers.get('Origin')
            if (host.lower() != public.netloc.lower() or
                    handler.headers.get('X-Forwarded-Proto') != 'https' or
                    origin is not None and origin != public_origin or
                    handler.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none')):
                raise ValueError
            return
        if (authority.hostname not in ('localhost', '127.0.0.1', '::1') or authority.path or
                authority.username or authority.password or authority.query or authority.fragment or
                authority.port != handler.server.server_address[1]):
            raise ValueError
        origin = handler.headers.get('Origin')
        if origin:
            parsed_origin = urlsplit(origin)
            if (parsed_origin.scheme != 'http' or parsed_origin.netloc.lower() != authority.netloc.lower() or
                    parsed_origin.path or parsed_origin.query or parsed_origin.fragment):
                raise ValueError
        if handler.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise _error(403, 'login_local_only', '登录功能仅允许本机同源页面访问') from None

def read_json_request(handler):
    if handler.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
        raise _error(415, 'login_json_required', '登录请求须使用 JSON')
    if handler.headers.get('Transfer-Encoding'):
        raise _error()
    lengths = handler.headers.get_all('Content-Length', [])
    if len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,5}', lengths[0]):
        raise _error()
    length = int(lengths[0])
    maximum = 65536 if urlsplit(handler.path).path.startswith('/api/library/') else 8192
    if not 1 <= length <= maximum:
        raise _error(413, 'login_body_too_large', '登录请求内容过长')
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError
            result[key] = value
        return result
    timeout = handler.connection.gettimeout()
    try:
        handler.connection.settimeout(15)
        raw = handler.rfile.read(length)
        if len(raw) != length:
            raise ValueError
        payload = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                             parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
        if not isinstance(payload, dict):
            raise ValueError
    except (OSError, ValueError, UnicodeError, RecursionError):
        raise _error() from None
    finally:
        handler.connection.settimeout(timeout)
    return payload
