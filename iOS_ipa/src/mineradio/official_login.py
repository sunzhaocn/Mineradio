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
              'hosts': frozenset({'kugou.com', 'graph.qq.com', 'xui.ptlogin2.qq.com',
                  'ssl.ptlogin2.qq.com', 'ssl.ptlogin2.graph.qq.com', 'open.weixin.qq.com'}),
              'suffixes': ('.kugou.com',),
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

# The official Kugou page exchanges a QR-issued client token for a different
# KuGoo.t web cookie. Retain only the successful response's client credential
# so that cloudlist reads use the same fresh authorization, never a web t as a
# native token. No password, code, request body or browser storage is inspected.
KUGOU_OBSERVER = r'''(()=>{
 if(!location.hostname.endsWith('.kugou.com')&&location.hostname!=='kugou.com')return;
 if(window.__mineradioKugouObserver)return;window.__mineradioKugouObserver=true;
 function route(value){try{const u=new URL(String(value),location.href);
   return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&
    ['login-user.kugou.com','loginuserretry.kugou.com'].includes(u.hostname)&&
    u.pathname.replace(/\/$/,'')==='/v2/get_userinfo_qrcode';}catch(_){return false;}}
 function report(url,status,data){try{
   if(!route(url)||Number(status)!==200||!data||Number(data.status)!==1||Number(data.error_code||0)!==0)return;
   const d=data.data;if(!d||Number(d.status)!==4||typeof d.token!=='string'||!/^\d+$/.test(String(d.userid)))return;
   window.webkit.messageHandlers.mineradioNeteaseLogin.postMessage({kind:'kugou-client',
    path:'/v2/get_userinfo_qrcode',token:d.token,userid:String(d.userid)});
 }catch(_){}}
 const open=XMLHttpRequest.prototype.open;
 XMLHttpRequest.prototype.open=function(){this.addEventListener('loadend',function(){try{
   if(route(this.responseURL))report(this.responseURL,this.status,
    this.responseType==='json'?this.response:JSON.parse(this.responseText));
 }catch(_){}},{once:true});return open.apply(this,arguments);};
 if(typeof fetch==='function'){const original=fetch;
  window.fetch=function(){const task=original.apply(this,arguments);task.then(r=>{
   if(route(r.url))r.clone().json().then(d=>report(r.url,r.status,d)).catch(()=>{});
  }).catch(()=>{});return task;};}
})();'''


def kugou_client_authorization(value):
    if not isinstance(value, dict) or value.get('path') != '/v2/get_userinfo_qrcode':
        return None
    token, uid = value.get('token'), value.get('userid')
    if (not isinstance(token, str) or not 1 <= len(token) <= 16384
            or any(ord(c) < 33 or ord(c) > 126 or c == ';' for c in token)
            or not isinstance(uid, str) or not re.fullmatch(r'[1-9][0-9]{0,24}', uid)):
        return None
    return dict(token=token, userid=uid)


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


async def diagnostic(provider, *, verify_windows=False):
    """Use a fresh public-page flow; never read or submit account/form values.

    The optional window probe is only enabled here, never by the backend's
    production facade. It exercises a blank child and our own native window.
    """
    import secrets
    key = secrets.token_hex(16)
    if _host is None:
        return {'pageLoaded': False, 'error': 'host_missing'}
    if _host.active and not _host.active.closed:
        return {'pageLoaded': False, 'error': 'session_active', 'accountAuthorized': False}
    try:
        created = await _host.perform('create', key, provider, diagnostic_windows=verify_windows is True)
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
        result = dict(pageLoaded=bool(loaded and not flow.page_error), httpStatus=flow.http_status,
                      manualLogin=created.get('manual_login') is True,
                      page=metadata, accountAuthorized=False)
        if verify_windows is True:
            result['windows'] = await _diagnostic_windows(flow) if result['pageLoaded'] else {
                'requested': True, 'passed': False, 'error': 'page_unavailable'}
        return result
    except Exception as error:
        return {'pageLoaded': False, 'error': type(error).__name__, 'accountAuthorized': False}
    finally:
        await _host.perform('close', key)


async def _wait_presentation(flow, navigation, timeout=4):
    """Wait for UIKit's animation, not just presentViewController's return."""
    from rubicon.objc.runtime import send_message
    presenter = _obj(flow.app.main_window._impl.native, 'rootViewController')
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if (_obj(presenter, 'presentedViewController') == navigation
                and not send_message(navigation, 'isBeingPresented', restype=c_bool)):
            return True
        await asyncio.sleep(.05)
    return False


