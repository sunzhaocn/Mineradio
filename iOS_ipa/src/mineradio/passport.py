"""Isolated, cancellable WebKit host for the pinned official Passport wrapper.

The public synchronous facade is for backend HTTP threads. install(app) and
diagnostic() run on the UI loop. No private WKWebView HTTP interception API,
external browser, subprocess, account file or shared website data store is used.
"""
import asyncio
import base64
import concurrent.futures
from ctypes import c_bool, c_double, c_long
import json
import math
from pathlib import Path
import re
import secrets
import threading
import urllib.parse

HOST = 'https://api.qishui.com'
COOKIE_HOSTS = frozenset({'qishui.com', 'api.qishui.com', 'www.qishui.com', 'bff-pc.qishui.com'})
REQUEST_HOSTS = COOKIE_HOSTS - {'qishui.com'}
RESOURCE_SUFFIXES = ('qishui.com', 'snssdk.com', 'zijieapi.com', 'douyin.com',
                     'bytedance.com', 'byteimg.com', 'bytedstatic.com', 'bytetos.com',
                     'bytegoofy.com', 'yhgfb-cn-static.com', 'bytescm.com')
ASSET_NAMES = ('security_seed.html', 'security_host.html', 'bdms.js', 'sdk-glue.js',
               'react.js', 'react-dom.js', 'verify-sdk.js', 'phone-security.js')
MAX_MESSAGE = 2 * 1024 * 1024
_host = None
_delegate_class = None


def allowed_request_url(value):
    try:
        url = urllib.parse.urlsplit(value)
        return (url.scheme == 'https' and url.hostname in REQUEST_HOSTS
                and url.port in (None, 443) and not url.username and not url.password
                and not url.fragment)
    except (ValueError, TypeError):
        return False


def allowed_resource_url(value):
    try:
        url = urllib.parse.urlsplit(value)
        return (url.scheme == 'https' and url.port in (None, 443)
                and not url.username and not url.password and bool(url.hostname)
                and any(url.hostname == host or url.hostname.endswith('.' + host)
                        for host in RESOURCE_SUFFIXES))
    except (ValueError, TypeError):
        return False


def build_security_html(assets, token):
    """Inline verified assets because public WKURLSchemeHandler cannot serve HTTPS.

    SDK-inserted pinned bdms scripts are mapped to the same bundled bytes using
    a data-script URL. Other network resources retain normal WebKit security.
    Caller verifies the upstream archive before placing these files in bundle/.
    """
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,510}={0,2}', token):
        raise ValueError('Invalid security token')
    for name in ASSET_NAMES:
        if not isinstance(assets.get(name), bytes) or not 0 < len(assets[name]) < MAX_MESSAGE:
            raise ValueError('Missing or invalid Passport asset')
    body = assets['security_host.html'].decode('utf-8')
    def script(text):
        return '<script>' + text.replace('</script', '<\\/script') + '</script>'
    for name in ('react.js', 'react-dom.js', 'sdk-glue.js'):
        marker = '<script src="' + name + '"></script>'
        if marker not in body:
            raise ValueError('Unexpected Passport wrapper structure')
        body = body.replace(marker, script(assets[name].decode('utf-8')), 1)
    bdms = 'data:text/javascript;base64,' + base64.b64encode(assets['bdms.js']).decode('ascii')
    prelude = r'''
window.__qishuiIOSOrigin=location.origin;
localStorage.setItem('xmst',TOKEN);localStorage.setItem('xmsty',TOKEN);
(function(){
 const bundled=BDMS;
 const pinned=/^https:\/\/(?:lf-headquarters-speed\.yhgfb-cn-static\.com|lf-c-flwb\.bytetos\.com)\/obj\/rc-client-security\/web\/stable\/1\.0\.0\.41\/bdms\.js(?:\?.*)?$/;
 const redirect=node=>{if(node&&node.tagName==='SCRIPT'&&pinned.test(node.src))node.src=bundled;return node;};
 const append=Node.prototype.appendChild,insert=Node.prototype.insertBefore;
 Node.prototype.appendChild=function(node){return append.call(this,redirect(node));};
 Node.prototype.insertBefore=function(node,before){return insert.call(this,redirect(node),before);};
 window.__qishuiIOSAllowedResource=function(value){
   try{const u=new URL(String(value),location.href),hosts=HOSTS;
     return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&
       hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));
   }catch(_){return false;}
 };
})();
'''.replace('TOKEN', json.dumps(token)).replace('BDMS', json.dumps(bdms)).replace('HOSTS', json.dumps(RESOURCE_SUFFIXES))
    body = body.replace('<head>', '<head>' + script(prelude), 1)
    needle = "function loadVerifyScript(url) {"
    if needle not in body:
        raise ValueError('Missing Passport verification entry')
    body = body.replace(needle, needle + "\nif(!window.__qishuiIOSAllowedResource(url))return Promise.reject(new Error('验证组件地址不受支持'));", 1)
    body = body.replace('</body>', script(assets['verify-sdk.js'].decode('utf-8')) +
                        script(assets['phone-security.js'].decode('utf-8')) + '</body>', 1)
    body = body.replace('window.__qishuiCancelSecondVerify()',
        'window.__qishuiCancelPhoneVerify();window.__qishuiCancelSecondVerify()')
    return body


