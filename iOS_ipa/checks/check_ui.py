"""Exercise the real local player in desktop Chromium; not a device test."""
import json
import os
import math
from pathlib import Path
import socket
import sys
import struct
import tempfile
import urllib.parse
import wave

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'src'))
sys.path.insert(0, str(PROJECT / 'src/mineradio/vendor'))

from playwright.sync_api import sync_playwright
from mineradio import backend


def main():
    output = PROJECT / 'dist/ui-check'
    output.mkdir(parents=True, exist_ok=True)
    report = dict(environment='Windows Chromium', deviceValidated=False,
                  nativeLoginValidated=False, providers={})
    # Exercise local startup while every outbound Python connection is blocked.
    original = socket.create_connection
    def local_only(address, *args, **kwargs):
        if address[0] not in ('127.0.0.1', 'localhost', '::1'):
            raise OSError('UI check is offline')
        return original(address, *args, **kwargs)
    socket.create_connection = local_only
    with tempfile.TemporaryDirectory() as directory:
        tone = Path(directory) / 'offline-check.wav'
        lyric = Path(directory) / 'offline-check.lrc'
        with wave.open(str(tone), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', int(1000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(16000 * 8)))
        lyric.write_text('[00:00.00]本地离线验收\n[00:03.00]音频和歌词保存在本机\n', encoding='utf-8')
        port = backend.start(Path(directory), bundle=PROJECT / 'src/mineradio/bundle', api_port=0, web_port=0)
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(channel='msedge', headless=True)
                page = browser.new_page(viewport=dict(width=1194, height=834), device_scale_factor=1)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/*', lambda route: route.continue_() if
                           urllib.parse.urlsplit(route.request.url).scheme in ('blob', 'data') or
                           urllib.parse.urlsplit(route.request.url).hostname in ('127.0.0.1', 'localhost')
                           else route.abort())
                page.goto(f'http://127.0.0.1:{port}/?ios_layout=tablet', wait_until='domcontentloaded')
                page.wait_for_function('window.MINERADIO_MODULE_STATUS && window.MINERADIO_MODULE_STATUS.ready === true', timeout=45000)
                report['modules'] = page.evaluate('window.MINERADIO_MODULE_STATUS')
                splash = page.locator('#splash')
                if splash.is_visible():
                    splash.click()
                    splash.wait_for(state='hidden')
                page.locator('#file-input').set_input_files([str(tone), str(lyric)])
                page.wait_for_function('window.audio && !audio.paused && audio.currentTime > 0.2', timeout=20000)
                report['offlineAudioPlaying'] = True
                page.screenshot(path=str(output / 'ipad-local-player.png'))
                for provider in ('netease', 'qq', 'kugou', 'qishui'):
                    page.evaluate('(provider) => showLoginModal({provider})', provider)
                    page.wait_for_function('''() => {
                      const mask=document.getElementById('login-modal'),panel=mask&&mask.querySelector('.dual-login-modal');
                      return mask&&panel&&Number(getComputedStyle(mask).opacity)>.95&&Number(getComputedStyle(panel).opacity)>.95;
                    }''')
                    assert not page.get_by_role('button', name='手动输入 Cookie', exact=True).is_visible()
                    assert not page.locator('.local-auth-qr').is_visible()
                    if provider == 'qishui':
                        field = page.get_by_role('textbox', name='手机号', exact=True)
                        field.wait_for(state='visible')
                        assert not page.get_by_role('button', name='账号密码', exact=True).is_visible()
                        assert page.get_by_role('button', name='获取验证码', exact=True).is_visible()
                        assert not page.locator('#local-auth-open-official').is_visible()
                        report['providers'][provider] = dict(phoneLoginForm=True, qrVisible=False, nativeAccountAuthorized=False)
                        page.screenshot(path=str(output / 'ipad-local-login.png'))
                    else:
                        button = page.locator('#local-auth-open-official')
                        button.wait_for(state='visible')
                        assert button.inner_text() == '账号密码 / 验证码登录'
                        assert not page.get_by_role('textbox', name='手机号', exact=True).is_visible()
                        report['providers'][provider] = dict(officialLoginButton=True, qrVisible=False)
                    page.evaluate('closeLoginModal()')
                    page.locator('#login-modal').wait_for(state='hidden')
                page.reload(wait_until='domcontentloaded')
                page.wait_for_function('window.MINERADIO_MODULE_STATUS && window.MINERADIO_MODULE_STATUS.ready === true', timeout=45000)
                library = page.evaluate('async () => browserLocalMusic.listLocalMusicLibrary()')
                assert library['count'] == 1 and library['tracks'][0]['hasLyric'] is True
                report['audioAndLyricsSurviveReload'] = True
                report.update(offlineReload=True, passed=True, javascriptErrors=errors)
                assert not errors, errors
                browser.close()
        finally:
            backend.stop()
            socket.create_connection = original
    (output / 'ui-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
