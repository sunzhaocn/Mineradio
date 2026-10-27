"""Exercise the actual desktop export UI with controlled native/file fixtures."""
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
from urllib.parse import urlsplit, parse_qs
import wave
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    output = ROOT / 'runtime/video-export'
    output.mkdir(parents=True, exist_ok=True)
    movie = output / 'case-0.mp4'
    assert movie.is_file(), 'Run check_video_export.py first to create the synthetic movie'
    with tempfile.TemporaryDirectory(prefix='mr-export-ui-') as directory:
        os.environ.update(MINERADIO_ROOT=directory, MINERADIO_RESOURCE_ROOT=str(ROOT), MINERADIO_CLIENT_ASSET_INIT='0')
        from music_app.web.httpserver import Handler, ThreadingHTTPServer

        class Quiet(Handler):
            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        tone = Path(directory) / 'fixture.wav'
        with wave.open(str(tone), 'wb') as wav:
            wav.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', int(1000*math.sin(i*440*2*math.pi/48000))) for i in range(48000*20)))
        lyric = tone.with_suffix('.lrc')
        lyric.write_text('[00:00]Export UI fixture\n[00:02]Stored lyric\n', encoding='utf-8', newline='\n')
        mv_queries = []

        def route(request):
            parsed = urlsplit(request.request.url)
            if parsed.hostname not in ('127.0.0.1', 'localhost'):
                return request.abort()
            if parsed.path == '/fixture-video.mp4':
                return request.fulfill(path=str(movie), content_type='video/mp4')
            if parsed.path.startswith('/api/'):
                if parsed.path == '/api/download':
                    assert parse_qs(parsed.query)['provider'] == ['netease']
                    return request.fulfill(path=str(tone), content_type='audio/wav')
                if parsed.path == '/api/mv' and parse_qs(parsed.query).get('provider') == ['netease'] and parse_qs(parsed.query).get('id') == ['991001']:
                    mv_queries.append(parsed.query)
                return request.fulfill(json=dict(code=200, available=False, lyric=lyric.read_text(encoding='utf-8'),
                    songs=[], playlists=[], data=[], result=dict(songs=[])))
            return request.continue_()

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(channel='msedge', headless=True)
                context = browser.new_context(viewport=dict(width=1280, height=900), service_workers='block')
                context.add_init_script('''
                  window.MineradioAndroid={};window.exportPayloads=[];
                  window.videoState={status:'idle',progress:0};window.videoListener=()=>{};
                  window.desktopWindow={isDesktop:false,
                    exportVisualVideo:async payload=>{exportPayloads.push(payload);videoState={status:'preparing',progress:0};videoListener(videoState);return {ok:true,jobId:'fixture'}},
                    getVisualVideoExportState:async()=>videoState,
                    onVisualVideoExportState:listener=>{videoListener=listener},
                    cancelVisualVideoExport:async()=>{videoState={status:'canceled',progress:0};videoListener(videoState);return videoState},
                    saveExportFile:async()=>({ok:true})};
                ''')
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/*', route)
                page.goto(f'http://127.0.0.1:{server.server_address[1]}/', wait_until='domcontentloaded')
                page.wait_for_function('window.MINERADIO_MODULE_STATUS?.ready', timeout=45000)
                if page.locator('#splash').is_visible():
                    page.locator('#splash').click()
                    page.locator('#splash').wait_for(state='hidden')
                page.locator('#file-input').set_input_files([str(tone), str(lyric)])
                page.wait_for_function('window.audio&&!audio.paused&&audio.currentTime>.1', timeout=15000)
                page.evaluate('''async()=>{
                  window.fixtureSong=(await browserLocalMusic.listLocalMusicLibrary()).tracks[0];
                  setPreset(9,{silent:true});await mineradioVideoExport.open(fixtureSong);
                }''')
                page.get_by_label('画面清晰度', exact=True).select_option('720')
                page.get_by_label('流畅度', exact=True).select_option('30')
                page.get_by_role('button', name='选择位置并导出', exact=True).click()
                page.wait_for_function('exportPayloads.length===1')
                data = page.evaluate('''async()=>{const value=exportPayloads[0];return {preset:value.preset.snapshot.preset,
                  audio:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value.audio))).map(x=>x.toString(16).padStart(2,'0')).join(''),
                  lyric:value.lyric,width:value.width,height:value.height,fps:value.fps}}''')
                import hashlib
                assert data == dict(preset=9, audio=hashlib.sha256(tone.read_bytes()).hexdigest(),
                                    lyric=lyric.read_text(encoding='utf-8'), width=1280, height=720, fps=30), data
                page.evaluate("videoState={status:'rendering',progress:55,duration:20};videoListener(videoState)")
                assert '55%' in page.locator('#video-export-modal [role="status"]').inner_text()
                page.locator('#video-export-modal').get_by_role('button', name='收起', exact=True).click()
                page.locator('#video-export-modal').wait_for(state='hidden')
                page.locator('#video-export-badge').click()
                assert '55%' in page.locator('#video-export-modal [role="status"]').inner_text()
                page.screenshot(path=str(output / 'desktop-export-ui.png'))
                page.get_by_role('button', name='取消导出', exact=True).click()
                page.wait_for_function('document.querySelector("#video-export-modal [role=status]").textContent.includes("已取消")')
                page.locator('#video-export-modal').get_by_role('button', name='收起', exact=True).click()
                page.locator('#video-export-modal').wait_for(state='hidden')
                page.evaluate('''async()=>{
                  window.cloudFixture={provider:'netease',source:'netease',id:991001,name:'Cached MV',artist:'Fixture'};
                  const cached=await mineradioMediaCache.video(cloudFixture,'/fixture-video.mp4');if(!cached)throw new Error('Fixture cache failed');
                  mineradioMV.setFallback(9);setPreset(13,{silent:true});await mineradioVideoExport.open(cloudFixture);
                }''')
                page.get_by_role('button', name='选择位置并导出', exact=True).click()
                page.wait_for_function('exportPayloads.length===2')
                assert page.evaluate('exportPayloads[1].preset.snapshot.preset') == 13
                assert page.evaluate('exportPayloads[1].video.byteLength') == movie.stat().st_size
                assert not mv_queries, mv_queries
                mv_round_trip = page.evaluate('''async()=>{
                  const value=await mineradioTrackExports.capture();value.resources.mvEndMode='loop';
                  mineradioMV.setEndMode('fallback');await mineradioTrackExports.apply(value);
                  return (await mineradioTrackExports.capture()).resources.mvEndMode;
                }''')
                assert mv_round_trip == 'loop', mv_round_trip
                page.evaluate("videoState={status:'completed',progress:100,fileName:'fixture.mp4'};videoListener(videoState)")
                portable_slides = page.evaluate('''async()=>{
                  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=';
                  const value={type:'mineradio-track-preset',schema:1,snapshot:{preset:14,visualPresetSchema:VISUAL_PRESET_SCHEMA},resources:{slides:[{name:'a.png',data:image},{name:'b.png',data:image}],slideSeconds:2}};
                  await mineradioTrackExports.apply(value);await mineradioSlideshow.add([]);
                  const exported=await mineradioTrackExports.capture();return {preset:exported.snapshot.preset,slides:exported.resources.slides.length,seconds:exported.resources.slideSeconds};
                }''')
                assert portable_slides == dict(preset=14, slides=2, seconds=2), portable_slides
                assert not errors, errors
                context.close()
                browser.close()
            report = dict(passed=True, environment='Chromium desktop UI with mocked native save/export calls',
                audioBytesMatch=True, lyricMatches=True, chosenPresetAndDimensionsMatch=True,
                progressSurvivesPanelClose=True, cancellationAvailable=True, cachedMvUsedWithoutLookup=True,
                portableSlideshowRoundTripPassed=True, javascriptErrors=errors, deviceValidated=False)
            (output / 'desktop-ui-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(report))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
