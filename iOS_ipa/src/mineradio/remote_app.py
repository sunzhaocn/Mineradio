"""iPad/iPhone WebKit shell for the private HTTPS music service."""
import toga
from toga.style import Pack

ORIGIN = 'https://music.hbsuzh.cn'


def configure_window():
    # Toga 0.5.3 MainWindow uses a UINavigationController solely for a title.
    # Create the view's owner once. RootContainer.__init__ would first attach
    # it to a different controller, which UIKit rejects when reassigned.
    from toga_iOS.container import Container, RootContainer
    from toga_iOS.window import MainWindow
    from rubicon.objc import ObjCClass, objc_method
    global _FullscreenController
    if '_FullscreenController' not in globals():
        class MineradioFullscreenController(ObjCClass('UIViewController')):
            @objc_method
            def prefersStatusBarHidden(self) -> bool:
                return True

            @objc_method
            def prefersHomeIndicatorAutoHidden(self) -> bool:
                return True
        _FullscreenController = MineradioFullscreenController

    class FullscreenContainer(RootContainer):
        def __init__(self, **kwargs):
            Container.__init__(self, **kwargs)
            self.controller = _FullscreenController.alloc().init()
            self.controller.view = self.native

        @property
        def top_offset(self):
            return 0

    def create_container(window):
        window.container = FullscreenContainer(on_refresh=window.content_refreshed)

    MainWindow.create_container = create_container


def configure_keep_awake(app):
    """Keep the screen on only while the app is active in the foreground."""
    from rubicon.objc import ObjCClass, SEL, objc_method
    global _AwakeObserver
    if '_AwakeObserver' not in globals():
        class MineradioAwakeObserver(ObjCClass('NSObject')):
            @objc_method
            def activate_(self, notification) -> None:
                ObjCClass('UIApplication').sharedApplication.idleTimerDisabled = True

            @objc_method
            def deactivate_(self, notification) -> None:
                ObjCClass('UIApplication').sharedApplication.idleTimerDisabled = False
        _AwakeObserver = MineradioAwakeObserver
    app.awake_observer = _AwakeObserver.alloc().init()
    center = ObjCClass('NSNotificationCenter').defaultCenter
    center.addObserver(app.awake_observer, selector=SEL('activate:'),
                       name='UIApplicationDidBecomeActiveNotification', object=None)
    center.addObserver(app.awake_observer, selector=SEL('deactivate:'),
                       name='UIApplicationWillResignActiveNotification', object=None)
    ObjCClass('UIApplication').sharedApplication.idleTimerDisabled = True


