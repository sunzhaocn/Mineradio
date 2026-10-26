"""Official music login pages, each in one non-persistent WKWebView.

No protocol-generated substitute QR, desktop browser profile, automatic CAPTCHA
handling, or browser security override. Native messages carry response codes and
requested script results; final authorization uses the native cookie store.
"""
import asyncio
import concurrent.futures
from ctypes import c_bool, c_double, c_long
import json
import math
import re
import threading
import urllib.parse

HOME = 'https://music.163.com/'
OFFICIAL_HOSTS = frozenset({'music.163.com', 'reg.163.com', 'dl.reg.163.com', 'id.163.com', 'dun.163.com'})
PROVIDERS = {
    'netease': {'home': HOME, 'title': '网易云音乐官网登录', 'hosts': OFFICIAL_HOSTS,
                'suffixes': ('.music.163.com', '.dun.163.com'), 'message_hosts': ('music.163.com',)},
    'qq': {'home': 'https://y.qq.com/', 'title': 'QQ 音乐官网登录',
           'hosts': frozenset({'y.qq.com', 'graph.qq.com', 'xui.ptlogin2.qq.com',
                    'ssl.ptlogin2.qq.com', 'ssl.ptlogin2.graph.qq.com', 'open.weixin.qq.com'}),
           'suffixes': ('.y.qq.com',), 'message_hosts': ('y.qq.com',)},
    'kugou': {'home': 'https://login-user.kugou.com/login/?appid=1014', 'title': '酷狗音乐官网登录',
              'hosts': frozenset({'kugou.com'}), 'suffixes': ('.kugou.com',),
              'message_hosts': ('kugou.com',)},
}
QR_PATHS = frozenset({'/weapi/login/qrcode/unikey', '/weapi/login/qrcode/client/login'})
MAX_MESSAGE = 2 * 1024 * 1024
USER_AGENT = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
              '(KHTML, like Gecko) Version/17.0 Safari/605.1.15')
_host = None
_delegate_class = None

# Only observe real responses from the site's own two QR operations. Do not
# return their raw bodies, identifiers, URL queries, cookies, or account data.
OBSERVER = r'''(()=>{
 if(location.hostname!=='music.163.com'&&!location.hostname.endsWith('.music.163.com'))return;
 if(window.__mineradioNeteaseObserver)return;window.__mineradioNeteaseObserver=true;
 const routes=['/weapi/login/qrcode/unikey','/weapi/login/qrcode/client/login'];
 function route(value){try{const u=new URL(String(value),location.href);
   return u.protocol==='https:'&&u.hostname==='music.163.com'&&routes.includes(u.pathname)?u.pathname:null;
 }catch(_){return null;}}
 function report(url,status,data){try{const path=route(url);if(!path||!data||typeof data!=='object')return;
   const code=typeof data.code==='string'&&/^\d+$/.test(data.code)?Number(data.code):data.code;
   if(!Number.isInteger(code))return;
   window.webkit.messageHandlers.mineradioNeteaseLogin.postMessage({kind:'response',path:path,status:Number(status),
     code:code,fields:Object.keys(data).filter(k=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)).slice(0,64)});
 }catch(_){}}
 const originalOpen=XMLHttpRequest.prototype.open;
 XMLHttpRequest.prototype.open=function(){this.addEventListener('loadend',function(){try{
   if(!route(this.responseURL))return;
   const data=this.responseType==='json'?this.response:JSON.parse(this.responseText);
   report(this.responseURL,this.status,data);
 }catch(_){}},{once:true});return originalOpen.apply(this,arguments);};
 if(typeof fetch==='function'){const originalFetch=fetch;
   window.fetch=function(){const task=originalFetch.apply(this,arguments);task.then(response=>{
     if(route(response.url))response.clone().json().then(data=>report(response.url,response.status,data)).catch(()=>{});
   }).catch(()=>{});return task;};}
})();'''


def allowed_navigation(value, provider='netease', *, main_frame=True):
    try:
        if not isinstance(value, str) or len(value) > 16384 or re.search(r'[\x00\r\n]', value):
            return False
        url = urllib.parse.urlsplit(value)
        host = url.hostname or ''
        spec = PROVIDERS.get(provider)
        secure = bool(spec and url.scheme == 'https' and host and not url.username and not url.password
                      and url.port in (None, 443))
        # Captcha frames retain the browser's normal SOP and have no native
        # privilege. Main navigation remains inside this provider's login flow.
        return secure and (not main_frame or host in spec['hosts'] or host.endswith(spec['suffixes']))
    except (ValueError, TypeError):
        return False


