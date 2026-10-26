import asyncio
import json
from pathlib import Path
import sys
import os
import secrets

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))

import toga
from toga.style import Pack
from . import backend
from .exports import ExportStore


class Mineradio(toga.App):
    def startup(self):
        # Embedded Python does not install its usual signal handlers. A closed
        # logging/socket pipe must raise EPIPE rather than kill the UIKit app.
        import signal
        signal.signal(signal.SIGPIPE, signal.SIG_IGN)
        self.main_window = toga.MainWindow(title='Mineradio')
        self.main_window.content = toga.Label('正在启动本机音乐服务…', style=Pack(padding=24))
        self.main_window.show()
        asyncio.create_task(self.start_player())

    async def start_player(self):
        try:
            if os.environ.get('MINERADIO_IOS_DIAGNOSTIC') == '1':
                import faulthandler
                self.paths.cache.mkdir(parents=True, exist_ok=True)
                self._diagnostic_trace = (self.paths.cache / 'python-native-threads.txt').open('w', encoding='utf-8')
                faulthandler.dump_traceback_later(45, repeat=True, file=self._diagnostic_trace)
            from . import native
            from rubicon.objc import ObjCClass
            native.configure_factory()
            self.audio_session = native.configure_audio()
            self.exports = ExportStore(self.paths.cache / 'exports')
            from . import official_login, passport, signer
            passport.install(self)
            official_login.install(self)
            self.signer_config = json.loads((Path(__file__).parent / 'bundle/sdk-config.json').read_text(encoding='utf-8'))
            if self.signer_config.get('configured'):
                signer.install(self.signer_config)
            self.qishui_enabled = False
            preference = self.paths.data / 'qishui-connection.json'
            try:
                approved = json.loads(preference.read_text(encoding='utf-8'))
                if (self.signer_config.get('configured') and approved.get('privacyAgreed') is True
                        and isinstance(approved.get('deviceId'), str)):
                    self.signer_config.update(privacyAgreed=True, deviceId=approved['deviceId'])
                    signer.install(self.signer_config)
            except (OSError, ValueError, RuntimeError):
                pass
            (self.paths.cache / 'ios-bridge-ready.json').unlink(missing_ok=True)
            # Network server setup and imports run off the UI thread.
            self.port = await asyncio.to_thread(backend.start, self.paths.data)
            from music_app.providers.qishui import media_ios
            def media_progress(stage, **details):
                (self.paths.cache / 'media-prepare-progress.json').write_text(
                    json.dumps(dict(stage=stage, **details)), encoding='utf-8')
            media_ios.prepare_native_runtime(progress=media_progress)
            self.web = toga.WebView(style=Pack(flex=1))
            self.bridge = native.MineradioWKBridge.alloc().init()
            self.bridge.owner = self
            self.web._impl.native.configuration.userContentController.addScriptMessageHandler(self.bridge, name='mineradio')
            self.web._impl.native.navigationDelegate = self.bridge
            self.system_media = None
            try:
                from . import system_media
                self.system_media = system_media.install(self)
                (self.paths.cache / 'system-media-diagnostic.json').write_text(json.dumps(
                    {'installed':True, 'commands':len(self.system_media.targets)}), encoding='utf-8')
            except Exception as error:
                import traceback
                (self.paths.cache / 'system-media-diagnostic.json').write_text(json.dumps(
                    {'installed':False, 'error':type(error).__name__, 'traceback':traceback.format_exc()}), encoding='utf-8')
            tablet = int(ObjCClass('UIDevice').currentDevice.userInterfaceIdiom) == 1
            profile = 'tablet' if tablet else 'phone'
            self.main_window.content = self.web
            from . import layout
            self.layout = layout.install(self)
            self.web.url = f'http://127.0.0.1:{self.port}/?ios_layout={profile}'
            asyncio.create_task(self.check_player_modules())
            if os.environ.get('MINERADIO_IOS_DIAGNOSTIC') == '1':
                asyncio.create_task(self.check_qishui_native())
        except Exception as error:
            import traceback
            self.paths.cache.mkdir(parents=True, exist_ok=True)
            (self.paths.cache / 'startup-failure.txt').write_text(traceback.format_exc(), encoding='utf-8')
            print('Mineradio iOS startup failed:', type(error).__name__, str(error), flush=True)
            # The type is enough for diagnosis; never display request credentials.
            self.main_window.content = toga.Label(
                '本机播放器启动失败（' + type(error).__name__ + '）。请关闭应用后重试。',
                style=Pack(padding=24))

    def handle_bridge(self, message):
        if message.get('op') == 'enableQishui':
            asyncio.create_task(self.enable_qishui(message['id']))
            return
        try:
            args = message.get('args')
            if not isinstance(args, dict):
                raise ValueError('本机请求格式错误')
            operation = message.get('op')
            if operation == 'selfCheck':
                result = True
            elif operation == 'selfCheckConfirmed':
                (self.paths.cache / 'ios-bridge-ready.json').write_text(
                    '{"nativeBridgeReady":true}', encoding='utf-8')
                print('Mineradio iOS native bridge ready', flush=True)
                result = True
            elif operation == 'beginSave':
                result = self.exports.begin(args.get('name'), args.get('size'))
            elif operation == 'appendSave':
                result = self.exports.append(args['token'], args['offset'], args['data'])
            elif operation == 'finishSave':
                path = self.exports.finish(args['token'])
                try:
                    from .native import share_file
                    share_file(self, path)
                except Exception:
                    self.exports.remove(path)
                    raise
                result = True
            elif operation == 'cancelSave':
                self.exports.cancel(args['token'])
                result = True
            elif operation == 'playback':
                if self.system_media is not None:
                    self.system_media.playback(args)
                result = self.system_media is not None
            else:
                raise ValueError('未知本机操作')
            error = None
        except Exception:
            result, error = None, '文件导出失败，请关闭其他系统窗口后重试'
        source = 'window.mineradioIOSReply && window.mineradioIOSReply(' + ','.join(
            json.dumps(value, ensure_ascii=True) for value in (message['id'], result, error)) + ')'
        asyncio.create_task(self.reply(source))

    async def reply(self, source):
        try:
            await self.web.evaluate_javascript(source)
        except Exception:
            import traceback
            (self.paths.cache / 'ios-bridge-failure.txt').write_text(traceback.format_exc(), encoding='utf-8')

    async def enable_qishui(self, identifier):
        try:
            if not self.signer_config.get('configured'):
                raise RuntimeError('汽水本地连接尚未配置，当前版本不能使用汽水；本地曲库和其他平台可正常使用。')
            if not self.qishui_enabled:
                agreed = self.signer_config.get('privacyAgreed') is True
                if not agreed:
                    agreed = await self.main_window.dialog(toga.ConfirmDialog('连接汽水音乐',
                        '汽水连接组件会读取设备、网络及运动传感器信息，用于平台请求验证。音乐账号仍由你扫码授权。是否同意启用？'))
                if not agreed:
                    raise RuntimeError('你尚未同意启用汽水连接')
                from . import signer
                config = dict(self.signer_config, privacyAgreed=True,
                              deviceId=self.signer_config.get('deviceId') or str(secrets.randbelow(8 * 10**15) + 10**15))
                signer.install(config)
                state = await asyncio.wait_for(asyncio.to_thread(signer.enable), timeout=40)
                if not state.get('initialized') or not state.get('httpCallbackInstalled'):
                    raise RuntimeError('汽水签名组件初始化未完成，请稍后重试')
                self.signer_config = config
                self.qishui_enabled = True
                (self.paths.data / 'qishui-connection.json').write_text(json.dumps(
                    {'privacyAgreed':True, 'deviceId':config['deviceId']}), encoding='utf-8')
            result, error = True, None
        except Exception as failure:
            result, error = False, str(failure) if isinstance(failure, RuntimeError) else '汽水连接组件暂不可用'
        await self.reply('window.mineradioIOSReply(' + ','.join(json.dumps(value,ensure_ascii=True)
            for value in (identifier, result, error)) + ')')

    async def check_qishui_native(self):
        import time
        result = {}
        started_at = time.monotonic()
        path = self.paths.cache / 'qishui-native-diagnostic.json'
        def save():
            result['elapsedSeconds'] = round(time.monotonic()-started_at, 2)
            path.write_text(json.dumps(result, ensure_ascii=True, indent=2), encoding='utf-8')
        # Let the main WebView finish loading before exercising worker/native
        # boundaries, so the initial UI remains independently observable.
        for _ in range(90):
            await asyncio.sleep(1)
            try:
                modules = json.loads(await self.web.evaluate_javascript('JSON.stringify(window.MINERADIO_MODULE_STATUS||{})'))
                if modules.get('ready'):
                    break
            except Exception:
                pass
        result['stage'] = 'media'
        save()
        try:
            from . import media_diagnostic
            result['media'] = await asyncio.to_thread(media_diagnostic.run, self.paths.cache)
        except Exception as error:
            import traceback
            result['media'] = {'passed':False, 'error':type(error).__name__, 'traceback':traceback.format_exc()}
        result['stage'] = 'passport'
        save()
        try:
            from . import passport
            result['passport'] = await passport.diagnostic()
            save()
            if result['passport'].get('ready'):
                from music_app.auth.qishui import adapter
                created = await asyncio.to_thread(adapter.create_session)
                try:
                    result['passport']['qrCreated'] = bool(created.get('qr_url') and created.get('qr_image'))
                    result['passport']['qrExpiresIn'] = created.get('expires_in')
                finally:
                    await asyncio.to_thread(adapter.close_session, created['state'])
        except Exception as error:
            result.setdefault('passport', {})['qrCreated'] = False
            result['passport']['error'] = type(error).__name__
        save()
        from . import official_login
        for provider in ('netease', 'qq', 'kugou'):
            result['stage'] = provider + 'OfficialLogin'
            save()
            result.setdefault('officialLogin', {})[provider] = await official_login.diagnostic(provider)
            save()
        result['stage'] = 'signer'
        result['signer'] = {'stage':'initializing'}
        save()
        try:
            from . import signer
            # Fresh CI simulator only: a synthetic app-local identifier, never
            # the user's iPad ID, account session, Cookie or desktop state.
            probe = dict(self.signer_config, privacyAgreed=True, deviceId='9012345678901234', installId='901234567890123')
            result['signer'] = await asyncio.to_thread(signer.diagnostic, probe)
            for _ in range(12):
                if result['signer'].get('signed'):
                    break
                await asyncio.sleep(.5)
                try:
                    headers = await asyncio.to_thread(signer.sign_headers,
                        'https://api.qishui.com/luna/pc/discover?aid=386088', {'accept':'application/json'})
                    result['signer'] = {'state':signer.status(), 'signed':bool(headers),
                                        'signatureLengths':{key:len(value) for key,value in headers.items()}}
                except RuntimeError:
                    result['signer']['state'] = signer.status()
        except Exception as error:
            result['signer'] = {'signed':False, 'error':type(error).__name__}
        save()
        if result.get('signer', {}).get('signed'):
            from music_app.providers.qishui import api as qishui_api
            for name, operation in (('charts', qishui_api.chart_catalog),
                                    ('search', lambda:qishui_api.search('晴天', size=3))):
                try:
                    value = await asyncio.to_thread(operation)
                    result.setdefault('guestAPI', {})[name] = {
                        'accepted':True, 'resultType':type(value).__name__}
                except Exception as error:
                    result.setdefault('guestAPI', {})[name] = {
                        'accepted':False, 'error':type(error).__name__,
                        'code':getattr(error, 'code', '')}
                save()
        result['complete'] = True
        save()

    async def check_player_modules(self):
        for _ in range(30):
            await asyncio.sleep(5)
            try:
                value = await self.web.evaluate_javascript('JSON.stringify(Object.assign({}, window.MINERADIO_MODULE_STATUS || {}, {nativeBridge:window.mineradioIOSBridgeDiagnostic,nativeMedia:window.mineradioIOSNativeMedia===true}))')
                status = json.loads(value or '{}')
                (self.paths.cache / 'ios-player-modules.json').write_text(json.dumps(status), encoding='utf-8')
                if status.get('ready') or status.get('error'):
                    return
            except Exception:
                pass


def main():
    return Mineradio('Mineradio', 'dev.mineradio.mineradio')
