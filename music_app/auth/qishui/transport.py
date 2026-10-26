"""汽水扫码请求、受信任跳转与独立 Cookie 会话。"""

import http.cookiejar
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from music_app.auth.qishui.browser import _browser_request
from music_app.auth.qishui.common import AuthError, HOST, MAX_RESPONSE, USER_AGENT, _ALLOWED_HOSTS, _diagnostic, _stage


def _allowed_url(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname in _ALLOWED_HOSTS
                and parsed.port in (None, 443) and not parsed.username and not parsed.password)
    except (ValueError, TypeError):
        return False


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _allowed_url(newurl):
            raise AuthError(502, "qishui_auth_redirect", "汽水登录跳转地址不受支持")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _request(state, route, *, query=None, form=None, json_response=True):
    url = route if route.startswith("https://") else HOST + route
    if not _allowed_url(url):
        raise AuthError(502, "qishui_auth_redirect", "汽水登录跳转地址不受支持")
    if query:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json, text/javascript",
               "Referer": "https://www.qishui.com/", "Origin": "https://www.qishui.com"}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        csrf = next((c.value for c in state["jar"] if c.name == "passport_csrf_token"), "")
        if csrf:
            headers["X-Tt-Passport-Csrf-Token"] = csrf
    try:
        if state.get("browser_required"):
            return _browser_request(state, url, headers, data, json_response)
        req = urllib.request.Request(url, data=data, headers=headers)
        with state["opener"].open(req, timeout=20) as response:
            raw = response.read(MAX_RESPONSE + 1)
            _diagnostic(state, _stage(route), response=response)
        if len(raw) > MAX_RESPONSE:
            raise ValueError()
        if not json_response:
            return None
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError()
        _diagnostic(state, _stage(route), result=result)
        return result
    except AuthError:
        raise
    except urllib.error.HTTPError as exc:
        _diagnostic(state, _stage(route), upstream_http_status=exc.code)
        status = 429 if exc.code == 429 else 502
        raise AuthError(status, "qishui_auth_upstream", "汽水登录服务暂时不可用，请稍后重试") from None
    except (OSError, ValueError, TypeError):
        raise AuthError(502, "qishui_auth_upstream", "汽水登录请求超时或响应异常，请稍后重试") from None


def _new_state():
    jar = http.cookiejar.CookieJar()
    # 独立生成本次客户端标识，不借用磁盘/其他扫码会话的设备或登录态。
    device_id = str(secrets.randbelow(8 * 10**15) + 10**15)
    install_id = str(secrets.randbelow(8 * 10**14) + 10**14)
    return {"jar": jar, "opener": urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), _Redirects()),
        "browser_required": True, "ms_token": secrets.token_urlsafe(88) + "==",
        "verify_portrait_id": str(uuid.uuid4()) + ".login", "expires_at": time.time() + 300,
        "query": {"passport_jssdk_version": "3.4.10", "passport_jssdk_type": "normal",
                  "is_from_ttaccountsdk": "1", "aid": "386088", "language": "zh",
                  "is_new_login": "1", "is_from_iesaccountsaas": "1",
                  "account_sdk_source": "web", "device_id": device_id,
                  "install_id": install_id, "did": device_id, "iid": install_id,
                  "device_platform": "PC", "version_code": "3.7.0"},
        "last_poll": 0, "last_result": {"status": "waiting", "message": "请使用汽水音乐 App 扫码"}}