def allowed_message_url(value, provider='netease'):
    if not allowed_navigation(value, provider):
        return False
    host = urllib.parse.urlsplit(value).hostname or ''
    return any(host == item or host.endswith('.' + item) for item in PROVIDERS[provider]['message_hosts'])


def allowed_cookie_domain(domain, provider='netease'):
    host = str(domain or '').lstrip('.').lower()
    if provider == 'netease':
        return host in ('163.com', 'music.163.com') or host.endswith('.music.163.com')
    if provider == 'qq':
        return host in ('qq.com', 'y.qq.com') or host.endswith('.y.qq.com')
    return provider == 'kugou' and (host == 'kugou.com' or host.endswith('.kugou.com'))


def install(app):
    """Register once on the UI loop; does not open a website or show a window."""
    global _host
    if _host is None:
        _host = _Host(app, asyncio.get_running_loop())
    elif _host.app is not app:
        raise RuntimeError('Official music login host is already installed')


def _submit(operation, key, timeout=30, provider='netease'):
    if _host is None:
        raise RuntimeError('Official music login UI host is not installed')
    if threading.get_ident() == _host.thread:
        raise RuntimeError('Use the official login facade from a backend thread')
    future = asyncio.run_coroutine_threadsafe(_host.perform(operation, key, provider), _host.loop)
    try:
        return future.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        future.cancel()
        raise TimeoutError('Official music login operation timed out') from None


def open(key, provider='netease'):
    return _submit('create', key, timeout=80, provider=provider)


def check(key):
    return _submit('check', key)


def show(key):
    return _submit('show', key, timeout=10)


def close(key):
    if _host:
        asyncio.run_coroutine_threadsafe(_host.perform('close', key), _host.loop)


async def diagnostic(provider):
    """Load public official pages; never enter, return or submit form values."""
    import secrets
    key = secrets.token_hex(16)
    if _host is None:
        return {'pageLoaded': False, 'error': 'host_missing'}
    try:
        created = await _host.perform('create', key, provider)
        flow = _host.active
        # didFinishNavigation waits for subresources too. Public login pages
        # can already be usable while an analytics/image request is pending.
        metadata = {}
        deadline = asyncio.get_running_loop().time() + 35
        while asyncio.get_running_loop().time() < deadline:
            target = _text(_obj(flow.view, 'URL'), 'absoluteString')
            if allowed_message_url(target, provider):
                metadata = await flow.evaluate('''({origin:location.origin,readyState:document.readyState,
                  bodyPresent:!!document.body,passwordInputs:document.querySelectorAll('input[type="password"]').length,
                  formCount:document.forms.length})''', timeout=5) or {}
                if metadata.get('readyState') in ('interactive', 'complete') and metadata.get('bodyPresent'):
                    break
            if flow.page_error:
                break
            await asyncio.sleep(.25)
        loaded = (metadata.get('readyState') in ('interactive', 'complete') and metadata.get('bodyPresent')
                  and type(flow.http_status) is int and 200 <= flow.http_status < 400)
        return dict(pageLoaded=bool(loaded and not flow.page_error), httpStatus=flow.http_status,
                    manualLogin=created.get('manual_login') is True,
                    page=metadata, accountAuthorized=False)
    except Exception as error:
        return {'pageLoaded': False, 'error': type(error).__name__, 'accountAuthorized': False}
    finally:
        await _host.perform('close', key)


def _obj(receiver, selector):
    from rubicon.objc import ObjCInstance, objc_id
    from rubicon.objc.runtime import send_message
    value = send_message(receiver, selector, restype=objc_id)
    return ObjCInstance(value) if value else None


def _text(receiver, selector):
    value = _obj(receiver, selector)
    return str(value) if value is not None else ''


def _frame_url(frame):
    request = _obj(frame, 'request')
    return _text(_obj(request, 'URL'), 'absoluteString') if request else ''


