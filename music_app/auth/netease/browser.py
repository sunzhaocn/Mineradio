"""网易云原生网页扫码：二维码、人工验证和 Cookie 始终属于同一隔离浏览器。

每个登录流程由专属线程拥有 Playwright。使用本机正常 Chrome/Edge 安全设置，
不读取用户浏览器资料、不保存凭据、不处理验证码或自动同意用户协议。
"""
import concurrent.futures
from contextlib import ExitStack
import os
from pathlib import Path
import queue
import re
import threading
import time
import urllib.parse

HOME = "https://music.163.com/"
TTL = 600
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_LOGIN_COOKIES = frozenset({"MUSIC_U", "__csrf", "MUSIC_R_U", "MUSIC_R_T", "MUSIC_A_T", "MUSIC_SNS"})
_QR_READY = """() => {
  const c = document.querySelector('.mrc-modal-container canvas');
  if (!c || !c.width || !c.height) return false;
  const rect = c.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  try {
    const pixels = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let dark=0, light=0;
    for (let i=0;i<pixels.length;i+=4) {
      if (pixels[i+3] > 200 && pixels[i]+pixels[i+1]+pixels[i+2] < 180) dark++;
      if (pixels[i+3] > 200 && pixels[i]+pixels[i+1]+pixels[i+2] > 660) light++;
    }
    return dark > c.width*c.height*0.12 && light > c.width*c.height*0.12;
  } catch (_) { return false; }
}"""


class AuthError(Exception):
    def __init__(self, status, code, message, diagnostics=None):
        super().__init__(message)
        self.status, self.code = status, code
        self.diagnostics = diagnostics or {}


def _diagnostics(state, **updates):
    value = dict(state.get("diagnostics") or {})
    value.update(updates)
    # Values are fixed phase names, integer codes, and cookie field names only.
    value["protocol"] = "weapi"
    state["diagnostics"] = value
    return dict(value)


