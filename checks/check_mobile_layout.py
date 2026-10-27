"""Render the Android phone pages in Chromium; no phone or real account is used."""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
from unittest.mock import patch
from urllib.parse import urlsplit
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'runtime/mobile-layout')
    parser.add_argument('--search-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright

    with tempfile.TemporaryDirectory(prefix='mrlayout-') as directory:
        os.environ.update(MINERADIO_ROOT=directory, MINERADIO_RESOURCE_ROOT=str(ROOT),
                          MINERADIO_CLIENT_ASSET_INIT='0')
        spec = importlib.util.spec_from_file_location('android_layout_backend',
            ROOT / 'Android_apk/app/src/main/python/mineradio_android.py')
        android = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(android)
        from music_app.api import server as api
        from music_app.core import httpserver
        original_api, original_web = api.create_server, httpserver.ExclusiveThreadingHTTPServer
        # Exercise the actual Android HTML adapter without occupying app ports.
        with patch.object(api, 'create_server', lambda host, port: original_api(host, 0)), \
             patch.object(httpserver, 'ExclusiveThreadingHTTPServer',
                          lambda address, handler: original_web((address[0], 0), handler)):
            port = android.start(directory)
        origin = f'http://127.0.0.1:{port}'
        tone = Path(directory) / 'layout-check.wav'
        with wave.open(str(tone), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', int(500 * math.sin(i * 440 * 2 * math.pi / 16000)))
                                      for i in range(16000 * 20)))
        lyric = tone.with_suffix('.lrc')
        lyric.write_text('[00:00.00]手机布局测试歌词\n[00:05.00]本地音乐播放测试\n', encoding='utf-8')
        report = {'environment': 'Chromium with real Android HTML and bridge; native methods mocked',
                  'deviceValidated': False, 'cases': []}

        def route(request):
            path = urlsplit(request.request.url).path
            if urlsplit(request.request.url).hostname not in ('127.0.0.1', 'localhost'):
                return request.abort()
            if path == '/android-bridge.js':
                return request.fulfill(path=str(ROOT / 'Android_apk/app/src/main/assets/android-bridge.js'),
                                       content_type='application/javascript')
            if path.startswith('/api/'):
                # Deterministic data exercises long rows without remote services or accounts.
                songs = [dict(id=910000 + i, name='纪念 / 手机布局测试的较长歌曲名称 ' + str(i),
                              artists='测试歌手', artist='测试歌手', album='测试专辑', picUrl='',
                              duration=200000, source='netease') for i in range(25)]
                data = dict(code=200, songs=songs if path.endswith('/search') else [],
                            result=dict(songs=songs, songCount=25), songCount=25, hasMore=False,
                            data=[], playlists=[], available=False, loggedIn=False)
                if path == '/api/platform/capabilities':
                    data = {p: dict(available=True) for p in ('netease', 'qq', 'kugou', 'qishui')}
                return request.fulfill(json=data)
            return request.continue_()

        def bounds(page, selector):
            locator = page.locator(selector)
            assert locator.is_visible(), f'{selector} hidden on {page.url}'
            box = locator.bounding_box()
            assert box and box['width'] > 0 and box['height'] > 0, (selector, box)
            assert box['x'] >= -1 and box['x'] + box['width'] <= page.viewport_size['width'] + 1, (selector, box)
            return box

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(channel='msedge', headless=True)
                sizes = [(420, 900)] if args.search_only else [(320, 640), (360, 800), (393, 852),
                           (420, 900), (600, 960), (844, 390)]
                for width, height in sizes:
                    context = browser.new_context(viewport=dict(width=width, height=height),
                        screen=dict(width=width, height=height), is_mobile=True, has_touch=True,
                        user_agent='Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36')
                    context.add_init_script('''
                      window.updateFixture={platform:'android',currentVersion:'1.1.12',version:'1.1.13',
                        status:'idle',updateAvailable:false,progress:0,total:104857600,transferred:0,notes:'测试版本说明\\n修复手机布局，保留本地音乐。'};
                      window.MineradioAndroid={isForeground:()=>true,playback:()=>{},
                        getUpdateState:()=>JSON.stringify(updateFixture),
                        checkForUpdates:()=>{updateFixture.status='available';updateFixture.updateAvailable=true;return JSON.stringify(updateFixture)},
                        downloadUpdate:()=>{updateFixture.status=updateFixture.status==='downloaded'?'downloaded':'downloading';return JSON.stringify(updateFixture)}};
                    ''')
                    page = context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.route('**/*', route)
                    page.goto(origin + f'/?android_layout=phone&width={width}&scale=1', wait_until='domcontentloaded')
                    page.wait_for_function('window.MINERADIO_MODULE_STATUS?.ready && window.webMobileNavigation?.active()', timeout=45000)
                    splash = page.locator('#splash')
                    if splash.is_visible():
                        splash.click()
                        splash.wait_for(state='hidden')
                    case = dict(width=width, height=height, pages={})
                    if not args.search_only:
                        case['pages']['home'] = bounds(page, '#empty-home')
                        page.screenshot(path=str(args.output / f'{width}x{height}-home.png'))
                    page.locator('[data-mobile-destination="search"]').click()
                    page.locator('#search-input').fill('纪念')
                    page.screenshot(path=str(args.output / f'{width}x{height}-search.png'))
                    search = bounds(page, '#search-area')
                    box = bounds(page, '#search-box')
                    tabs = bounds(page, '#search-mode-tabs')
                    case['pages']['search'] = dict(area=search, box=box, tabs=tabs)
                    if args.search_only:
                        report['cases'].append(case)
                        context.close()
                        continue
                    assert box['width'] >= width - 40, ('Search leaves an unused column', box, width)
                    assert abs(search['width'] - box['width']) <= 2, ('Search stack shrank', search, box)
                    assert abs(tabs['width'] - box['width']) <= 2, ('Provider row shrank', tabs, box)
                    page.locator('#search-input').press('Enter')
                    page.locator('#search-results .search-result').first.wait_for(timeout=15000)
                    page.screenshot(path=str(args.output / f'{width}x{height}-results.png'))
                    results = bounds(page, '#search-results')
                    assert results['width'] >= width - 40, results
                    assert results['y'] + results['height'] <= bounds(page, '#web-mobile-nav')['y'] + 1, results
                    # The last provider remains reachable by horizontal touch scrolling.
                    last = page.locator('#search-mode-tabs button:visible').last
                    last.scroll_into_view_if_needed()
                    assert last.bounding_box()['x'] + last.bounding_box()['width'] <= width + 1
                    page.locator('#file-input').set_input_files([str(tone), str(lyric)])
                    page.wait_for_function('window.audio && !audio.paused && audio.currentTime > .1', timeout=15000)
                    for destination, selector in [('library', '.web-library'), ('player', '#web-player-stage')]:
                        page.locator(f'[data-mobile-destination="{destination}"]').click()
                        page.locator(selector).wait_for(state='visible')
                        case['pages'][destination] = bounds(page, selector)
                        page.screenshot(path=str(args.output / f'{width}x{height}-{destination}.png'))
                    for control in ('#play-btn', '#prev-btn', '#next-btn', '#web-player-more-btn'):
                        button = bounds(page, control)
                        assert button['y'] >= 0 and button['y'] + button['height'] <= height, (control, button)
                    page.locator('#web-player-more-btn').click()
                    case['pages']['more'] = bounds(page, '#web-player-more')
                    page.screenshot(path=str(args.output / f'{width}x{height}-more.png'))
                    page.locator('#web-player-more-btn').click()
                    page.locator('[data-mobile-destination="library"]').click()
                    page.evaluate("webMobileNavigation.go('library-detail')")
                    case['pages']['queue'] = bounds(page, '#playlist-panel')
                    assert case['pages']['queue']['width'] >= width - 2
                    page.screenshot(path=str(args.output / f'{width}x{height}-queue.png'))
                    page.evaluate("webMobileNavigation.go('home'); showLoginModal({provider:'qishui'})")
                    page.locator('#login-modal .dual-login-modal').wait_for(state='visible')
                    case['pages']['login'] = bounds(page, '#login-modal .dual-login-modal')
                    page.screenshot(path=str(args.output / f'{width}x{height}-login.png'))
                    page.evaluate('closeLoginModal()')
                    page.locator('#login-modal').wait_for(state='hidden')
                    page.locator('[data-mobile-destination="library"]').click()
                    page.locator('#android-update-entry').click()
                    case['pages']['update'] = bounds(page, '#update-modal .update-modal')
                    page.locator('#update-primary-btn').click()
                    page.evaluate("Object.assign(updateFixture,{status:'downloading',progress:54,transferred:56623104});mineradioAndroidAcceptUpdate(JSON.parse(JSON.stringify(updateFixture)))")
                    assert page.locator('#update-btn-label').text_content() == '正在下载 54%'
                    assert page.locator('#update-primary-btn').is_disabled()
                    page.locator('#update-modal .update-secondary-btn').click()
                    page.locator('#update-modal').wait_for(state='hidden')
                    page.locator('#android-update-entry').click()
                    assert page.locator('#update-btn-label').text_content() == '正在下载 54%'
                    page.wait_for_function('''() => ['.update-actions','.update-kicker','.update-version','.update-hero'].every(selector =>
                      Number(getComputedStyle(document.querySelector('#update-modal '+selector)).opacity) > .95)''')
                    page.screenshot(path=str(args.output / f'{width}x{height}-update.png'))
                    page.evaluate("Object.assign(updateFixture,{status:'downloaded',progress:100});mineradioAndroidAcceptUpdate(JSON.parse(JSON.stringify(updateFixture)))")
                    assert page.locator('#update-btn-label').text_content() == '安装更新'
                    assert page.locator('#update-primary-btn').is_enabled()
                    page.locator('#update-primary-btn').click()
                    assert page.locator('#update-btn-label').text_content() == '安装更新'
                    page.evaluate("Object.assign(updateFixture,{status:'error',error:'网络中断，请重试'});mineradioAndroidAcceptUpdate(JSON.parse(JSON.stringify(updateFixture)))")
                    assert page.locator('#update-footnote').inner_text() == '网络中断，请重试'
                    assert not errors, errors
                    case.update(javascriptErrors=errors, localAudioPlaying=page.evaluate('!audio.paused'))
                    report['cases'].append(case)
                    context.close()
                browser.close()
            report['passed'] = not args.search_only
        finally:
            for server, _ in reversed(android._servers):
                server.shutdown()
                server.server_close()
            (args.output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