def install(app):
    """Call once on the app UI loop, before enabling Qishui login routes."""
    global _host
    if _host is not None and _host.app is app:
        return _host
    if _host is not None:
        raise RuntimeError('Passport host is already installed')
    _host = _Host(app, asyncio.get_running_loop())
    return _host


def _submit(coroutine, timeout=40):
    if _host is None:
        coroutine.close()
        raise RuntimeError('Passport UI host is not installed')
    if threading.get_ident() == _host.ui_thread:
        coroutine.close()
        raise RuntimeError('Synchronous Passport calls cannot run on the UI thread')
    future = asyncio.run_coroutine_threadsafe(coroutine, _host.loop)
    try:
        return future.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        future.cancel()
        raise TimeoutError('Passport operation timed out') from None


def open(key, token):
    if _host is None:
        raise RuntimeError('Passport UI host is not installed')
    return _submit(_host.open(key, token))


def call(key, method, payload=None):
    if _host is None:
        raise RuntimeError('Passport UI host is not installed')
    return _submit(_host.call(key, method, payload), timeout=35)


def show(key):
    """Present verification only in response to the user's explicit open action."""
    if _host is None:
        raise RuntimeError('Passport UI host is not installed')
    return _submit(_host.show(key), timeout=10)


def close(key):
    if _host is not None:
        asyncio.run_coroutine_threadsafe(_host.close(key), _host.loop)


async def diagnostic():
    """No QR request or account access. Return readiness and origin, not fingerprint."""
    if _host is None:
        raise RuntimeError('Passport UI host is not installed')
    if _host.active is not None:
        raise RuntimeError('Do not run diagnostics while a Passport login is active')
    key = secrets.token_hex(16)
    try:
        info = await _host.open(key, secrets.token_urlsafe(88) + '==')
        origin = _host.active.origin
        checks = await _host.active.evaluate('''({
          phoneVerificationBridge:typeof window.__qishuiPhoneVerify==='function',
          captchaSDK:!!(window.verifySDK&&typeof window.verifySDK.autoRender==='function')
        })''')
        await _host.active.call('set_cookies', [dict(name='mineradio_build_probe', value='synthetic',
                                                   domain='api.qishui.com', path='/')])
        cookies = await _host.active.cookies()
        cookie_store = any(c['name'] == 'mineradio_build_probe' and c['value'] == 'synthetic' for c in cookies)
        return dict(ready=bool(checks.get('phoneVerificationBridge') and checks.get('captchaSDK') and cookie_store),
                    browserInfoPresent=bool(info), securityOrigin=origin, cookieStoreRoundTrip=cookie_store,
                    **checks)
    finally:
        await _host.close(key)


class _Host:
    def __init__(self, app, loop):
        self.app, self.loop = app, loop
        self.ui_thread = threading.get_ident()
        self.active = None
        self.generation = 0

    async def open(self, key, token):
        self.generation += 1
        generation = self.generation
        if self.active:
            self.active.close()
        flow = _Flow(self.app, key, token)
        self.active = flow
        try:
            info = await flow.start()
            if generation != self.generation or self.active is not flow:
                raise RuntimeError('Passport flow was superseded')
            return info
        except BaseException:
            flow.close()
            if self.active is flow:
                self.active = None
            raise

    def select(self, key):
        if not self.active or self.active.closed or self.active.key != key:
            raise RuntimeError('Passport flow is closed')
        return self.active

    async def call(self, key, method, payload):
        return await self.select(key).call(method, payload)

    async def show(self, key):
        self.select(key).show()
        return True

    async def close(self, key):
        if self.active and self.active.key == key:
            self.active.close()
            self.active = None


