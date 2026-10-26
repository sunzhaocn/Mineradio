"""Embedded, in-process servers. Does not start child processes or a PC backend."""
import os
from pathlib import Path
import re
import sys
import threading
import urllib.parse

_servers = []
_lock = threading.Lock()


def start(data_root, bundle=None, *, api_port=18000, web_port=18080):
    with _lock:
        if _servers:
            return _servers[-1].server_address[1]
        bundle = Path(bundle or Path(__file__).parent / 'bundle').resolve(strict=True)
        sys.path.insert(0, str(bundle / 'python'))
        os.environ.update(MINERADIO_IOS='1', MINERADIO_ROOT=str(data_root),
                          MINERADIO_RESOURCE_ROOT=str(bundle),
                          MINERADIO_CLIENT_ASSET_INIT='0')
        from music_app.paths import ensure_directories
        ensure_directories()
        web_marker = Path(data_root) / 'runtime/cache/ios-web-loaded.json'
        web_marker.unlink(missing_ok=True)
        from music_app.api.server import create_server
        from .local_server import LocalHTTPServer
        api = create_server('127.0.0.1', api_port, server_class=LocalHTTPServer)
        os.environ['MUSIC_API_BASE'] = 'http://127.0.0.1:' + str(api.server_address[1])
        try:
            from music_app.web.httpserver import Handler
            from music_app.web.templates import render_page
            from music_app.paths import WEB_ROOT
            from music_app.web import constants
            constants.API = os.environ['MUSIC_API_BASE']
            constants.CHART_PROVIDERS = ('netease', 'qqmusic', 'kugou', 'qishui')

            class IOSHandler(Handler):
                def _get(self):
                    path = urllib.parse.urlsplit(self.path).path
                    if path == '/ios-bridge.js':
                        web_marker.write_text('{"webResourcesLoaded":true}', encoding='utf-8')
                    if path == '/api/app/version':
                        return self.json(dict(version='0.1.1', platform='ios',
                                              runtime='embedded-local', remoteBackendRequired=False))
                    if path == '/api/platform/capabilities':
                        data = self.route(path, {})
                        from music_app.providers.qishui.api import local_status
                        state = local_status()
                        data['qishui'].update(available=state['available'], reason=state['reason'],
                            signerReady=state['signer_ready'], activationRequired=not state['signer_initialized'],
                            phoneLoginAvailable=False)
                        return self.json(data)
                    return super()._get()

                def player_page(self, head=False):
                    query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    tablet = query.get('ios_layout') == ['tablet']
                    page = render_page(WEB_ROOT / 'player').decode('utf-8')
                    page = page.replace('webkitdirectory directory multiple', 'multiple')
                    page = page.replace('导入文件夹', '批量导入音频').replace('选择文件夹', '选择音频文件')
                    if tablet:
                        page = page.replace('width=device-width, initial-scale=1.0, viewport-fit=cover',
                            'width=1100, viewport-fit=cover')
                    bootstrap = '<script src="/ios-layout.js"></script><script src="/ios-bridge.js"></script><link rel="stylesheet" href="/ios.css">'
                    page = page.replace('<script src="js/features/mobile/mobile-simple-mode.js">',
                        bootstrap + '<script src="js/features/mobile/mobile-simple-mode.js">', 1)
                    page = re.sub(r'<link\s+href="https://fonts.googleapis.com/[^>]+>', '', page)
                    raw = page.encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(raw)))
                    self.end_headers()
                    if not head:
                        self.wfile.write(raw)

            web = LocalHTTPServer(('127.0.0.1', web_port), IOSHandler)
        except Exception:
            api.server_close()
            raise
        for server in (api, web):
            threading.Thread(target=server.serve_forever, daemon=True,
                             name='MineradioIOSLocalServer').start()
            _servers.append(server)
        return web.server_address[1]


def stop():
    with _lock:
        for server in reversed(_servers):
            server.shutdown()
        for server in reversed(_servers):
            server.close_connections()
        for server in reversed(_servers):
            server.server_close()
        _servers.clear()