class _Host:
    def __init__(self, app, loop):
        self.app, self.loop = app, loop
        self.thread = threading.get_ident()
        self.active = None

    async def perform(self, operation, key, provider='netease'):
        if not re.fullmatch('[0-9a-f]{32}', key):
            raise ValueError('Invalid official login session key')
        if operation == 'create':
            if provider not in PROVIDERS:
                raise ValueError('Unsupported official music login provider')
            if self.active:
                self.active.close()
            flow = _Flow(self.app, key, provider)
            self.active = flow
            try:
                result = await flow.start()
                if self.active is not flow:
                    raise RuntimeError('Official login session was superseded')
                return result
            except BaseException:
                flow.close()
                if self.active is flow:
                    self.active = None
                raise
        if not self.active or self.active.key != key or self.active.closed:
            if operation in ('check', 'close'):
                return {'closed':True, 'cookies':[]}
            raise RuntimeError('Official login session is closed')
        if operation == 'close':
            self.active.close()
            self.active = None
            return True
        if operation == 'show':
            self.active.show()
            return True
        if operation == 'check':
            return await self.active.check()
        raise ValueError('Unsupported official login operation')


def _delegate():
    global _delegate_class
    if _delegate_class is not None:
        return _delegate_class
    from rubicon.objc import ObjCClass, ObjCBlock, objc_id, objc_method, objc_property
    from rubicon.objc.runtime import load_library
    load_library('WebKit')
    ObjCClass('WKWebView')
    class MineradioNeteaseLoginDelegate(ObjCClass('NSObject')):
        owner = objc_property(object, weak=True)

        @objc_method
        def webView_didFinishNavigation_(self, view, navigation) -> None:
            flow = self.owner
            if flow:
                flow.page_loading, flow.page_error = False, False
                if not flow.loaded.done():
                    flow.loaded.set_result(True)

        @objc_method
        def webView_didFailProvisionalNavigation_withError_(self, view, navigation, error) -> None:
            flow = self.owner
            if flow:
                flow.page_loading, flow.page_error = False, True
                if not flow.loaded.done():
                    flow.loaded.set_result(False)

        @objc_method
        def webView_decidePolicyForNavigationResponse_decisionHandler_(self, view, response, completion) -> None:
            from rubicon.objc.runtime import send_message
            try:
                if self.owner and send_message(response, 'isForMainFrame', restype=c_bool):
                    http = _obj(response, 'response')
                    if http and _text(_obj(http, 'URL'), 'scheme') in ('http', 'https'):
                        self.owner.http_status = int(send_message(http, 'statusCode', restype=c_long))
            finally:
                ObjCBlock(completion, None, c_long)(1)

        @objc_method
        def webView_decidePolicyForNavigationAction_decisionHandler_(self, view, action, completion) -> None:
            try:
                target = _text(_obj(_obj(action, 'request'), 'URL'), 'absoluteString')
                frame = _obj(action, 'targetFrame')
                from rubicon.objc.runtime import send_message
                main = not frame or send_message(frame, 'isMainFrame', restype=c_bool)
                allowed = bool(self.owner and (target == 'about:blank' or
                    allowed_navigation(target, self.owner.provider, main_frame=main)))
            except Exception:
                allowed = False
            ObjCBlock(completion, None, c_long)(1 if allowed else 0)

        @objc_method
        def webView_createWebViewWithConfiguration_forNavigationAction_windowFeatures_(self, view, config, action, features) -> objc_id:
            # Official OAuth commonly opens a new window. Keep that navigation
            # in this exact isolated store rather than invoking Safari.
            flow = self.owner
            if flow and not flow.closed and not _obj(action, 'targetFrame'):
                request = _obj(action, 'request')
                target = _text(_obj(request, 'URL'), 'absoluteString')
                if allowed_navigation(target, flow.provider):
                    flow.view.loadRequest(request)
            return None

        @objc_method
        def userContentController_didReceiveScriptMessage_(self, controller, message) -> None:
            flow = self.owner
            if flow and not flow.closed:
                _receive(flow, message)

        @objc_method
        def closeNeteaseLogin_(self, sender) -> None:
            if self.owner:
                self.owner.hide()

    _delegate_class = MineradioNeteaseLoginDelegate
    return _delegate_class


