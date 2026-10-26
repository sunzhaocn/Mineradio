"""iOS Now Playing, remote controls, interruptions and foreground notifications.

Install on the UI thread after creating the WebView and before loading its URL.
The injected native-media flag makes the JS adapter use this bridge exclusively;
if installation fails, the existing Web Media Session remains the fallback.
"""
import asyncio
import base64
import ctypes as ct
import json
import math


def _finite(value, default=0):
    try:
        value = float(value)
        return value if math.isfinite(value) else default
    except (ValueError, TypeError):
        return default


async def _evaluate(app, source):
    try:
        await app.web.evaluate_javascript(source)
    except Exception:
        pass  # WebKit may be replacing its document while the app is restored.


class SystemMedia:
    def __init__(self, app):
        from rubicon.objc import ObjCClass, ObjCInstance, Block, objc_const, ns_from_py
        from rubicon.objc.runtime import load_library
        from rubicon.objc.runtime import send_message
        from rubicon.objc import objc_id
        self.send_message, self.objc_id = send_message, objc_id
        self.app, self.loop = app, asyncio.get_event_loop()
        self.ObjCClass, self.ObjCInstance, self.Block, self.ns_from_py = ObjCClass, ObjCInstance, Block, ns_from_py
        self.media = load_library('MediaPlayer')
        self.audio = load_library('AVFAudio')
        self.ui = load_library('UIKit')
        self.constant = lambda library, name: str(objc_const(library, name))
        self.center = ObjCInstance(send_message(ObjCClass('MPNowPlayingInfoCenter'),'defaultCenter',restype=objc_id))
        self.commands = ObjCInstance(send_message(ObjCClass('MPRemoteCommandCenter'),'sharedCommandCenter',restype=objc_id))
        self.audio_session = app.audio_session
        self.playing, self.active, self.ever_played = False, False, False
        application = send_message(ObjCClass('UIApplication'), 'sharedApplication', restype=objc_id)
        self.foreground = int(send_message(application, 'applicationState', restype=ct.c_long)) == 0
        self.artwork_key, self.artwork, self.artwork_callback, self.artwork_image = '', None, None, None
        self.targets, self.callbacks, self.notification_names = [], [], []
        self.keys = {name:self.constant(self.media, name) for name in (
            'MPMediaItemPropertyTitle', 'MPMediaItemPropertyArtist', 'MPMediaItemPropertyAlbumTitle',
            'MPMediaItemPropertyPlaybackDuration', 'MPMediaItemPropertyArtwork',
            'MPNowPlayingInfoPropertyElapsedPlaybackTime', 'MPNowPlayingInfoPropertyPlaybackRate',
            'MPNowPlayingInfoPropertyDefaultPlaybackRate')}

    def schedule(self, action, value=0):
        source = 'window.mineradioIOSAction && window.mineradioIOSAction(' + ','.join(
            json.dumps(item, ensure_ascii=True) for item in (action, value)) + ')'
        self.loop.call_soon_threadsafe(lambda:self.loop.create_task(_evaluate(self.app, source)))

    def set_foreground(self, active):
        self.foreground = bool(active)
        source = 'window.mineradioIOSSetForeground && window.mineradioIOSSetForeground(' + (
            'true' if active else 'false') + ')'
        self.loop.call_soon_threadsafe(lambda:self.loop.create_task(_evaluate(self.app, source)))

    def _command(self, command, action, *, seek=False):
        command.enabled = True
        def callback(event) -> int:
            try:
                value = _finite(self.send_message(event, 'positionTime', restype=ct.c_double)) if seek else 0
                self.schedule(action, value)
                return 0  # MPRemoteCommandHandlerStatusSuccess
            except Exception:
                return 200  # MPRemoteCommandHandlerStatusCommandFailed
        block = self.Block(callback, ct.c_long, ct.c_void_p)
        self.callbacks.append(block)
        self.targets.append((command, command.addTargetWithHandler(block)))

    def register_commands(self):
        for getter, action in (('playCommand','play'), ('pauseCommand','pause'),
                               ('nextTrackCommand','next'), ('previousTrackCommand','previous'),
                               ('changePlaybackPositionCommand','seek')):
            command = self.ObjCInstance(self.send_message(self.commands, getter, restype=self.objc_id))
            self._command(command, action, seek=action=='seek')

    def _artwork(self, value):
        if value == self.artwork_key:
            return
        self.artwork_key, self.artwork, self.artwork_callback, self.artwork_image = value, None, None, None
        if not isinstance(value, str) or not value.startswith('data:image/jpeg;base64,') or len(value)>2*1024*1024:
            return
        try:
            raw = base64.b64decode(value.split(',',1)[1], validate=True)
            buffer = ct.create_string_buffer(raw)
            data = self.ObjCClass('NSData').dataWithBytes(buffer, length=len(raw))
            image = self.ObjCClass('UIImage').imageWithData(data)
            if image is None or not (0<image.size.width<=512 and 0<image.size.height<=512):
                return
            from rubicon.objc.types import CGSize
            def artwork_image(size):
                return image.ptr.value
            callback = self.Block(artwork_image, ct.c_void_p, CGSize)
            artwork = self.ObjCClass('MPMediaItemArtwork').alloc().initWithBoundsSize(image.size,
                requestHandler=callback)
            self.artwork_image, self.artwork_callback, self.artwork = image, callback, artwork
        except (ValueError, TypeError, AttributeError):
            pass

    def playback(self, data):
        if not isinstance(data, dict):
            raise ValueError('Invalid playback metadata')
        playing = data.get('playing') is True
        self.ever_played = self.ever_played or playing
        if not self.ever_played and not data.get('hasTrack'):
            return
        # Opening the app does not activate a nonmixing audio session. Activation
        # follows actual playback, matching the Android WebView focus behavior.
        if playing and not self.active:
            if not self.audio_session.setActive(True, error=None):
                raise RuntimeError('Audio session activation failed')
            self.active = True
        elif not playing and self.active:
            # AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation = 1.
            if self.audio_session.setActive(False, withOptions=1, error=None):
                self.active = False
        self.playing = playing
        self._artwork(data.get('artwork') or '')
        duration = max(0,_finite(data.get('duration')))
        position = max(0,_finite(data.get('position')))
        if duration:
            position = min(position,duration)
        rate = max(.1,min(4,_finite(data.get('rate'),1))) if playing else 0
        metadata = {
            self.keys['MPMediaItemPropertyTitle']:str(data.get('title') or 'Mineradio')[:512],
            self.keys['MPMediaItemPropertyArtist']:str(data.get('artist') or '')[:512],
            self.keys['MPMediaItemPropertyAlbumTitle']:str(data.get('album') or '')[:512],
            self.keys['MPMediaItemPropertyPlaybackDuration']:duration,
            self.keys['MPNowPlayingInfoPropertyElapsedPlaybackTime']:position,
            self.keys['MPNowPlayingInfoPropertyPlaybackRate']:rate,
            self.keys['MPNowPlayingInfoPropertyDefaultPlaybackRate']:1.0,
        }
        if self.artwork is not None:
            metadata[self.keys['MPMediaItemPropertyArtwork']] = self.artwork
        self.center.nowPlayingInfo = self.ns_from_py(metadata)
        self.center.playbackState = 1 if playing else 2

    def interrupted(self, notification):
        from rubicon.objc import py_from_ns
        values = py_from_ns(notification.userInfo) or {}
        key = self.constant(self.audio, 'AVAudioSessionInterruptionTypeKey')
        if int(values.get(key,0)) == 1:
            self.active = False
            self.schedule('pause')
        # Resume remains an explicit user action. A call/assistant interruption
        # must never unexpectedly restart sound after the user paused it.

    def route_changed(self, notification):
        from rubicon.objc import py_from_ns
        values = py_from_ns(notification.userInfo) or {}
        key = self.constant(self.audio, 'AVAudioSessionRouteChangeReasonKey')
        if int(values.get(key,0)) == 2:  # old device unavailable: unplug/disconnect
            self.schedule('pause')

    def register_notifications(self):
        from rubicon.objc import ObjCClass, objc_method, objc_property
        from rubicon.objc.runtime import SEL
        global _ObserverClass
        if '_ObserverClass' not in globals():
            class MineradioSystemMediaObserver(ObjCClass('NSObject')):
                owner = objc_property(object, weak=True)
                @objc_method
                def interruption_(self, notification) -> None:
                    owner = self.owner
                    if owner is not None:
                        owner.interrupted(notification)
                @objc_method
                def routeChanged_(self, notification) -> None:
                    owner = self.owner
                    if owner is not None:
                        owner.route_changed(notification)
                @objc_method
                def foreground_(self, notification) -> None:
                    owner = self.owner
                    if owner is not None:
                        owner.set_foreground(True)
                @objc_method
                def background_(self, notification) -> None:
                    owner = self.owner
                    if owner is not None:
                        owner.set_foreground(False)
            _ObserverClass = MineradioSystemMediaObserver
        self.observer = _ObserverClass.alloc().init()
        self.observer.owner = self
        self.notification_center = self.ObjCInstance(self.send_message(
            ObjCClass('NSNotificationCenter'),'defaultCenter',restype=self.objc_id))
        for library, name, selector in (
            (self.audio,'AVAudioSessionInterruptionNotification','interruption:'),
            (self.audio,'AVAudioSessionRouteChangeNotification','routeChanged:'),
            (self.ui,'UIApplicationDidBecomeActiveNotification','foreground:'),
            (self.ui,'UIApplicationWillResignActiveNotification','background:'),
            (self.ui,'UIApplicationDidEnterBackgroundNotification','background:'),
        ):
            notification = self.constant(library,name)
            self.notification_center.addObserver(self.observer, selector=SEL(selector),
                                                  name=notification, object=None)
            self.notification_names.append(notification)

    def inject(self):
        from rubicon.objc import ObjCClass
        source = 'window.mineradioIOSNativeMedia=true;window.mineradioIOSForeground=' + (
            'true' if self.foreground else 'false') + ';'
        script = ObjCClass('WKUserScript').alloc().initWithSource(source,
            injectionTime=0, forMainFrameOnly=True)
        self.app.web._impl.native.configuration.userContentController.addUserScript(script)

    def close(self):
        for command,target in self.targets:
            command.removeTarget(target)
        self.targets.clear()
        if hasattr(self,'notification_center'):
            self.notification_center.removeObserver(self.observer)


def install(app):
    existing = getattr(app,'system_media',None)
    if existing is not None:
        return existing
    media = SystemMedia(app)
    try:
        media.register_commands()
        media.register_notifications()
        media.inject()
    except Exception:
        media.close()
        raise
    return media
