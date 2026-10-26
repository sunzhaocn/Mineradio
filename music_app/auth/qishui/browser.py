"""汽水扫码：每个流程独立Chromium安全上下文，不读取已有账号资料。

官方bdms组件生成a_bogus，整个Passport流程及Cookie均在同一浏览器中完成。
当前扫码入口采用服务端qrcode_index_url原样；旧客户端light/invoke改写已失效。
实现核对：https://github.com/sodahub-org/libresoda/blob/main/docs/QR-LOGIN.md
安全页封装：Wx2yZx/Mineradio-Qishui-QR-Login，固定提交aaadaab7（GPL-3.0）。
依赖本机Chrome/Edge及Python playwright；MFA由用户在官方组件窗口完成。
"""


import concurrent.futures
import base64
import hashlib
import http.cookiejar
import io
import json
import os
from pathlib import Path
import queue
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from music_app.auth.qishui.common import AuthError, HOST, USER_AGENT, _diagnostic, _stage


_ASSET_URL = ("https://raw.githubusercontent.com/Wx2yZx/Mineradio-Qishui-QR-Login/"
              "aaadaab7d011714f94fbe45b382ba8dcc7cf17b9/Mineradio-Qishui-QR-Login.zip")


_ASSET_SHA256 = "01f21138ec2ad602a32893b8aea683d0548abbc37091edafba7b50c90561ff07"


_ASSETS = None


_ASSET_LOCK = threading.Lock()


_BDMS_URLS = (
    "https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js",
    "https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js",
)


def _security_assets():
    """固定版本的上游官方安全组件封装，只缓存在内存，不读取账号配置。"""
    global _ASSETS
    with _ASSET_LOCK:
        if _ASSETS is not None:
            return _ASSETS
        try:
            cached_archive = os.environ.get('QISHUI_AUTH_ASSET_ARCHIVE')
            if cached_archive:
                raw = Path(cached_archive).read_bytes()
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError()
            else:
                with urllib.request.urlopen(_ASSET_URL, timeout=25) as response:
                    raw = response.read(2 * 1024 * 1024)
            if hashlib.sha256(raw).hexdigest() != _ASSET_SHA256:
                raise ValueError()
            archive = zipfile.ZipFile(io.BytesIO(raw))
            prefix = "Mineradio-Qishui-QR-Login-v2.0.2/drop-in/qishui-auth-v6/"
            # The pinned Windows-created archive stores backslashes. Windows
            # ZipInfo normalizes them automatically; Linux keeps the raw names.
            members = {entry.filename.replace('\\', '/'): entry for entry in archive.infolist()}
            assets = {name: archive.read(members[prefix + name]) for name in (
                "security_seed.html", "security_host.html", "bdms.js", "sdk-glue.js", "react.js", "react-dom.js")}
            # Passport跨域Cookie必须由同一浏览器上下文管理；原移植页漏了此标志。
            assets["security_host.html"] = assets["security_host.html"].replace(
                b"xhr.open(request.method || 'GET', request.url, true);",
                b"xhr.open(request.method || 'GET', request.url, true); xhr.withCredentials = true;")
            _ASSETS = assets
            return assets
        except (OSError, ValueError, KeyError, zipfile.BadZipFile):
            raise AuthError(503, "qishui_security_assets", "汽水官方安全组件加载失败，请检查网络后重试") from None