def _receive(flow, message):
    from rubicon.objc import py_from_ns
    from rubicon.objc.runtime import send_message
    try:
        frame = _obj(message, 'frameInfo')
        if (not send_message(frame, 'isMainFrame', restype=c_bool)
                or not allowed_message_url(_frame_url(frame), flow.provider)):
            return
        value = py_from_ns(_obj(message, 'body'))
        if not isinstance(value, dict):
            return
        if value.get('kind') == 'response' and flow.provider == 'netease':
            code, path = value.get('code'), value.get('path')
            if type(code) not in (int, float) or not math.isfinite(code) or int(code) != code or path not in QR_PATHS:
                return
            if urllib.parse.urlsplit(_frame_url(frame)).hostname != 'music.163.com':
                return
            if path.endswith('/unikey'):
                if code == 200:
                    flow.observed.update(upstream_code=801, verification_required=False)
            else:
                flow.observed['upstream_code'] = int(code)
                if code == 8821:
                    flow.observed['verification_required'] = True
            return
        if value.get('kind') != 'result' or not send_message(frame, 'isMainFrame', restype=c_bool):
            return
        identifier, raw = value.get('id'), value.get('value')
        if (type(identifier) not in (int, float) or not math.isfinite(identifier) or int(identifier) != identifier
                or not isinstance(raw, str) or len(raw) > MAX_MESSAGE):
            return
        future = flow.pending.pop(int(identifier), None)
        if future and not future.done():
            future.set_result(json.loads(raw))
    except Exception:
        return  # Never log messages, QR payloads or login results.


