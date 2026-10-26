"""An edge-to-edge player window, without Toga's application title bar.

This only controls our own UIKit content. iPadOS retains control of windowed
multitasking and its system window controls; no fixed-screen compatibility mode
is used, so the existing layout monitor can continue to follow window resizing.
"""
import json


def configure_factory():
    """Install before constructing the main window (Toga iOS is pinned to 0.5.3)."""
    from rubicon.objc import ObjCClass, objc_method
    from toga_iOS import factory
    from toga_iOS.container import Container, RootContainer
    from toga_iOS.window import MainWindow

    global _FullscreenController
    if '_FullscreenController' not in globals():
        class MineradioPlayerController(ObjCClass('UIViewController')):
            @objc_method
            def prefersStatusBarHidden(self) -> bool:
                return True

            @objc_method
            def prefersHomeIndicatorAutoHidden(self) -> bool:
                return True

        _FullscreenController = MineradioPlayerController

    class FullscreenContainer(RootContainer):
        def __init__(self, **kwargs):
            # RootContainer.__init__ first attaches the view to a different
            # UIViewController. UIKit rejects assigning an already-owned root
            # view to a second controller, so create its sole owner directly.
            Container.__init__(self, **kwargs)
            self.controller = _FullscreenController.alloc().init()
            self.controller.view = self.native
            self.native.backgroundColor = ObjCClass('UIColor').blackColor

        @property
        def top_offset(self):
            # Toga's normal NavigationContainer reserves the navigation and
            # status bar heights even after hiding its native navigation bar.
            return 0

    class FullscreenMainWindow(MainWindow):
        def create_container(self):
            self.container = FullscreenContainer(on_refresh=self.content_refreshed)

        def set_title(self, title):
            # Core Toga replaces an empty title with its application name.
            self.container.title = ''

    factory.MainWindow = FullscreenMainWindow


def configure_webview(view):
    """Match the blank launch surface and avoid a second native safe-area inset."""
    from rubicon.objc import ObjCClass
    view.opaque = False
    view.backgroundColor = ObjCClass('UIColor').blackColor
    view.scrollView.backgroundColor = ObjCClass('UIColor').blackColor
    # The webpage already uses viewport-fit=cover and CSS safe-area insets for
    # its controls. Automatic UIScrollView insets would shrink it a second time.
    view.scrollView.contentInsetAdjustmentBehavior = 2  # Never


def write_diagnostic(app):
    """Expose actual UIKit geometry for the installed simulator/device checks."""
    from ctypes import c_bool, c_long
    from rubicon.objc.runtime import send_message
    from rubicon.objc.types import CGRect
    window = app.main_window._impl.native
    controller = window.rootViewController
    container = app.main_window._impl.container
    web = app.web._impl.native

    def rect(value):
        return dict(x=round(float(value.origin.x), 2), y=round(float(value.origin.y), 2),
                    width=round(float(value.size.width), 2), height=round(float(value.size.height), 2))

    data = dict(title=str(controller.title or ''), togaTitle=str(app.main_window.title or ''),
                navigationBarPresent=bool(hasattr(controller, 'navigationBar') or controller.navigationController),
                statusBarHiddenRequested=bool(send_message(controller, 'prefersStatusBarHidden', restype=c_bool)),
                homeIndicatorAutoHiddenRequested=bool(send_message(controller, 'prefersHomeIndicatorAutoHidden', restype=c_bool)),
                contentTopOffset=float(container.top_offset),
                window=rect(send_message(window, 'bounds', restype=CGRect)),
                content=rect(send_message(container.native, 'bounds', restype=CGRect)),
                webView=rect(send_message(web, 'frame', restype=CGRect)),
                automaticWebInsets=int(send_message(web.scrollView, 'contentInsetAdjustmentBehavior', restype=c_long)),
                fullScreenPolicy='fill-current-window')
    app.paths.cache.mkdir(parents=True, exist_ok=True)
    (app.paths.cache / 'ios-presentation-diagnostic.json').write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return data