def _chromium_path():
    configured = os.environ.get("QISHUI_BROWSER_PATH")
    candidates = [configured] if configured else [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe")]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise AuthError(503, "qishui_browser_missing", "汽水扫码需要本机 Chrome 或 Edge 浏览器")


class _SignedBrowser:
    """单次二维码的独立浏览器；所有Playwright调用固定在专属线程内。"""

    def __init__(self, state):
        self.state, self.commands = state, queue.Queue()
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._worker, daemon=True, name="qishui-passport-security")
        self.thread.start()

    def call(self, method, payload=None):
        if self.closed.is_set():
            raise AuthError(502, "qishui_browser_closed", "汽水扫码安全会话已关闭，请重新获取二维码")
        future = concurrent.futures.Future()
        self.commands.put((method, payload, future))
        try:
            return future.result(timeout=45)
        except AuthError:
            raise
        except Exception:
            raise AuthError(502, "qishui_browser_request", "汽水安全会话请求失败，请重新获取二维码") from None

    def close(self):
        self.commands.put(("close", None, None))

    def _worker(self):
        browser = None
        try:
            from playwright.sync_api import sync_playwright
            assets = _security_assets()
            token = secrets.token_urlsafe(24)
            # 安全页资产仅在本上下文中由route fulfill，Passport始终同源，
            # 保留Chromium的CORS、Web安全与存储隔离，不监听本地代理端口。
            base = HOST + "/__music_auth/" + token + "/"
            with sync_playwright() as pw:
                headed = False
                signatures = []
                def launch(storage=None):
                    nonlocal browser
                    browser = pw.chromium.launch(executable_path=_chromium_path(), headless=not headed)
                    context = browser.new_context(user_agent=USER_AGENT, storage_state=storage,
                                                  viewport={"width": 980, "height": 760})
                    def asset_route(route):
                        name = urllib.parse.urlsplit(route.request.url).path.rsplit("/", 1)[-1]
                        body = assets.get(name)
                        if body is None:
                            route.fulfill(status=404, body="Not found")
                            return
                        route.fulfill(status=200, content_type="text/html; charset=utf-8" if name.endswith(".html")
                            else "text/javascript; charset=utf-8", headers={"Cache-Control": "no-store"}, body=body)
                    context.route(base + "**", asset_route)
                    for sdk_url in _BDMS_URLS:
                        context.route(sdk_url, lambda route: route.fulfill(status=200, content_type="text/javascript",
                            headers={"Access-Control-Allow-Origin": HOST}, body=assets["bdms.js"]))
                    page = context.new_page()
                    def observe_request(request):
                        target = urllib.parse.urlsplit(request.url)
                        if target.hostname == "api.qishui.com" and target.path.startswith("/passport/"):
                            parameters = urllib.parse.parse_qs(target.query)
                            signatures.append((target.path, len(parameters.get("a_bogus", [""])[0]),
                                parameters.get("msToken", [""])[0] == self.state["ms_token"]))
                    page.on("request", observe_request)
                    page.goto(base + "security_seed.html", wait_until="load")
                    page.evaluate("token => {localStorage.setItem('xmst',token);localStorage.setItem('xmsty',token)}", self.state["ms_token"])
                    page.goto(base + "security_host.html", wait_until="load")
                    page.wait_for_function("window.bdms && window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion", timeout=20000)
                    info = page.evaluate("window.__qishuiBrowserInfo()")
                    self.state["browser_info"] = info["encrypted"]
                    _diagnostic(self.state, "security_ready")
                    return context, page
                context, page = launch()
                while time.time() < self.state.get("expires_at", 0):
                    try:
                        method, payload, future = self.commands.get(timeout=0.5)
                    except queue.Empty:
                        continue
                    if method == "close":
                        break
                    try:
                        if method == "request":
                            target = urllib.parse.urlsplit(payload["url"])
                            parameters = dict(urllib.parse.parse_qsl(target.query))
                            parameters["account_sdk_source_info"] = self.state["browser_info"]
                            payload["url"] = urllib.parse.urlunsplit(target._replace(query=urllib.parse.urlencode(parameters)))
                            signatures.clear()
                            result = page.evaluate("spec => window.__qishuiRequest(spec)", payload)
                            signed = urllib.parse.parse_qs(urllib.parse.urlsplit(result.get("responseURL", "")).query)
                            length = len(signed.get("a_bogus", [""])[0])
                            matches = signed.get("msToken", [""])[0] == self.state["ms_token"]
                            observed = next((row for row in signatures if row[0] == target.path and row[1] == 44), None)
                            if observed:
                                _path, length, matches = observed
                            _diagnostic(self.state, "security_signature", a_bogus_length=length, ms_token_matches=int(matches))
                            if length != 44 or not matches:
                                raise AuthError(502, "qishui_security_signature", "汽水官方安全签名未就绪，请重新获取二维码")
                            result["cookies"] = context.cookies()
                        elif method == "verify_start":
                            remote = bool(os.environ.get('MINERADIO_PUBLIC_ORIGIN')) and not os.environ.get('DISPLAY') and os.name != 'nt'
                            self.state['remote_verification'] = remote
                            if not headed and not remote:
                                storage = context.storage_state()
                                browser.close()
                                headed = True
                                context, page = launch(storage)
                            page.bring_to_front()
                            page.evaluate("spec => {window.__authMfaResult=null;window.__qishuiSecondVerify(spec.decision,spec.options).then(value=>window.__authMfaResult=value).catch(()=>window.__authMfaResult={status:false});return true}", payload)
                            result = True
                        elif method == 'verify_view':
                            if not self.state.get('mfa_pending') or not self.state.get('remote_verification'):
                                raise AuthError(409,'qishui_verification_inactive','当前没有待完成的汽水验证')
                            result = {'image':'data:image/jpeg;base64,' + base64.b64encode(page.screenshot(type='jpeg', quality=72, timeout=8000)).decode(),
                                      'width':980,'height':760}
                        elif method == 'verify_input':
                            if not self.state.get('mfa_pending') or not self.state.get('remote_verification'):
                                raise AuthError(409,'qishui_verification_inactive','当前没有待完成的汽水验证')
                            action = payload['action']
                            if action == 'tap':
                                page.mouse.click(payload['x'],payload['y'])
                            elif action == 'drag':
                                points=payload['points'];page.mouse.move(*points[0]);page.mouse.down()
                                try:
                                    for point in points[1:]:page.mouse.move(*point)
                                finally:page.mouse.up()
                            elif action == 'text':page.keyboard.insert_text(payload['text'])
                            elif action == 'key':page.keyboard.press(payload['key'])
                            result = {'ok':True}
                        elif method == "verify_status":
                            result = page.evaluate("window.__authMfaResult || null")
                        else:
                            raise ValueError()
                        future.set_result(result)
                    except Exception as exc:
                        if not isinstance(exc, AuthError):
                            message = str(exc).lower()
                            flags = dict(verify=int(method == 'verify_start'),
                                         network=int('network' in message or 'failed to fetch' in message or 'request failed' in message),
                                         timeout=int('timeout' in message or 'timed out' in message),
                                         closed=int('closed' in message),
                                         display=int('display' in message or 'x server' in message))
                            _diagnostic(self.state, 'security_request_failed', **flags)
                            print('[qishui-security] ' + json.dumps(flags), flush=True)
                        error = exc if isinstance(exc, AuthError) else AuthError(502, "qishui_browser_request", "汽水安全窗口请求失败，请重新获取二维码")
                        future.set_exception(error)
        except Exception:
            _diagnostic(self.state, "security_unavailable")
        finally:
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass
            self.closed.set()
            while not self.commands.empty():
                _method, _payload, future = self.commands.get_nowait()
                if future and not future.done():
                    future.set_exception(AuthError(503, "qishui_security_unavailable", "汽水官方安全引擎启动失败，请检查浏览器与 Playwright 是否可用"))


