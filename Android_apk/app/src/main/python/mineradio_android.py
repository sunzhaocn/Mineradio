"""In-device launch adapter. No PC address, developer credentials or cloud backend."""
import json
import os
import threading
from pathlib import Path
import urllib.parse

_servers = []


def start(data_root):
    if _servers:
        return _servers[-1][1]
    root = Path(data_root)
    os.environ['MINERADIO_ROOT'] = str(root)
    os.environ['MINERADIO_ANDROID'] = '1'
    os.environ['MINERADIO_CLIENT_ASSET_INIT'] = '0'
    from music_app.paths import ensure_directories, WEB_ROOT
    ensure_directories()
    from music_app.api.server import create_server
    api = create_server('127.0.0.1', 18000)
    os.environ['MUSIC_API_BASE'] = 'http://127.0.0.1:' + str(api.server_address[1])
    from music_app.web.httpserver import Handler
    from music_app.web.templates import render_page
    from music_app.core.httpserver import ExclusiveThreadingHTTPServer

    class AndroidHandler(Handler):
        def _get(self):
            path = urllib.parse.urlsplit(self.path).path
            if path == '/api/app/version':
                from java import jclass
                return self.json({'version':str(jclass('dev.mineradio.android.BuildConfig').VERSION_NAME),'platform':'android'})
            if path.startswith('/__android/'):
                from java import jclass
                if not jclass('dev.mineradio.android.BuildConfig').DEBUG:
                    return self.json({'error': 'not_found'}, 404)
                from music_app.paths import CACHE_DIR
                if path == '/__android/library-state':
                    from music_app.core import request_credentials
                    from music_app.providers.kugou import library
                    try:
                        with request_credentials.bind(request_credentials.parse_request(self.headers,{},'kugou')):
                            result = library.catalog()
                        return self.json({'ok':True,'count':len(result['playlists'])})
                    except Exception as error:
                        return self.json({'ok':False,'type':type(error).__name__,
                            'upstreamCode':getattr(error,'upstream_code',None),
                            'message':str(error) if isinstance(error,(ValueError,OSError)) else ''})
                if path == '/__android/qq-prepare':
                    from music_app.providers.qqmusic.mobile_protocol import prepare
                    device, qimei, session = prepare(CACHE_DIR / 'debug-qq-device.json')
                    return self.json({'ok':bool(qimei.get('q36') and session.get('sid')),
                        'qimeiPresent':bool(qimei.get('q36')),'anonymousSessionPresent':bool(session.get('sid'))})
                if path == '/__android/search-shape':
                    from music_app.providers.qishui.client import request_json
                    data = request_json('search/track', {'q':'晴天','cursor':'0','search_id':'mineradio-diagnostic',
                        'search_method':'input','debug_params':'','from_search_id':'','search_scene':''})
                    def shape(value, depth=0):
                        if depth > 6: return type(value).__name__
                        if isinstance(value, dict): return {key:shape(child,depth+1) for key,child in value.items()}
                        if isinstance(value, list): return {'length':len(value),'examples':[shape(child,depth+1) for child in value[:1]]}
                        return value if isinstance(value, (int,bool)) or isinstance(value,str) and len(value)<32 else type(value).__name__
                    return self.json({'shape':shape(data)})
                output = CACHE_DIR / 'native-mux-test.m4a'
                if path == '/__android/codec-test':
                    from music_app.providers.qishui.media import decrypt_mp4
                    from music_app import platform_runtime
                    data = (WEB_ROOT / 'player/fixture/encrypted-test.m4a').read_bytes()
                    clear, codec = decrypt_mp4(data, bytes.fromhex('00112233445566778899aabbccddeeff'))
                    source = CACHE_DIR / 'native-mux-clear.part'
                    source.write_bytes(clear)
                    extension = platform_runtime.remux_audio(source, output)
                    return self.json({'ok': output.is_file(), 'codec': codec, 'extension': extension, 'bytes': output.stat().st_size})
                if path == '/__android/codec-result.m4a' and output.is_file():
                    return self.existing_file(output, 'native-mux-test.m4a')
                return self.json({'error': 'not_found'}, 404)
            return super()._get()

        def player_page(self, head=False):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            tablet = query.get('android_layout') == ['tablet']
            profile = 'tablet' if tablet else 'phone'
            try:
                width = max(320, min(880, int(query.get('width', ['420'])[0])))
            except ValueError:
                width = 420
            try:
                scale = max(1.0, min(4.0, float(query.get('scale', ['1'])[0])))
            except ValueError:
                scale = 1.0
            viewport = 'width=1100' if tablet else 'width=' + str(width) + ', initial-scale=' + str(scale) + ', viewport-fit=cover'
            page = render_page(WEB_ROOT / 'player').decode('utf-8')
            # Android's document picker selects individual audio/LRC files.
            page = page.replace('webkitdirectory directory multiple', 'multiple')
            page = page.replace('导入文件夹', '批量导入音频').replace('选择文件夹', '选择音频文件')
            page = page.replace('width=device-width, initial-scale=1.0, viewport-fit=cover', viewport)
            bootstrap = '<script>window.mineradioAndroidProfile=' + json.dumps(profile) + ';</script><script src="/android-bridge.js"></script>'
            page = page.replace('<script src="js/features/mobile/mobile-simple-mode.js">', bootstrap + '<script src="js/features/mobile/mobile-simple-mode.js">', 1)
            # Fonts are installed in the APK. Initial launch never depends on Google Fonts.
            import re
            page = re.sub(r'<link\s+href="https://fonts.googleapis.com/[^>]+>', '', page)
            raw = page.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            if not head:
                self.wfile.write(raw)

    web = ExclusiveThreadingHTTPServer(('127.0.0.1', 18080), AndroidHandler)
    for server in (api, web):
        threading.Thread(target=server.serve_forever, daemon=True, name='MineradioLocalServer').start()
        _servers.append((server, server.server_address[1]))
    return web.server_address[1]


def diagnostic():
    from music_app.api.status import health
    return json.dumps(health(), ensure_ascii=False)