def _chromium_path():
    configured = os.environ.get("NETEASE_BROWSER_PATH")
    candidates = [configured] if configured else [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    raise AuthError(503, "netease_browser_missing", "网易云官网登录需要本机 Chrome 或 Edge 浏览器")


def _decode_native_qr(image):
    """Optional URL metadata; the original canvas PNG remains the source of truth."""
    try:
        import base64
        import cv2
        import numpy as np
        pixels = cv2.imdecode(np.frombuffer(base64.b64decode(image.split(",", 1)[1]), dtype=np.uint8), cv2.IMREAD_COLOR)
        pixels = cv2.copyMakeBorder(pixels, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        value, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
        parsed = urllib.parse.urlsplit(value)
        if (parsed.scheme == "https" and parsed.hostname == "music.163.com"
                and parsed.path == "/st/platform/scanlogin" and not parsed.username and not parsed.password):
            return value  # Preserve chainId, codekey, device fields and experiments verbatim.
    except Exception:
        pass
    return ""


def _open_native_qr(page):
    page.goto(HOME, wait_until="domcontentloaded", timeout=25000)
    page.wait_for_function("typeof window.login === 'function'", timeout=20000)
    trigger = page.locator('.m-tophead a[data-action="login"]')
    if trigger.count():
        trigger.first.click(timeout=10000)
    else:
        page.evaluate("window.login()")
    page.wait_for_function(_QR_READY, timeout=25000)
    image = page.locator(".mrc-modal-container canvas").first.evaluate("canvas => canvas.toDataURL('image/png')")
    if not isinstance(image, str) or not image.startswith("data:image/png;base64,"):
        raise AuthError(502, "netease_native_qr_missing", "网易云原生二维码尚未生成，请在官网窗口检查网络后重试")
    return {"qr_image": image, "qr_url": _decode_native_qr(image)}


def _cookie_values(cookies):
    values = {}
    for item in cookies:
        domain = str(item.get("domain", "")).lstrip(".").lower()
        if domain != "163.com" and domain != "music.163.com" and not domain.endswith(".music.163.com"):
            continue
        name, value = item.get("name"), item.get("value")
        if (isinstance(name, str) and _NAME.fullmatch(name) and isinstance(value, str)
                and value and not re.search(r"[\r\n;]", value)):
            expires = item.get("expires", -1)
            if isinstance(expires, (int, float)) and expires > 0 and expires <= time.time():
                continue
            values[name] = value
    return values


def _account(data):
    if not isinstance(data, dict):
        return {}
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}
    account = data.get("account") if isinstance(data.get("account"), dict) else {}
    result = {}
    user_id = profile.get("userId") or account.get("id")
    if user_id:
        result["id"] = str(user_id)
    for target, source in (("name", "nickname"), ("avatar", "avatarUrl")):
        if profile.get(source):
            result[target] = profile[source]
    if profile.get("vipType") is not None:
        result["vip_type"] = profile["vipType"]
    return result


def _close_browser_resource(resource):
    try:
        resource.close()
    except Exception:
        pass


def _result(state, snapshot):
    values = _cookie_values(snapshot.get("cookies", []))
    code = snapshot.get("upstream_code")
    diagnostic = _diagnostics(state, stage="browser_check", jar_cookie_names=sorted(values),
                              upstream_code=code if isinstance(code, int) else None)
    if values.get("MUSIC_U"):
        diagnostic = _diagnostics(state, stage="authorized", confirmed=True, has_session_cookie=True,
                                  account_lookup_failed=bool(snapshot.get("account_lookup_failed")))
        data = snapshot.get("account")
        if isinstance(data, dict) and isinstance(data.get("code"), int):
            diagnostic = _diagnostics(state, account_code=data["code"])
        result = {"status": "authorized", "message": "网易云音乐登录成功", "upstream_code": 803,
                  "cookie": "; ".join(f"{name}={value}" for name, value in values.items()),
                  "credentials": {name: values[name] for name in sorted(_LOGIN_COOKIES) if name in values},
                  "account": _account(data), "diagnostics": diagnostic}
        state["authorized"] = result
        return result
    # An 803 response alone is insufficient: only this context's MUSIC_U authorizes.
    if snapshot.get("closed"):
        return {"status": "cancelled", "message": "本次网易云官网登录窗口已关闭，请重新生成二维码", "diagnostics": diagnostic}
    if code == 8821 or snapshot.get("verification_required"):
        _diagnostics(state, stage="verification_required", verification_required=True)
        return {"status": "verification_required", "message": "请在本次专属网易云官网登录窗口完成安全验证，完成后会自动接收登录信息",
                "upstream_code": 8821, "verification_type": "risk_control", "diagnostics": dict(state["diagnostics"])}
    status, message = {
        800: ("expired", "网易云二维码已过期，请重新生成"),
        802: ("scanned", "已扫码，请在手机上确认；如有验证请在本次官网窗口完成"),
        803: ("scanned", "网易云已确认扫码，正在等待本次官网登录窗口接收登录凭据"),
    }.get(code, ("waiting", "等待网易云音乐 App 扫码；可在本次官网窗口完成登录或验证"))
    result = {"status": status, "message": message, "diagnostics": diagnostic}
    if isinstance(code, int):
        result["upstream_code"] = code
    return result


class _OfficialBrowser:
    """One private BrowserContext, permanently owned by one daemon thread."""
    def __init__(self, state):
        self.state, self.commands = state, queue.Queue()
        self.closed = threading.Event()
        self.failure = None
        self.thread = threading.Thread(target=self._worker, daemon=True, name="netease-official-login")
        self.thread.start()

    def call(self, method):
        if self.closed.is_set():
            if self.failure:
                raise self.failure
            if method == "check":
                return {"closed": True, "cookies": []}
            raise AuthError(409, "netease_browser_closed", "本次网易云官网登录窗口已关闭，请重新生成二维码")
        future = concurrent.futures.Future()
        self.commands.put((method, future))
        try:
            return future.result(timeout=80 if method == "create" else 25)
        except concurrent.futures.TimeoutError:
            self.close()
            raise AuthError(504, "netease_browser_timeout", "网易云官网登录窗口响应超时，请检查该窗口后重新生成二维码") from None

    def close(self):
        if not self.closed.is_set():
            self.commands.put(("close", None))

    def _worker(self):
        browser = None
        pending = None
        try:
            from playwright.sync_api import sync_playwright
            # ExitStack closes context, then browser, before Playwright itself stops.
            with sync_playwright() as pw, ExitStack() as cleanup:
                browser = pw.chromium.launch(executable_path=_chromium_path(),
                                            headless=os.environ.get("NETEASE_LOGIN_HEADLESS") == "1")
                cleanup.callback(_close_browser_resource, browser)
                context = browser.new_context(viewport={"width": 1100, "height": 820}, accept_downloads=False)
                cleanup.callback(_close_browser_resource, context)
                page = context.new_page()
                observed = {"upstream_code": None, "verification_required": False}

                def response_seen(response):
                    target = urllib.parse.urlsplit(response.url)
                    if target.hostname != "music.163.com":
                        return
                    path = target.path
                    if path not in ("/weapi/login/qrcode/unikey", "/weapi/login/qrcode/client/login"):
                        return
                    try:
                        data = response.json()
                        code = data.get("code") if isinstance(data, dict) else None
                        if isinstance(code, str) and code.isdigit():
                            code = int(code)
                        if not isinstance(code, int):
                            return
                        _diagnostics(self.state, stage="native_qr_create" if path.endswith("unikey") else "native_qr_check",
                                     http_status=response.status, upstream_code=code,
                                     response_fields=sorted(name for name in data if _NAME.fullmatch(name)))
                        if path.endswith("unikey"):
                            if code == 200:
                                observed.update(upstream_code=801, verification_required=False)
                        else:
                            observed["upstream_code"] = code
                            if code == 8821:
                                observed["verification_required"] = True
                    except Exception:
                        pass

                context.on("response", response_seen)
                while time.monotonic() < self.state["deadline"]:
                    try:
                        method, pending = self.commands.get(timeout=0.1)
                    except queue.Empty:
                        if not browser.is_connected():
                            break
                        pages = [candidate for candidate in context.pages if not candidate.is_closed()]
                        if not pages:
                            break
                        try:
                            pages[-1].wait_for_timeout(100)  # Pump the native site's requests and response callbacks.
                        except Exception:
                            if not browser.is_connected() or not context.pages:
                                break
                            raise
                        continue
                    if method == "close":
                        break
                    try:
                        if method == "create":
                            result = _open_native_qr(page)
                            _diagnostics(self.state, stage="native_qr_ready")
                        elif method == "show":
                            pages = [candidate for candidate in context.pages if not candidate.is_closed()]
                            if not pages:
                                raise AuthError(409, "netease_browser_closed", "本次网易云官网登录窗口已关闭，请重新生成二维码")
                            pages[-1].bring_to_front()
                            result = True
                        elif method == "check":
                            if not browser.is_connected() or not context.pages:
                                pending.set_result({"cookies": [], "closed": True})
                                pending = None
                                break
                            cookies = context.cookies(HOME)
                            result = dict(observed, cookies=cookies, closed=not any(not candidate.is_closed() for candidate in context.pages))
                            if _cookie_values(cookies).get("MUSIC_U"):
                                try:
                                    response = context.request.get(HOME + "api/nuser/account/get", timeout=10000,
                                                                   headers={"Referer": HOME})
                                    data = response.json()
                                    result["account"] = data if isinstance(data, dict) else {}
                                    result["account_lookup_failed"] = not isinstance(data, dict) or data.get("code") != 200
                                except Exception:
                                    result["account_lookup_failed"] = True
                                # Include cookies refreshed by the same-context account request.
                                result["cookies"] = context.cookies(HOME)
                        else:
                            raise AuthError(400, "netease_browser_operation", "不支持的网易云登录操作")
                        pending.set_result(result)
                    except Exception as exc:
                        error = exc if isinstance(exc, AuthError) else AuthError(502, "netease_native_browser_request", "网易云官网登录窗口请求失败，请检查窗口后重试")
                        pending.set_exception(error)
                    finally:
                        pending = None
        except Exception as exc:
            _diagnostics(self.state, stage="browser_unavailable")
            self.failure = exc if isinstance(exc, AuthError) else AuthError(503, "netease_browser_unavailable", "网易云官网登录窗口未能启动，请检查浏览器与 Playwright 是否可用")
        finally:
            self.closed.set()
            error = self.failure or AuthError(409, "netease_browser_closed", "本次网易云官网登录窗口已关闭，请重新生成二维码")
            if pending and not pending.done():
                pending.set_exception(error)
            while not self.commands.empty():
                _method, future = self.commands.get_nowait()
                if future and not future.done():
                    future.set_exception(error)


def create_session():
    state = {"deadline": time.monotonic() + TTL}
    runtime = _OfficialBrowser(state)
    state["browser_runtime"] = runtime
    try:
        result = runtime.call("create")
    except Exception:
        runtime.close()
        raise
    return {"state": state, "expires_in": TTL, "interactive_window": True,
            "message": "请扫描本次官网原生二维码；需要验证时在已打开的专属网易云窗口完成",
            "qr_url": result.get("qr_url", ""), "qr_image": result["qr_image"],
            "diagnostics": dict(state.get("diagnostics", {}))}


def check_session(state):
    if state.get("authorized"):
        return state["authorized"]
    return _result(state, state["browser_runtime"].call("check"))


def show_session(state):
    return state["browser_runtime"].call("show")


def close_session(state):
    runtime = state.get("browser_runtime")
    if runtime:
        runtime.close()