def _browser_request(state, url, headers, body, json_response):
    if not state.get("signed_runtime"):
        from music_app import platform_runtime
        if platform_runtime.is_ios():
            from .ios_browser import IOSSignedBrowser
            state['signed_runtime'] = IOSSignedBrowser(state)
        elif platform_runtime.is_android():
            from .android_browser import AndroidSignedBrowser
            state["signed_runtime"] = AndroidSignedBrowser(state)
        else:
            state["signed_runtime"] = _SignedBrowser(state)
    runtime = state["signed_runtime"]
    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query.update({"passport_jssdk_version": "2.4.13", "p_js_v": "2.4.13", "p_js_t": "pro",
                  "p_zt": "3.3.5", "p_ver": "1.0.29", "request_host": "app%3A%2F%2Fresources",
                  "p_bd": "1.0.0.41", "biz_trace_id": secrets.token_hex(4), "msToken": state["ms_token"]})
    # 首次call会在专用线程完成初始化，随后填入真实浏览器指纹。
    if not state.get("browser_info"):
        # 排队请求的指纹在脚本执行前从同一个安全页读取。
        query["account_sdk_source_info"] = "__BROWSER_INFO__"
    else:
        query["account_sdk_source_info"] = state["browser_info"]
    headers = {k: v for k, v in headers.items() if k.lower() not in {"user-agent", "referer", "origin", "cookie"}}
    headers.update({"x-tt-passport-verify-portrait": state["verify_portrait_id"],
                    "x-tt-passport-trace-id": query["biz_trace_id"]})
    if body is not None:
        headers["x-ss-stub"] = hashlib.md5(body).hexdigest().upper()
    full_url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
    result = runtime.call("request", {"method": "POST" if body is not None else "GET", "url": full_url,
                                     "headers": headers, "body": body.decode("utf-8") if body else None, "timeout": 20000})
    for cookie in result.get("cookies", []):
        domain = str(cookie.get("domain", ""))
        if domain.lstrip(".") not in {"qishui.com", "api.qishui.com", "bff-pc.qishui.com", "www.qishui.com"}:
            continue
        state["jar"].set_cookie(http.cookiejar.Cookie(
            version=0, name=cookie["name"], value=cookie["value"], port=None, port_specified=False,
            domain=domain, domain_specified=True, domain_initial_dot=domain.startswith("."),
            path=cookie.get("path", "/"), path_specified=True, secure=bool(cookie.get("secure")),
            expires=cookie.get("expires") if cookie.get("expires", -1) > 0 else None, discard=False,
            comment=None, comment_url=None, rest={"HttpOnly": None} if cookie.get("httpOnly") else {}, rfc2109=False))
    _diagnostic(state, _stage(parsed.path), http_status=int(result.get("status", 0)))
    if not 200 <= result.get("status", 0) < 400:
        raise AuthError(502, "qishui_auth_upstream", "汽水登录服务暂时不可用，请稍后重试")
    if not json_response:
        return None
    try:
        value = json.loads(result["body"])
        if not isinstance(value, dict):
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        raise AuthError(502, "qishui_auth_response", "汽水安全会话返回格式异常") from None
    _diagnostic(state, _stage(parsed.path), result=value)
    return value