async def _diagnostic_windows(flow):
    """Return booleans only; do not inspect cookies, forms or user identity."""
    popup = dict(opened=False, openerRetained=False, nativeChildCreated=False,
                 rootRetained=False, childClosed=False)
    presentation = dict(firstPresented=False, dismissalCompleted=False,
                        reopened=False, secondDismissalCompleted=False)
    result = dict(requested=True, passed=False, popup=popup, presentation=presentation)
    try:
        if not flow.diagnostic_windows or flow.popups:
            raise RuntimeError('Window probe requires a fresh diagnostic flow')
        root = flow.view
        value = await flow.evaluate('''(()=>{const child=window.open('about:blank','_blank');
          window.__mineradioWindowProbe=child;return {opened:!!child,
          openerRetained:!!child&&child.opener===window};})()''', timeout=5)
        if isinstance(value, dict):
            popup['opened'] = value.get('opened') is True
            popup['openerRetained'] = value.get('openerRetained') is True
        popup['nativeChildCreated'] = len(flow.popups) == 1
        popup['rootRetained'] = flow.view == root
        await flow.evaluate('''(()=>{if(window.__mineradioWindowProbe)window.__mineradioWindowProbe.close();
          delete window.__mineradioWindowProbe;return true;})()''', timeout=5)
        deadline = asyncio.get_running_loop().time() + 3
        while flow.popups and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(.05)
        popup['childClosed'] = not flow.popups and flow.active_view() == root
        await flow.show()
        first = flow.presentation
        presentation['firstPresented'] = first is not None and await _wait_presentation(flow, first)
        flow.hide()
        # Reopen immediately: show must wait for the old dismissal completion.
        await flow.show()
        presentation['dismissalCompleted'] = bool(flow.dismissal and flow.dismissal.done())
        second = flow.presentation
        presentation['reopened'] = bool(second is not None and second != first
            and await _wait_presentation(flow, second) and flow.active_view() == root)
        flow.hide()
        if flow.dismissal:
            await asyncio.wait_for(asyncio.shield(flow.dismissal), timeout=4)
        presenter = _obj(flow.app.main_window._impl.native, 'rootViewController')
        presentation['secondDismissalCompleted'] = bool(flow.dismissal and flow.dismissal.done()
            and flow.presentation is None and _obj(presenter, 'presentedViewController') is None)
        result['passed'] = all(popup.values()) and all(presentation.values())
    except Exception as error:
        result['error'] = type(error).__name__
    return result


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

    async def perform(self, operation, key, provider='netease', *, diagnostic_windows=False):
        if not re.fullmatch('[0-9a-f]{32}', key):
            raise ValueError('Invalid official login session key')
        if operation == 'create':
            if provider not in PROVIDERS:
                raise ValueError('Unsupported official music login provider')
            if self.active:
                self.active.close()
            flow = _Flow(self.app, key, provider, diagnostic_windows=diagnostic_windows is True)
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
            await self.active.show()
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
            flow = self.owner
            if flow and not flow.closed and not _obj(action, 'targetFrame'):
                request = _obj(action, 'request')
                target = _text(_obj(request, 'URL'), 'absoluteString')
                if target == 'about:blank' or allowed_navigation(target, flow.provider):
                    # Return a real child WebView made with WebKit's supplied
                    # configuration. Loading this into the root instead loses
                    # window.opener and the music site's OAuth callback.
                    return flow.create_popup(config)
            return None

        @objc_method
        def webViewDidClose_(self, view) -> None:
            if self.owner:
                self.owner.close_popup(view)

        @objc_method
        def presentationControllerDidDismiss_(self, controller) -> None:
            if self.owner:
                self.owner.presentation_dismissed(_obj(controller, 'presentedViewController'))

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
        if value.get('kind') == 'kugou-client' and flow.provider == 'kugou':
            authorization = kugou_client_authorization(value)
            if authorization:
                flow.client_authorization = authorization
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
    def __init__(self, app, key, provider='netease', *, diagnostic_windows=False):
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
        self.popups = []
        self.visible_controller = None
        self.dismissal = None
        self.dismiss_callback = None
        self.closing_presentation = None
        self.client_authorization = None
        self.diagnostic_windows = diagnostic_windows is True

    async def start(self):
        from rubicon.objc import ObjCClass
        config = ObjCClass('WKWebViewConfiguration').alloc().init()
        self.data_store = _obj(ObjCClass('WKWebsiteDataStore'), 'nonPersistentDataStore')
        config.websiteDataStore = self.data_store
        _obj(config, 'preferences').javaScriptCanOpenWindowsAutomatically = self.diagnostic_windows
        _obj(config, 'defaultWebpagePreferences').preferredContentMode = 2
        self.delegate = _delegate().alloc().init()
        self.delegate.owner = self
        content = _obj(config, 'userContentController')
        if self.provider == 'netease':
            script = ObjCClass('WKUserScript').alloc().initWithSource(OBSERVER, injectionTime=0, forMainFrameOnly=True)
            content.addUserScript(script)
        elif self.provider == 'kugou':
            script = ObjCClass('WKUserScript').alloc().initWithSource(KUGOU_OBSERVER, injectionTime=0, forMainFrameOnly=True)
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
        if self.provider == 'netease' and not self.diagnostic_windows:
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
        if self.provider == 'kugou' and self.client_authorization:
            snapshot['client_authorization'] = dict(self.client_authorization)
        if self.provider != 'netease':
            return snapshot
        from music_app.auth.netease.browser import _cookie_values
        if _cookie_values(cookies).get('MUSIC_U'):
            target = _text(_obj(self.view, 'URL'), 'absoluteString')
            if not allowed_message_url(target, 'netease'):
                from rubicon.objc import ObjCClass
                self.page_loading = True
                self.view.loadRequest(ObjCClass('NSURLRequest').requestWithURL(ObjCClass('NSURL').URLWithString(HOME)))
                snapshot.update(account_lookup_failed=True, page_loading=True)
                return snapshot
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

    def active_view(self):
        return self.popups[-1] if self.popups else self.view

    def _mount(self, view):
        for candidate in [self.view, *self.popups]:
            candidate.removeFromSuperview()
            candidate.alpha = .01
            candidate.frame = ((-2000, -2000), (1100, 820))
            self.container.addSubview(candidate)
        if self.visible_controller:
            from rubicon.objc.types import CGRect
            from rubicon.objc.runtime import send_message
            container = _obj(self.visible_controller, 'view')
            view.removeFromSuperview()
            view.alpha = 1
            view.frame = send_message(container, 'bounds', restype=CGRect)
            view.autoresizingMask = 18
            container.addSubview(view)

    def create_popup(self, configuration):
        from rubicon.objc import ObjCClass
        if len(self.popups) >= 4:
            return None
        configuration.websiteDataStore = self.data_store
        child = ObjCClass('WKWebView').alloc().initWithFrame(((-2000, -2000), (1100, 820)), configuration=configuration)
        child.inspectable = False
        child.customUserAgent = USER_AGENT
        child.navigationDelegate = self.delegate
        child.UIDelegate = self.delegate
        self.popups.append(child)
        self._mount(child)
        return child

    def close_popup(self, view):
        child = next((candidate for candidate in self.popups if candidate == view), None)
        if child is None:
            if view == self.view:
                self.hide()
            return
        child.stopLoading()
        child.navigationDelegate = child.UIDelegate = None
        child.removeFromSuperview()
        self.popups.remove(child)
        if not self.closed:
            self._mount(self.active_view())

    async def show(self):
        if self.closed:
            raise RuntimeError('Official music login is closed')
        if self.dismissal and not self.dismissal.done():
            await asyncio.wait_for(asyncio.shield(self.dismissal), timeout=4)
        if self.closed:
            raise RuntimeError('Official music login is closed')
        return self._present()

    def _present(self):
        from rubicon.objc import ObjCClass
        from rubicon.objc.runtime import SEL
        from rubicon.objc.types import CGRect
        from rubicon.objc.runtime import send_message
        presenter = _obj(self.app.main_window._impl.native, 'rootViewController')
        if self.presentation:
            if _obj(presenter, 'presentedViewController') == self.presentation:
                return
            # UIKit may have dismissed a sheet through system/window controls.
            # Reconcile actual native state instead of trusting a stale handle.
            self.presentation_dismissed(self.presentation)
        if _obj(presenter, 'presentedViewController'):
            raise RuntimeError('Close the current system window first')
        controller = ObjCClass('UIViewController').alloc().init()
        controller.title = self.spec['title']
        view = _obj(controller, 'view')
        self.visible_controller = controller
        self._mount(self.active_view())
        _obj(controller, 'navigationItem').rightBarButtonItem = ObjCClass('UIBarButtonItem').alloc().initWithBarButtonSystemItem(
            0, target=self.delegate, action=SEL('closeNeteaseLogin:'))
        self.presentation = ObjCClass('UINavigationController').alloc().initWithRootViewController(controller)
        self.presentation.modalInPresentation = True
        presenter.presentViewController(self.presentation, animated=True, completion=None)
        presentation_controller = _obj(self.presentation, 'presentationController')
        if presentation_controller:
            presentation_controller.delegate = self.delegate

    def hide(self):
        if not self.presentation:
            return
        from rubicon.objc import Block
        navigation, self.presentation = self.presentation, None
        self.closing_presentation = navigation
        self.dismissal = asyncio.get_running_loop().create_future()
        def completed() -> None:
            self.presentation_dismissed(navigation)
        self.dismiss_callback = Block(completed, None)
        navigation.dismissViewControllerAnimated(True, completion=self.dismiss_callback)

    def presentation_dismissed(self, navigation=None):
        if navigation is not None and navigation not in (self.presentation, self.closing_presentation):
            return
        self.presentation = self.visible_controller = None
        self.closing_presentation = None
        if not self.closed:
            self._mount(self.active_view())
        if self.dismissal and not self.dismissal.done():
            self.dismissal.set_result(True)

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
            _obj(_obj(self.view, 'configuration'), 'userContentController').removeScriptMessageHandlerForName('mineradioNeteaseLogin')
            for view in [self.view, *self.popups]:
                view.stopLoading()
                view.navigationDelegate = view.UIDelegate = None
                view.removeFromSuperview()
        if not self.loaded.done():
            self.loaded.cancel()
        for future in tuple(self.pending.values()):
            if not future.done():
                future.cancel()
        self.pending.clear()
        if self.dismissal and not self.dismissal.done():
            self.dismissal.set_result(True)
        self.popups.clear()
        self.client_authorization = None
        self.visible_controller = None
        self.view = self.delegate = self.presentation = None