def _native_delegate():
    global _delegate_class
    if _delegate_class is not None:
        return _delegate_class
    from rubicon.objc import ObjCClass, ObjCBlock, objc_method, objc_property
    from rubicon.objc.runtime import load_library
    load_library('WebKit')
    ObjCClass('WKWebView')
    class MineradioPassportDelegate(ObjCClass('NSObject')):
        owner = objc_property(object, weak=True)

        @objc_method
        def webView_didFinishNavigation_(self, view, navigation) -> None:
            flow = self.owner
            if flow and not flow.loaded.done():
                flow.loaded.set_result(True)

        @objc_method
        def webView_didFailProvisionalNavigation_withError_(self, view, navigation, error) -> None:
            flow = self.owner
            if flow and not flow.loaded.done():
                flow.loaded.set_exception(RuntimeError('Passport document could not load'))

        @objc_method
        def webView_decidePolicyForNavigationAction_decisionHandler_(self, view, action, completion) -> None:
            from rubicon.objc.runtime import send_message
            flow = self.owner
            try:
                frame = action.targetFrame
                main = frame is None or send_message(frame, 'isMainFrame', restype=c_bool)
                target = str(action.request.URL.absoluteString)
                allowed = bool(flow and not flow.closed and (
                    target == 'about:blank' or target.startswith(flow.base) or
                    (not main and allowed_resource_url(target))))
            except Exception:
                allowed = False
            ObjCBlock(completion, None, c_long)(1 if allowed else 0)

        @objc_method
        def userContentController_didReceiveScriptMessage_(self, controller, message) -> None:
            flow = self.owner
            if flow and not flow.closed:
                _receive(flow, message)

        @objc_method
        def closePassport_(self, sender) -> None:
            flow = self.owner
            if flow:
                flow.hide()

    _delegate_class = MineradioPassportDelegate
    return _delegate_class


def _receive(flow, message):
    from rubicon.objc import py_from_ns
    from rubicon.objc.runtime import send_message
    try:
        if not send_message(message.frameInfo, 'isMainFrame', restype=c_bool):
            return
        frame_url = str(message.frameInfo.request.URL.absoluteString)
        if frame_url != 'about:blank' and not frame_url.startswith(flow.base):
            return
        value = py_from_ns(message.body)
        if not isinstance(value, dict):
            return
        identifier, raw = value.get('id'), value.get('value')
        if (type(identifier) not in (int, float) or not math.isfinite(identifier)
                or int(identifier) != identifier or not isinstance(raw, str) or len(raw) > MAX_MESSAGE):
            return
        future = flow.pending.pop(int(identifier), None)
        if future and not future.done():
            future.set_result(json.loads(raw))
    except Exception:
        # Never log messages: Passport request results include account secrets.
        return


def _cookie_expiration(cookie):
    """NSDate.timeIntervalSince1970 has the NSTimeInterval/Double return ABI.

    Calling selectors explicitly also works when Rubicon resolves a readonly
    getter as ObjCBoundMethod instead of an automatically evaluated property.
    Apple: documentation/foundation/nsdate/timeintervalsince1970 and
    documentation/foundation/timeinterval.
    """
    from rubicon.objc import ObjCInstance, objc_id
    from rubicon.objc.runtime import send_message
    reference = send_message(cookie, 'expiresDate', restype=objc_id)
    if not reference:
        return -1
    date = ObjCInstance(reference)
    return float(send_message(date, 'timeIntervalSince1970', restype=c_double))


