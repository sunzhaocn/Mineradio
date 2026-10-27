"""Real Chromium migration of old UI caches; only synthetic user data is used."""
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
import threading
from urllib.parse import quote, urlsplit
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from music_app.web.httpserver import Handler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

OLD_WORKER = (ROOT / 'web/player/service-worker.js').read_bytes()
STANDALONE = (ROOT / 'web/player/js/features/shell/standalone.js').read_bytes()


class FixtureHandler(Handler):
    def log_message(self, *args):
        pass

    def send_bytes(self, data, content_type='application/javascript'):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _get(self):
        path = urlsplit(self.path).path
        if path == '/__embedded_bootstrap':
            return super()._get()
        if path == '/':
            return self.send_bytes(b'<!doctype html><script src="/js/features/shell/standalone.js"></script><script src="/app.js"></script>', 'text/html')
        if path == '/app.js':
            return self.send_bytes(('window.pageVersion=' + json.dumps(self.server.phase) + ';').encode())
        if path == '/js/features/shell/standalone.js':
            # An old client predates the new embedded guard.
            return self.send_bytes(b'' if self.server.phase == 'legacy' else STANDALONE)
        if path == '/other/worker.js':
            return self.send_bytes(b'self.addEventListener("install",()=>self.skipWaiting());')
        if self.server.phase == 'legacy':
            if path == '/service-worker.js':
                return self.send_bytes(OLD_WORKER)
            if path == '/offline-assets.js':
                return self.send_bytes(b'self.MINERADIO_OFFLINE = {"revision":"legacy-test","paths":["/","/app.js","/js/features/shell/standalone.js"]};')
        return self.json({'error': 'not_found'}, 404)


def run(platform, browser):
    server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
    server.phase = 'legacy'
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = 'http://127.0.0.1:' + str(server.server_address[1])
    context = browser.new_context()
    context.add_init_script('window.desktopWindow={isDesktop:true}' if platform == 'windows' else 'window.MineradioAndroid={}')
    context.add_cookies([dict(name='synthetic-session', value='keep', url=origin, httpOnly=True)])
    try:
        page = context.new_page()
        page.goto(origin)
        page.evaluate('''async()=>{await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;}''')
        page.wait_for_function('!!navigator.serviceWorker.controller')
        tone = BytesIO()
        with wave.open(tone, 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(struct.pack('<h', 0) * 16000)
        page.evaluate('''async(bytes)=>{
          localStorage.setItem('accounts','synthetic-account-state');
          localStorage.setItem('playlists','["synthetic-playlist"]');
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('mineradio-browser-local-music-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('tracks');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').put({audio:new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),lyric:'[00:00]saved lyrics'},'song');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
          const c=await caches.open('music-downloads');await c.put('/saved-audio',new Response('keep-audio-cache'));
          await navigator.serviceWorker.register('/other/worker.js',{scope:'/other/'});
        }''', list(tone.getvalue()))
        server.phase = 'installed'
        page.reload()
        assert page.evaluate('pageVersion') == 'legacy', 'Old shell cache was not reproduced'
        if platform == 'windows':
            page.goto(origin + '/__embedded_bootstrap')
            migration = page.evaluate('()=>window.mineradioEmbeddedCleanup')
            assert migration['removedRegistrations'] == 1 and migration['removedCaches'] == 1
            page.goto(origin + '/')
        else:
            page.goto(origin + '/__embedded_bootstrap?next=' + quote('/?android_layout=phone', safe=''))
            page.wait_for_url(origin + '/?android_layout=phone')
        page.wait_for_function('window.pageVersion==="installed"')
        result = page.evaluate('''async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('mineradio-browser-local-music-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          const song=await new Promise((resolve,reject)=>{const r=db.transaction('tracks').objectStore('tracks').get('song');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();
          window.savedAudio=new Audio(URL.createObjectURL(song.audio));await savedAudio.play();
          return {accounts:localStorage.getItem('accounts'),playlists:localStorage.getItem('playlists'),audioBytes:song.audio.size,lyric:song.lyric,caches:await caches.keys(),registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>r.scope),banner:!!document.getElementById('offline-status'),audioCache:await(await(await caches.open('music-downloads')).match('/saved-audio')).text()};
        }''')
        page.wait_for_function('savedAudio.currentTime>0.1')
        assert result['accounts'] == 'synthetic-account-state'
        assert result['playlists'] == '["synthetic-playlist"]'
        assert result['audioBytes'] == len(tone.getvalue()) and result['lyric'] == '[00:00]saved lyrics'
        assert result['caches'] == ['music-downloads'] and result['audioCache'] == 'keep-audio-cache'
        assert result['registrations'] == [origin + '/other/'] and not result['banner']
        assert any(c['name'] == 'synthetic-session' and c['value'] == 'keep' for c in context.cookies())
        # A subsequent page edit is visible without a revision or query change.
        server.phase = 'edited'
        page.reload()
        page.wait_for_function('window.pageVersion==="edited"')
        return dict(platform=platform, oldCacheReproduced=True, legacyShellRetired=True,
                    unrelatedWorkerAndCachePreserved=True, accountsPlaylistsCookiesPreserved=True,
                    localAudioAndLyricsPreserved=True, savedAudioPlayed=True,
                    editedPageLoadedWithoutCacheVersion=True, offlineBanner=False)
    finally:
        context.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        try:
            results = [run(platform, browser) for platform in ('windows', 'android')]
        finally:
            browser.close()
    output = ROOT / 'runtime/embedded-ui-retirement'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'browser-migration.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(results))
