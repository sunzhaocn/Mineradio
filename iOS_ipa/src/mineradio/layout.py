"""UIKit window-based profiles with in-place viewport changes, never reloads.

Install after assigning the main WebView as window content, before loading URL.
The application owns the returned monitor. Layout polling runs only while UIKit
reports the application active, and never reads SDK or account state.
"""
import asyncio
import ctypes as ct
import json
import math


def configuration(width, height, is_tablet, content_width=None):
    """Return a JSON-safe profile from physical window points, not CSS pixels."""
    width, height = float(width), float(height)
    if not all(math.isfinite(value) and 0 < value <= 10000 for value in (width,height)):
        raise ValueError('Window dimensions must be finite positive points')
    content_width = width if content_width is None else float(content_width)
    if not math.isfinite(content_width) or not 0 < content_width <= 10000:
        raise ValueError('WebView content width must be finite positive points')
    compact = not is_tablet or min(width,height)<600
    viewport = max(320,min(880,round(content_width))) if compact else 1100
    return dict(version=1, deviceFamily='ipad' if is_tablet else 'iphone',
                profile='phone' if compact else 'tablet', bootstrapVisuals=bool(is_tablet),
                windowWidth=round(width,2), windowHeight=round(height,2),
                contentWidth=round(content_width,2), minorDimension=round(min(width,height),2),
                viewportWidth=viewport, scale=round(content_width/viewport,6))


class LayoutMonitor:
    def __init__(self, app):
        from rubicon.objc import ObjCClass, ObjCInstance, objc_id
        from rubicon.objc.runtime import send_message
        from rubicon.objc.types import CGRect
        self.app, self.loop = app, asyncio.get_event_loop()
        self.ObjCClass, self.ObjCInstance = ObjCClass, ObjCInstance
        self.objc_id, self.send_message, self.CGRect = objc_id, send_message, CGRect
        self._task, self._last_key, self.closed = None, None, False

    def measure(self):
        native_window = self.app.main_window._impl.native
        bounds = self.send_message(native_window,'bounds',restype=self.CGRect)
        width,height = float(bounds.size.width),float(bounds.size.height)
        if width<=0 or height<=0:
            screen = self.send_message(self.ObjCClass('UIScreen'),'mainScreen',restype=self.objc_id)
            bounds = self.send_message(screen,'bounds',restype=self.CGRect)
            width,height = float(bounds.size.width),float(bounds.size.height)
        device = self.send_message(self.ObjCClass('UIDevice'),'currentDevice',restype=self.objc_id)
        is_tablet = int(self.send_message(device,'userInterfaceIdiom',restype=ct.c_long))==1
        content_width = width
        view = getattr(self.app,'web',None)
        if view is not None:
            content = self.send_message(view._impl.native,'bounds',restype=self.CGRect)
            if 0 < float(content.size.width) <= width:
                content_width = float(content.size.width)
        return configuration(width,height,is_tablet,content_width)

    def is_active(self):
        application = self.send_message(self.ObjCClass('UIApplication'),'sharedApplication',restype=self.objc_id)
        return int(self.send_message(application,'applicationState',restype=ct.c_long))==0

    def inject_initial(self):
        config = self.measure()
        script = self.ObjCClass('WKUserScript').alloc().initWithSource(
            'window.mineradioIOSLayout='+json.dumps(config,separators=(',',':'))+';',
            injectionTime=0,forMainFrameOnly=True)
        self.app.web._impl.native.configuration.userContentController.addUserScript(script)
        return config

    def resume(self):
        self.loop.call_soon_threadsafe(self._resume_on_ui)

    def _resume_on_ui(self):
        if self.closed:
            return
        self._last_key = None
        if self._task is None or self._task.done():
            self._task = self.loop.create_task(self._monitor())

    def pause(self):
        self.loop.call_soon_threadsafe(self._pause_on_ui)

    def _pause_on_ui(self):
        current,self._task = self._task,None
        if current is not None and not current.done():
            current.cancel()

    async def _monitor(self):
        own_task = asyncio.current_task()
        try:
            while not self.closed:
                # A second check also handles a missed UIKit notification.
                if not self.is_active():
                    return
                try:
                    config = self.measure()
                except Exception as error:
                    # UIKit can briefly replace/resize the window surface.
                    # Keep the active monitor recoverable; startup injection
                    # still fails loudly if there is no initial geometry.
                    self.last_measure_error = type(error).__name__
                    await asyncio.sleep(.4)
                    continue
                key = json.dumps(config,sort_keys=True,separators=(',',':'))
                if key != self._last_key:
                    script = 'window.mineradioIOSApplyLayout ? window.mineradioIOSApplyLayout('+key+') : false'
                    try:
                        applied = await self.app.web.evaluate_javascript(script)
                        if applied:
                            self._last_key = key
                            from . import presentation
                            presentation.write_diagnostic(self.app)
                    except Exception:
                        pass  # The initial document can still be loading.
                await asyncio.sleep(.4)
        finally:
            if self._task is own_task:
                self._task = None

    def register_notifications(self):
        from rubicon.objc import ObjCClass, objc_method, objc_property, objc_const
        from rubicon.objc.runtime import load_library, SEL
        global _ObserverClass
        if '_ObserverClass' not in globals():
            class MineradioLayoutObserver(ObjCClass('NSObject')):
                owner=objc_property(object,weak=True)
                @objc_method
                def active_(self,notification) -> None:
                    owner=self.owner
                    if owner is not None:
                        owner.resume()
                @objc_method
                def inactive_(self,notification) -> None:
                    owner=self.owner
                    if owner is not None:
                        owner.pause()
            _ObserverClass=MineradioLayoutObserver
        self.observer=_ObserverClass.alloc().init()
        self.observer.owner=self
        self.notification_center=self.ObjCInstance(self.send_message(
            ObjCClass('NSNotificationCenter'),'defaultCenter',restype=self.objc_id))
        ui=load_library('UIKit')
        for name,selector in (('UIApplicationDidBecomeActiveNotification','active:'),
                              ('UIApplicationWillResignActiveNotification','inactive:'),
                              ('UIApplicationDidEnterBackgroundNotification','inactive:')):
            self.notification_center.addObserver(self.observer,selector=SEL(selector),
                name=str(objc_const(ui,name)),object=None)

    def close(self):
        self.closed=True
        self.pause()
        if hasattr(self,'notification_center'):
            self.notification_center.removeObserver(self.observer)


def install(app):
    monitor=LayoutMonitor(app)
    try:
        monitor.inject_initial()
        monitor.register_notifications()
        if monitor.is_active():
            monitor.resume()
    except Exception:
        monitor.close()
        raise
    return monitor