class _Flow:
    def __init__(self, app, key, provider='netease'):
        self.app, self.key = app, key
        self.provider, self.spec = provider, PROVIDERS[provider]
        self.loaded = asyncio.get_running_loop().create_future()
        self.pending, self.serial = {}, 0
        self.observed = {'upstream_code':None, 'verification_required':False}
        self.page_loading, self.page_error = True, False
        self.http_status = None
        self.preparing = None
        self.closed = False
        self.view = self.delegate = self.presentation = None

    async def start(self):
        from rubicon.objc import ObjCClass
        config = ObjCClass('WKWebViewConfiguration').alloc().init()
        self.data_store = _obj(ObjCClass('WKWebsiteDataStore'), 'nonPersistentDataStore')
        config.websiteDataStore = self.data_store
        _obj(config, 'preferences').javaScriptCanOpenWindowsAutomatically = False
        _obj(config, 'defaultWebpagePreferences').preferredContentMode = 2
        self.delegate = _delegate().alloc().init()
        self.delegate.owner = self
        content = _obj(config, 'userContentController')
        if self.provider == 'netease':
            script = ObjCClass('WKUserScript').alloc().initWithSource(OBSERVER, injectionTime=0, forMainFrameOnly=True)
            content.addUserScript(script)
        content.addScriptMessageHandler(self.delegate, name='mineradioNeteaseLogin')
        self.view = ObjCClass('WKWebView').alloc().initWithFrame((( -2000, -2000), (1100, 820)), configuration=config)
        self.view.inspectable = False
        self.view.customUserAgent = USER_AGENT
        self.view.navigationDelegate = self.delegate
        self.view.UIDelegate = self.delegate
        self.container = _obj(_obj(self.app.main_window._impl.native, 'rootViewController'), 'view')
        self.container.addSubview(self.view)
        self.view.alpha = 0.01
        self.view.loadRequest(ObjCClass('NSURLRequest').requestWithURL(ObjCClass('NSURL').URLWithString(self.spec['home'])))
        # Creating an isolated official page is independent of whether the site
        # paints its QR canvas. A slow QR must not block password/SMS choices.
        if self.provider == 'netease':
            self.preparing = asyncio.create_task(self.prepare_login_entry())
        return {'manual_login':True, 'qr_image':'', 'qr_url':''}

    async def prepare_login_entry(self):
        try:
            loaded = await asyncio.wait_for(asyncio.shield(self.loaded), timeout=30)
            if not loaded or self.closed:
                return
            await self.evaluate('''(async()=>{for(let n=0;n<50;n++){
              if(document.querySelector('.mrc-modal-container'))return true;
              if(typeof window.login==='function'){
                const a=document.querySelector('.m-tophead a[data-action="login"]');
                if(a)a.click();else window.login();return true;
              }await new Promise(r=>setTimeout(r,200));}return false;})()''', timeout=12)
        except Exception:
            # The user can still use the real website's own visible entry.
            # Never replace a failed page/QR with fabricated authorization data.
            return

    async def evaluate(self, expression, timeout=20):
        if self.closed:
            raise RuntimeError('Official login view is closed')
        from rubicon.objc import Block, objc_id
        self.serial += 1
        identifier = self.serial
        future = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        source = '''(()=>{Promise.resolve(EXPRESSION).then(value=>window.webkit.messageHandlers.mineradioNeteaseLogin.postMessage(
          {kind:'result',id:IDENTIFIER,value:JSON.stringify(value===undefined?null:value)})).catch(()=>
          window.webkit.messageHandlers.mineradioNeteaseLogin.postMessage({kind:'result',id:IDENTIFIER,value:'null'}));return true;})()'''
        source = source.replace('EXPRESSION', expression).replace('IDENTIFIER', str(identifier))
        def completed(result: objc_id, error: objc_id) -> None:
            if error and not future.done():
                future.set_exception(RuntimeError('Official login script failed'))
        callback = Block(completed, None, objc_id, objc_id)
        try:
            self.view.evaluateJavaScript(source, completionHandler=callback)
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
                    domain = _text(cookie, 'domain')
                    if not allowed_cookie_domain(domain, self.provider):
                        continue
                    date = _obj(cookie, 'expiresDate')
                    result.append(dict(name=_text(cookie, 'name'), value=_text(cookie, 'value'), domain=domain,
                        expires=float(send_message(date, 'timeIntervalSince1970', restype=c_double)) if date else -1))
                if not future.done():
                    future.set_result(result)
            except Exception:
                if not future.done():
                    future.set_exception(RuntimeError('Official login cookies could not be read'))
        callback = Block(completed, None, objc_id)
        _obj(self.data_store, 'httpCookieStore').getAllCookies(callback)
        return await asyncio.wait_for(future, timeout=5)

    async def check(self):
        cookies = await self.cookies()
        if self.closed:
            return {'cookies':[], 'closed':True}
        snapshot = dict(self.observed, cookies=cookies, closed=False, manual_login=True,
                        page_loading=self.page_loading, page_error=self.page_error)
        if self.provider != 'netease':
            return snapshot
        from music_app.auth.netease.browser import _cookie_values
        if _cookie_values(cookies).get('MUSIC_U'):
            try:
                data = await self.evaluate('''(async()=>{const r=await fetch('https://music.163.com/api/nuser/account/get',
                  {credentials:'include',cache:'no-store',redirect:'error'});return r.ok?await r.json():null;})()''', timeout=12)
                snapshot['account'] = data if isinstance(data, dict) else {}
                snapshot['account_lookup_failed'] = not isinstance(data, dict) or data.get('code') != 200
            except Exception:
                snapshot['account_lookup_failed'] = True
            if self.closed:
                return {'cookies':[], 'closed':True}
            snapshot['cookies'] = await self.cookies()
        return snapshot

    def show(self):
        if self.closed:
            raise RuntimeError('Official music login is closed')
        if self.presentation:
            return
        from rubicon.objc import ObjCClass
        from rubicon.objc.runtime import SEL
        from rubicon.objc.types import CGRect
        from rubicon.objc.runtime import send_message
        presenter = _obj(self.app.main_window._impl.native, 'rootViewController')
        if _obj(presenter, 'presentedViewController'):
            raise RuntimeError('Close the current system window first')
        controller = ObjCClass('UIViewController').alloc().init()
        controller.title = self.spec['title']
        view = _obj(controller, 'view')
        self.view.removeFromSuperview()
        self.view.alpha = 1
        self.view.frame = send_message(view, 'bounds', restype=CGRect)
        self.view.autoresizingMask = 18
        view.addSubview(self.view)
        _obj(controller, 'navigationItem').rightBarButtonItem = ObjCClass('UIBarButtonItem').alloc().initWithBarButtonSystemItem(
            0, target=self.delegate, action=SEL('closeNeteaseLogin:'))
        self.presentation = ObjCClass('UINavigationController').alloc().initWithRootViewController(controller)
        self.presentation.modalInPresentation = True
        presenter.presentViewController(self.presentation, animated=True, completion=None)

    def hide(self):
        if self.presentation:
            self.presentation.dismissViewControllerAnimated(True, completion=None)
            self.presentation = None
        if not self.closed:
            self.view.removeFromSuperview()
            self.view.frame = ((-2000, -2000), (1100, 820))
            self.view.alpha = 0.01
            self.container.addSubview(self.view)

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.preparing and not self.preparing.done():
            self.preparing.cancel()
        if self.presentation:
            self.presentation.dismissViewControllerAnimated(False, completion=None)
            self.presentation = None
        if self.view:
            self.view.stopLoading()
            _obj(_obj(self.view, 'configuration'), 'userContentController').removeScriptMessageHandlerForName('mineradioNeteaseLogin')
            self.view.navigationDelegate = None
            self.view.UIDelegate = None
            self.view.removeFromSuperview()
        if not self.loaded.done():
            self.loaded.cancel()
        for future in tuple(self.pending.values()):
            if not future.done():
                future.cancel()
        self.pending.clear()
        self.view = self.delegate = self.presentation = None
