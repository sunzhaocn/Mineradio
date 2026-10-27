"""播放器内嵌 HTTP 服务；生命周期由客户端后端管理。"""
import json
import os
from http.server import SimpleHTTPRequestHandler
from music_app.core.httpserver import ExclusiveThreadingHTTPServer as ThreadingHTTPServer
import urllib.parse
from music_app.core import request_credentials
from music_app.core import request_lifecycle

from music_app.paths import WEB_ROOT
from .templates import render_page
from . import authbridge as _web_authbridge
from . import account_profiles as _web_account_profiles
from . import auth_data as _web_auth_data
from . import auth_security as _web_auth_security
from . import downloads as _web_downloads
from . import library as _web_library
from . import library_actions as _web_library_actions
from . import comments as _web_comments
from music_app.core.comments import CommentError
from . import media as _web_media
from . import router as _web_router
from . import client_assets as _web_client_assets


class Handler(_web_media.MediaMixin, SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT / 'player'), **kwargs)

    def log_message(self, fmt, *args):
        # 媒体 URL 可能携带临时鉴权参数，只记录路径，不写完整查询串。
        print(self.command, urllib.parse.urlsplit(self.path).path, flush=True)

    def json(self, data, status=200):
        request_lifecycle.check()
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if not parsed.path.startswith('/api/') or (parsed.path.startswith('/api/local/auth/') and parsed.path != '/api/local/auth/status'):
            return self._get()
        query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        provider = next((p for p in ('qq', 'kugou', 'qishui') if parsed.path.startswith('/api/' + p + '/')), query.get('provider') or query.get('platform') or 'netease')
        try:
            values = request_credentials.parse_request(self.headers, query, provider)
        except (ValueError, TypeError):
            return self.json(dict(error='cookie_input_invalid', message='请求的 Cookie 参数格式错误'), 400)
        cancellable = parsed.path.endswith(('/song/url', '/lyric', '/album/detail', '/song/comments')) or parsed.path == '/api/mv'
        with request_credentials.bind(values):
            try:
                with request_lifecycle.web_read(self.connection, enabled=cancellable):
                    return self._get()
            except request_lifecycle.RequestCancelled:
                self.close_connection = True

    def _get(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == '/__embedded_bootstrap':
            from .embedded import BOOTSTRAP_HTML
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(BOOTSTRAP_HTML)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
            self.end_headers()
            self.wfile.write(BOOTSTRAP_HTML)
            return
        if parsed.path in ('/', '/index.html'):
            return self.player_page()
        if parsed.path == '/__health':
            return self.json(dict(site='mineradio-local', ok=True))
        if parsed.path.startswith('/assets/platforms/'):
            provider = parsed.path.removeprefix('/assets/platforms/').removesuffix('.png')
            if provider in _web_media._image_cache.PLATFORM_ICONS and parsed.path.endswith('.png'):
                return self.missing_platform_icon(provider)
        if not parsed.path.startswith('/api/'):
            return super().do_GET()
        if parsed.path.startswith('/api/local/auth/') or parsed.path in _web_auth_data.STATUS_ROUTES:
            try:
                _web_auth_security.assert_local_request(self, allow_query=parsed.path in _web_auth_data.STATUS_ROUTES)
                if parsed.path == '/api/local/auth/status':
                    return self.json(_web_authbridge.AUTH.status())
                if parsed.path in _web_auth_data.STATUS_ROUTES:
                    return self.json(_web_authbridge.AUTH.status(_web_auth_data.STATUS_ROUTES[parsed.path]))
                return self.json(dict(error='login_route_missing', message='登录接口不存在'), 404)
            except _web_auth_security.LocalAuthError as error:
                return self.json(dict(error=error.code, message=str(error)), error.status)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        if parsed.path == '/api/local/account-status':
            try:
                _web_auth_security.assert_local_request(self, allow_query=True)
                from . import account_health
                if query.get('provider') not in account_health.PROVIDERS or set(query) - {'provider', 'force'}:
                    return self.json(dict(error='account_provider_invalid'), 400)
                return self.json(account_health.check(query['provider'], force=query.get('force') == '1'))
            except _web_auth_security.LocalAuthError as error:
                return self.json(dict(error=error.code, message=str(error)), error.status)
        if parsed.path == '/api/local/profile':
            try:
                _web_auth_security.assert_local_request(self, allow_query=True)
                if set(query) != {'provider'}:
                    raise ValueError('请选择有效的音乐平台')
                return self.json(_web_account_profiles.read(query['provider']))
            except _web_auth_security.LocalAuthError as error:
                return self.json(dict(error=error.code, message=str(error)), error.status)
            except Exception:
                return self.json(dict(error='account_profile_unavailable',
                    message='Cookie 已保留，昵称或头像暂时无法读取，请稍后重试'), 502)
        if _web_library.is_private_route(parsed.path):
            try:
                _web_auth_security.assert_local_request(self, allow_query=True)
            except _web_auth_security.LocalAuthError as error:
                return self.json(dict(ok=False, error=error.code, message=str(error)), error.status)
        try:
            if parsed.path == '/api/download':
                selected, error, status = _web_downloads.download_selection(query)
                if error:
                    return self.json(error, status)
                if 'path' in selected:
                    return self.existing_file(selected['path'], selected['filename'])
                return self.media(selected['url'], audio=True, attachment=selected['filename'])
            if parsed.path in ('/api/audio', '/api/cover'):
                return self.media(query.get('url', ''), parsed.path.endswith('/audio'))
            if parsed.path == '/api/video':
                from .mv import resolve
                video = resolve(query)
                if not video['available']:
                    return self.json(dict(error='mv_unavailable', message='当前歌曲暂无可用 MV'),404)
                return self.media(video['url'], video=True)
            return self.json(self.route(parsed.path, query))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except (OSError, ValueError, TimeoutError) as error:
            return self.json(dict(error='音乐服务暂时不可用', message=str(error), songs=[]), 502)

    def player_page(self, head=False):
        try:
            body = render_page(WEB_ROOT / 'player')
            if os.environ.get('MINERADIO_WEB_BUNDLE') == '1':
                body = body.replace(b'<script src="js/index-loader.js"></script>',
                    b'<script src="js/index-loader.js" data-bundle="js/player.bundle.js"></script>')
        except (OSError, ValueError, KeyError, TypeError):
            return self.json(dict(error='page_components_invalid', message='页面组件加载失败，请检查本地资源文件'), 500)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def do_HEAD(self):
        if urllib.parse.urlsplit(self.path).path in ('/', '/index.html'):
            return self.player_page(head=True)
        return super().do_HEAD()

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        try:
            if parsed.path == '/api/client/assets/check':
                _web_auth_security.assert_local_request(self)
                payload = _web_auth_security.read_json_request(self)
                provider = payload.get('provider', 'all')
                if provider not in ('all', 'qqmusic', *_web_client_assets.PROVIDERS):
                    return self.json(dict(ok=False, error='asset_provider_invalid'), 400)
                _web_client_assets.schedule(provider)
                return self.json(dict(ok=True))
            if parsed.path in _web_comments.LIKE_ROUTES:
                _web_auth_security.assert_local_request(self)
                provider = _web_comments.LIKE_ROUTES[parsed.path]
                payload = _web_auth_security.read_json_request(self)
                try:
                    values = request_credentials.parse_request(self.headers, {}, provider)
                except (ValueError, TypeError):
                    return self.json(dict(ok=False, error='cookie_input_invalid', message='平台凭据格式不正确'), 400)
                with request_credentials.bind(values):
                    return self.json(_web_comments.like(provider, payload))
            if parsed.path in _web_library_actions.POST_ROUTES:
                _web_auth_security.assert_local_request(self)
                payload = _web_auth_security.read_json_request(self)
                try:
                    values = request_credentials.parse_request(self.headers, {}, payload.get('provider'))
                except (ValueError, TypeError):
                    return self.json(dict(ok=False, error='cookie_input_invalid', message='平台凭据格式错误'), 400)
                with request_credentials.bind(values):
                    return self.json(_web_library_actions.dispatch(parsed.path, payload))
            if parsed.path not in _web_auth_data.POST_ROUTES:
                self.close_connection = True
                return self.json(dict(error='login_route_missing', message='接口不存在'), 404)
            _web_auth_security.assert_local_request(self)
            payload = _web_auth_security.read_json_request(self)
            return self.json(_web_authbridge.AUTH.handle(parsed.path.rsplit('/', 1)[-1], payload))
        except CommentError as error:
            return self.json(dict(ok=False, error=error.code, message=error.message), error.status)
        except _web_auth_security.LocalAuthError as error:
            self.close_connection = True
            return self.json(dict(error=error.code, message=str(error)), error.status)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception:
            self.close_connection = True
            return self.json(dict(error='login_unavailable', message='登录服务暂时不可用，请稍后重试'), 502)

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def route(self, path, query):
        return _web_router.dispatch(path, query)


def create_server(host='127.0.0.1', port=18080):
    """创建尚未开始监听循环的服务，便于统一启动和关闭。"""
    return ThreadingHTTPServer((host, port), Handler)


def serve(host='127.0.0.1', port=18080):
    """阻塞运行网页服务，不启动其他进程或打开浏览器。"""
    server = create_server(host, port)
    print(f'Mineradio: http://{host}:{server.server_address[1]}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
