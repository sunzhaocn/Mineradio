"""Pinned Toga 0.5.3 / WebKit bridge. Only the local main frame can export."""
from urllib.parse import urlsplit
import math
import json
import traceback
from ctypes import c_bool

from rubicon.objc import (ObjCClass, ObjCProtocol, ObjCBlock, objc_id,
                          objc_method, objc_property, py_from_ns, ns_from_py)
from rubicon.objc.runtime import load_library, send_message

load_library('WebKit')
load_library('AVFAudio')
NSObject = ObjCClass('NSObject')
# Resolve WebKit classes before querying lazily registered protocol metadata.
ObjCClass('WKWebView')
ObjCClass('WKUserContentController')
_protocols = []
for _name in ('WKScriptMessageHandler', 'WKNavigationDelegate'):
    try:
        _protocols.append(ObjCProtocol(_name))
    except NameError:
        # WebKit invokes the Objective-C selectors directly. Protocol metadata
        # can be absent in a simulator image; the methods below remain exposed.
        pass


class MineradioWKBridge(NSObject, protocols=_protocols):
    owner = objc_property(object, weak=True)

    @objc_method
    def userContentController_didReceiveScriptMessage_(self, controller, message) -> None:
        app = self.owner
        if app is None:
            return
        try:
            receive_message(app, message)
        except Exception:
            (app.paths.cache / 'ios-bridge-failure.txt').write_text(traceback.format_exc(), encoding='utf-8')

    @objc_method
    def webView_decidePolicyForNavigationAction_decisionHandler_(self, webview, action, handler) -> None:
        app = self.owner
        target = urlsplit(str(action.request.URL.absoluteString))
        try:
            allowed = bool(app and target.scheme == 'http' and target.hostname == '127.0.0.1'
                           and target.port == app.port and not target.username and not target.password)
        except ValueError:
            allowed = False
        # Keep subframes local too; provider authorization is handled by Python
        # requests and QR images, never by loading a remote privileged main page.
        ObjCBlock(handler, None, __import__('ctypes').c_long)(1 if allowed else 0)

    @objc_method
    def webView_didFinishNavigation_(self, webview, navigation) -> None:
        app = self.owner
        if app:
            app.web.on_webview_load()
            future = app.web._impl.loaded_future
            if future and not future.done():
                future.set_result(None)
            app.web._impl.loaded_future = None


def configure_factory(app_bound=False):
    from toga_iOS import factory
    from toga_iOS.widgets.webview import WebView, TogaWebView

    class InlineWebView(WebView):
        def create(self):
            config = ObjCClass('WKWebViewConfiguration').alloc().init()
            if app_bound:
                config.limitsNavigationsToAppBoundDomains = True
            config.websiteDataStore = ObjCClass('WKWebsiteDataStore').defaultDataStore()
            config.allowsInlineMediaPlayback = True
            config.allowsAirPlayForMediaPlayback = True
            config.mediaTypesRequiringUserActionForPlayback = 0
            self.native = TogaWebView.alloc().initWithFrame(((0, 0), (0, 0)), configuration=config)
            self.native.interface = self.interface
            self.native.impl = self
            self.native.inspectable = False
            self.native.navigationDelegate = self.native
            self.native.UIDelegate = self.native
            self.loaded_future = None
            self.add_constraints()

    factory.WebView = InlineWebView


def configure_audio():
    session = ObjCClass('AVAudioSession').sharedInstance()
    if not session.setCategory('AVAudioSessionCategoryPlayback', error=None):
        raise RuntimeError('无法配置系统音频会话')
    return session


def share_file(app, path):
    url = ObjCClass('NSURL').fileURLWithPath(str(path))
    sheet = ObjCClass('UIActivityViewController').alloc().initWithActivityItems(
        ns_from_py([url]), applicationActivities=None)
    presenter = app.main_window._impl.native.rootViewController
    if presenter.presentedViewController:
        raise ValueError('请先关闭当前系统窗口再导出')
    popover = sheet.popoverPresentationController
    if popover:
        popover.sourceView = presenter.view
        popover.sourceRect = presenter.view.bounds
        popover.permittedArrowDirections = 0
    # Retain the callback and controller until the system sheet completes.
    from rubicon.objc import Block

    def completed(activity: objc_id, done: bool, items: objc_id, error: objc_id) -> None:
        app.exports.remove(path)
        app._share_sheet = None
        app._share_completion = None

    app._share_sheet = sheet
    app._share_completion = Block(completed, None, objc_id, bool, objc_id, objc_id)
    sheet.completionWithItemsHandler = app._share_completion
    presenter.presentViewController(sheet, animated=True, completion=None)


def receive_message(app, message):
    marker = app.paths.cache / 'ios-native-message.json'
    marker.write_text('{"received":true}', encoding='utf-8')
    if not send_message(message.frameInfo, 'isMainFrame', restype=c_bool):
        marker.write_text('{"rejected":"subframe"}', encoding='utf-8')
        return
    origin = message.frameInfo.securityOrigin
    if str(origin.protocol) != 'http' or str(origin.host) != '127.0.0.1' or int(origin.port) != app.port:
        marker.write_text('{"rejected":"origin"}', encoding='utf-8')
        return
    value = py_from_ns(message.body)
    if not isinstance(value, dict):
        marker.write_text(json.dumps({'rejected':'body', 'type':type(value).__name__}), encoding='utf-8')
        return
    identifier = value.get('id')
    if (type(identifier) not in (int, float) or not math.isfinite(identifier)
            or identifier != int(identifier) or not 0 <= identifier <= 2**53-1):
        marker.write_text(json.dumps({'rejected':'id', 'type':type(identifier).__name__}), encoding='utf-8')
        return
    value['id'] = int(identifier)
    args = value.get('args')
    if isinstance(args, dict):
        for key in ('playing', 'hasTrack'):
            if type(args.get(key)) in (int, float) and args[key] in (0, 1):
                args[key] = bool(args[key])
        for key in ('size', 'offset'):
            number = args.get(key)
            if type(number) in (int, float) and math.isfinite(number) and number == int(number):
                args[key] = int(number)
    app.handle_bridge(value)
    marker.write_text('{"dispatched":true}', encoding='utf-8')