class _Flow:
    def __init__(self, app, key, token):
        if not re.fullmatch('[0-9a-f]{32}', key):
            raise ValueError('Invalid Passport session key')
        self.app, self.key, self.token = app, key, token
        self.base = HOST + '/_mineradio_passport_' + key + '/'
        self.loaded = asyncio.get_running_loop().create_future()
        self.pending = {}
        self.serial = 0
        self.closed = False
        self.origin = ''
        self.presentation = None
        self.view = self.delegate = None

    async def start(self):
        from rubicon.objc import ObjCClass
        config = ObjCClass('WKWebViewConfiguration').alloc().init()
        config.websiteDataStore = ObjCClass('WKWebsiteDataStore').nonPersistentDataStore()
        config.preferences.javaScriptCanOpenWindowsAutomatically = False
        self.view = ObjCClass('WKWebView').alloc().initWithFrame(
            ((-2000, -2000), (980, 760)), configuration=config)
        self.view.inspectable = False
        from music_app.auth.qishui.common import USER_AGENT
        self.view.customUserAgent = USER_AGENT
        self.delegate = _native_delegate().alloc().init()
        self.delegate.owner = self
        self.view.navigationDelegate = self.delegate
        self.view.configuration.userContentController.addScriptMessageHandler(
            self.delegate, name='mineradioPassport')
        self.container = self.app.main_window._impl.native.rootViewController.view
        self.container.addSubview(self.view)
        self.view.alpha = 0.01
        directory = Path(__file__).parent / 'bundle/passport'
        assets = {name: (directory / name).read_bytes() for name in ASSET_NAMES}
        html = build_security_html(assets, self.token)
        self.view.loadHTMLString(html, baseURL=ObjCClass('NSURL').URLWithString(self.base))
        await asyncio.wait_for(self.loaded, timeout=15)
        info = await self.evaluate('''(async()=>{
          for(let n=0;n<100;n++){
            if(window.bdms&&window._sdkGlueVersionMap&&window._sdkGlueVersionMap.bdmsVersion){
              const v=await window.__qishuiBrowserInfo();
              return {encrypted:v.encrypted,origin:location.origin};
            }
            await new Promise(r=>setTimeout(r,200));
          }
          throw new Error('Passport initialization timeout');
        })()''', timeout=25)
        if not isinstance(info, dict) or not isinstance(info.get('encrypted'), str) or not info['encrypted']:
            raise RuntimeError('Passport fingerprint was not initialized')
        self.origin = str(info.get('origin') or '')
        return info['encrypted']

    async def evaluate(self, expression, timeout=30):
        if self.closed:
            raise RuntimeError('Passport flow is closed')
        self.serial += 1
        identifier = self.serial
        future = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        script = '''(function(){Promise.resolve(EXPRESSION).then(value=>{
          window.webkit.messageHandlers.mineradioPassport.postMessage({id:IDENTIFIER,value:JSON.stringify(value===undefined?null:value)});
        }).catch(()=>{window.webkit.messageHandlers.mineradioPassport.postMessage({id:IDENTIFIER,value:'null'});});return true;})()'''
        script = script.replace('EXPRESSION', expression).replace('IDENTIFIER', str(identifier))
        from rubicon.objc import Block, objc_id
        def completed(result: objc_id, error: objc_id) -> None:
            if error and not future.done():
                future.set_exception(RuntimeError('Passport script evaluation failed'))
        callback = Block(completed, None, objc_id, objc_id)
        try:
            self.view.evaluateJavaScript(script, completionHandler=callback)
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self.pending.pop(identifier, None)

    async def cookies(self):
        from rubicon.objc import Block, objc_id, py_from_ns
        from rubicon.objc.runtime import send_message
        future = asyncio.get_running_loop().create_future()
        def completed(values: objc_id) -> None:
            result = []
            try:
                for cookie in py_from_ns(values):
                    domain = str(cookie.domain)
                    if domain.lstrip('.').lower() not in COOKIE_HOSTS:
                        continue
                    result.append(dict(name=str(cookie.name), value=str(cookie.value), domain=domain,
                        path=str(cookie.path), secure=bool(send_message(cookie, 'isSecure', restype=c_bool)),
                        httpOnly=bool(send_message(cookie, 'isHTTPOnly', restype=c_bool)),
                        expires=_cookie_expiration(cookie)))
                if not future.done():
                    future.set_result(result)
            except Exception:
                if not future.done():
                    future.set_exception(RuntimeError('Passport cookies could not be read'))
        callback = Block(completed, None, objc_id)
        self.view.configuration.websiteDataStore.httpCookieStore.getAllCookies(callback)
        return await asyncio.wait_for(future, timeout=5)

    async def call(self, method, payload):
        if method == 'set_cookies':
            # Only credentials returned by this flow's official response are
            # accepted by the Python adapter. Never use the shared cookie store.
            if not isinstance(payload, list) or len(payload) > 100:
                raise ValueError('Invalid Passport cookies')
            from rubicon.objc import ObjCClass, Block, ns_from_py, objc_const
            from rubicon.objc.runtime import load_library
            foundation = load_library('Foundation')
            store = self.view.configuration.websiteDataStore.httpCookieStore
            for value in payload:
                if (not isinstance(value, dict) or value.get('domain', '').lstrip('.') not in COOKIE_HOSTS
                        or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}", value.get('name', ''))
                        or not isinstance(value.get('value'), str) or not value['value'] or len(value['value']) > 65536
                        or any(ord(c) < 32 or ord(c) == 127 for c in value['value'])
                        or value.get('path') != '/'):
                    raise ValueError('Invalid Passport cookie')
                properties = {
                    str(objc_const(foundation, 'NSHTTPCookieName')): value['name'],
                    str(objc_const(foundation, 'NSHTTPCookieValue')): value['value'],
                    str(objc_const(foundation, 'NSHTTPCookieDomain')): value['domain'],
                    str(objc_const(foundation, 'NSHTTPCookiePath')): '/',
                    str(objc_const(foundation, 'NSHTTPCookieSecure')): 'TRUE',
                    'HttpOnly': 'TRUE',
                }
                cookie = ObjCClass('NSHTTPCookie').cookieWithProperties(ns_from_py(properties))
                if not cookie:
                    raise ValueError('Invalid Passport cookie')
                future = asyncio.get_running_loop().create_future()
                def completed() -> None:
                    if not future.done():
                        future.set_result(True)
                callback = Block(completed, None)
                store.setCookie(cookie, completionHandler=callback)
                await asyncio.wait_for(future, timeout=5)
            return True
        if method == 'request':
            if not isinstance(payload, dict) or not allowed_request_url(payload.get('url')):
                raise ValueError('Passport request URL is not allowed')
            target = urllib.parse.urlsplit(payload['url'])
            value = json.dumps(payload, ensure_ascii=True)
            token = json.dumps(self.token)
            path = json.dumps(target.path)
            expression = '''(async()=>{
              const since=performance.now(), result=await window.__qishuiRequest(PAYLOAD);
              const names=[result.responseURL,...performance.getEntriesByType('resource').filter(e=>e.startTime>=since).map(e=>e.name)];
              let length=0,matches=false;
              for(const name of names){try{const u=new URL(name);if(u.hostname==='api.qishui.com'&&u.pathname===PATH){
                const a=u.searchParams.get('a_bogus')||'';
                if(a.length>length){length=a.length;matches=u.searchParams.get('msToken')===TOKEN;}
              }}catch(_){}}
              result._aBogusLength=length;result._msTokenMatches=matches;return result;
            })()'''.replace('PAYLOAD', value).replace('PATH', path).replace('TOKEN', token)
            result = await self.evaluate(expression)
            if not isinstance(result, dict):
                raise RuntimeError('Passport request failed')
            result['cookies'] = await self.cookies()
            return result
        if method == 'verify_start':
            if not isinstance(payload, dict):
                raise ValueError('Invalid verification input')
            decision = payload.get('decision')
            if not isinstance(decision, dict):
                raise ValueError('Invalid verification decision')
            if decision.get('url') and not allowed_resource_url(decision['url']):
                raise ValueError('Verification resource URL is not allowed')
            return await self.evaluate('''(()=>{window.__authMfaResult=null;const spec=PAYLOAD;
                (spec.phone?window.__qishuiPhoneVerify:window.__qishuiSecondVerify)(spec.decision,spec.options).then(value=>window.__authMfaResult=value)
                .catch(()=>window.__authMfaResult={status:false});return true;})()'''.replace(
                    'PAYLOAD', json.dumps(payload, ensure_ascii=True)))
        if method == 'verify_status':
            return await self.evaluate('window.__authMfaResult||null')
        raise ValueError('Unsupported Passport operation')

    def show(self):
        if self.closed:
            raise RuntimeError('Passport flow is closed')
        if self.presentation:
            return
        from rubicon.objc import ObjCClass
        from rubicon.objc.runtime import SEL
        presenter = self.app.main_window._impl.native.rootViewController
        if presenter.presentedViewController:
            raise RuntimeError('Close the current system window first')
        controller = ObjCClass('UIViewController').alloc().init()
        controller.title = '汽水音乐安全验证'
        self.view.removeFromSuperview()
        self.view.alpha = 1
        self.view.frame = controller.view.bounds
        self.view.autoresizingMask = 18
        controller.view.addSubview(self.view)
        button = ObjCClass('UIBarButtonItem').alloc().initWithBarButtonSystemItem(
            0, target=self.delegate, action=SEL('closePassport:'))
        controller.navigationItem.rightBarButtonItem = button
        navigation = ObjCClass('UINavigationController').alloc().initWithRootViewController(controller)
        navigation.modalInPresentation = True
        self.presentation = navigation
        presenter.presentViewController(navigation, animated=True, completion=None)

    def hide(self):
        if self.presentation:
            self.presentation.dismissViewControllerAnimated(True, completion=None)
            self.presentation = None
        if self.view and not self.closed:
            self.view.removeFromSuperview()
            self.view.frame = ((-2000, -2000), (980, 760))
            self.view.alpha = 0.01
            self.container.addSubview(self.view)

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.presentation:
            self.presentation.dismissViewControllerAnimated(False, completion=None)
            self.presentation = None
        if self.view:
            self.view.stopLoading()
            self.view.configuration.userContentController.removeScriptMessageHandlerForName('mineradioPassport')
            self.view.navigationDelegate = None
            self.view.removeFromSuperview()
        if not self.loaded.done():
            self.loaded.cancel()
        for future in tuple(self.pending.values()):
            if not future.done():
                future.cancel()
        self.pending.clear()
        self.delegate = self.view = None