def navigation_delegate(app):
    from rubicon.objc import ObjCClass, objc_method, objc_property
    global _RemoteNavigationDelegate
    if '_RemoteNavigationDelegate' not in globals():
        class MineradioRemoteNavigation(ObjCClass('NSObject')):
            owner = objc_property(object, weak=True)

            @objc_method
            def userContentController_didReceiveScriptMessage_(self, controller, message) -> None:
                from rubicon.objc import py_from_ns
                from rubicon.objc.runtime import send_message
                from ctypes import c_bool
                import json
                owner = self.owner
                if not owner or not send_message(message.frameInfo, 'isMainFrame', restype=c_bool):
                    return
                origin = message.frameInfo.securityOrigin
                if str(origin.protocol) != 'https' or str(origin.host) != 'music.hbsuzh.cn' or int(origin.port) not in (0, 443):
                    return
                try:
                    data = py_from_ns(message.body)
                    if not isinstance(data, dict):
                        return
                    if data.get('op') == 'audio' and type(data.get('playing')) is bool:
                        playing = data['playing']
                        if playing != getattr(owner, 'audio_active', False) and owner.audio_session:
                            if playing:
                                ok = owner.audio_session.setActive(True, error=None)
                            else:
                                ok = owner.audio_session.setActive(False, withOptions=1, error=None)
                            if not ok:
                                raise RuntimeError('System audio session activation failed')
                            owner.audio_active = playing
                    # Only bounded status fields are retained; no titles, URLs,
                    # account data or lyric contents pass through this channel.
                    clean = {key: data[key] for key in ('op', 'playing', 'position', 'hidden', 'tracks', 'lyrics', 'failed')
                             if key in data and type(data[key]) in (bool, int, float)}
                    clean['op'] = 'audio' if data.get('op') == 'audio' else 'library'
                    import time
                    now = time.monotonic()
                    if clean['op'] != 'audio' or now - getattr(owner, 'audio_diagnostic_at', 0) > 5:
                        owner.audio_diagnostic_at = now
                        try:
                            (owner.paths.data / ('Mineradio-' + clean['op'] + '-diagnostic.json')).write_text(json.dumps(clean), encoding='utf-8')
                        except OSError:
                            pass
                except Exception:
                    import traceback
                    try:
                        (owner.paths.data / 'Mineradio-media-diagnostic.txt').write_text(traceback.format_exc(), encoding='utf-8')
                    except OSError:
                        pass

            @objc_method
            def webView_didFinishNavigation_(self, webview, navigation) -> None:
                owner = self.owner
                if owner:
                    owner.web.on_webview_load()
                    future = owner.web._impl.loaded_future
                    if future and not future.done():
                        future.set_result(None)
                    owner.web._impl.loaded_future = None
                    from pathlib import Path
                    (Path.home() / 'Documents' / 'Mineradio-connection-diagnostic.txt').write_text(
                        'Connected through system WebKit: ' + ORIGIN + '\n', encoding='utf-8')

            @objc_method
            def webView_didFailProvisionalNavigation_withError_(self, webview, navigation, error) -> None:
                owner = self.owner
                if owner:
                    from pathlib import Path
                    (Path.home() / 'Documents' / 'Mineradio-connection-diagnostic.txt').write_text(
                        'WebKit network error: ' + str(error.domain) + ' / ' + str(error.code), encoding='utf-8')
                    owner.show_failure('离线界面尚未初始化完成。请先联网打开一次，等待“离线初始化完成”后即可断网听本地歌曲。')
        _RemoteNavigationDelegate = MineradioRemoteNavigation
    delegate = _RemoteNavigationDelegate.alloc().init()
    delegate.owner = app
    return delegate


class MineradioRemote(toga.App):
    def startup(self):
        configure_window()
        self.main_window = toga.MainWindow(title='Mineradio')
        self.main_window.content = toga.Label('Mineradio', style=Pack(
            padding=28, flex=1, font_size=42, text_align='center',
            color='#f8f8f2', background_color='#000000'))
        self.main_window.show()
        configure_keep_awake(self)
        self.connect()

    def connect(self, widget=None):
        try:
            from . import native
            native.configure_factory(app_bound=True)
            try:
                self.audio_session = native.configure_audio()
            except Exception:
                self.audio_session = None
            # The remote page receives no local account/file/signing bridge.
            # Toga's normal WKWebView supplies a full app surface without a URL bar.
            self.web = toga.WebView(style=Pack(flex=1))
            from rubicon.objc import ObjCClass
            black = ObjCClass('UIColor').blackColor
            self.web._impl.native.opaque = False
            self.web._impl.native.backgroundColor = black
            self.web._impl.native.scrollView.backgroundColor = black
            self.navigation = navigation_delegate(self)
            self.web._impl.native.navigationDelegate = self.navigation
            controller = self.web._impl.native.configuration.userContentController
            controller.addScriptMessageHandler(self.navigation, name='mineradioAudio')
            script = ObjCClass('WKUserScript').alloc().initWithSource(
                """try { if(navigator.audioSession) navigator.audioSession.type='playback'; } catch (_) {}
                if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', function () {
                  if (!sessionStorage.getItem('mineradio-shell-refresh-12') && !(window.audio && !window.audio.paused)) {
                    sessionStorage.setItem('mineradio-shell-refresh-12','1'); location.reload();
                  }
                });""",
                injectionTime=0, forMainFrameOnly=True)
            controller.addUserScript(script)
            self.main_window.content = self.web
            self.web.url = ORIGIN + '/?app=ipad'
        except Exception:
            import traceback
            report = self.paths.data / 'Mineradio-connection-diagnostic.txt'
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(traceback.format_exc(), encoding='utf-8')
            self.show_failure('播放器连接组件暂时无法启动，请重试。')

    def show_failure(self, message):
        from toga.style.pack import COLUMN
        self.main_window.content = toga.Box(children=[
            toga.Label(message, style=Pack(padding=20)),
            toga.Button('重新连接', on_press=self.connect, style=Pack(padding=20)),
        ], style=Pack(direction=COLUMN, padding=24))


def main():
    return MineradioRemote('Mineradio', 'dev.mineradio.mineradio')
