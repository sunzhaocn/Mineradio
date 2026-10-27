"""汽水二维码创建、状态查询与一次性授权兑换。"""

import base64
import http.cookiejar
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from music_app.auth.qishui.common import AuthError, HOST, POLL_INTERVAL, USER_AGENT, _diagnostic
from music_app.auth.qishui.transport import _allowed_url, _new_state, _request


def _qr_image(url):
    # 可选依赖；始终编码本次上游原样扫码入口。
    try:
        import qrcode
        image = qrcode.make(url)
        output = io.BytesIO()
        image.save(output, format="PNG")
        return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    except ImportError:
        return ""


def create_session():
    # Only the initial, not-yet-delivered QR GET may be retried. A fresh
    # browser/context avoids reusing a failed security page. Confirmation and
    # credential exchange requests never pass through this retry boundary.
    for attempt in range(2):
        state = _new_state()
        try:
            result = _request(state, "/passport/web/get_qrcode/", query={
                **state["query"], "next": HOST, "need_logo": "false", "need_short_url": "false"})
            break
        except AuthError as error:
            close_session(state)
            if attempt or error.status != 502 or error.code not in {
                    'qishui_browser_request', 'qishui_browser_closed', 'qishui_auth_upstream'}:
                raise
    data = result.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("token"), str) or not data["token"]:
        close_session(state)
        raise AuthError(502, "qishui_auth_create", "汽水未返回登录二维码，请稍后重试")
    if data.get("error_code", 0):
        close_session(state)
        raise AuthError(502, "qishui_auth_create", "汽水未接受二维码请求，请稍后重试")
    expires_in = 180
    try:
        expiry = float(data.get("expire_time", expires_in))
        # 兼容上游秒时间戳、毫秒时间戳和有效秒数。
        if expiry > 10**12:
            expiry /= 1000
        if expiry > 10**9:
            expiry -= time.time()
        expires_in = max(1, min(600, int(expiry)))
    except (TypeError, ValueError, OverflowError):
        pass
    state.update(token=data["token"], is_frontier=bool(data.get("is_frontier")),
                 expires_at=time.time() + expires_in)
    qr_url = data.get("qrcode_index_url") or data.get("web_url")
    if not isinstance(qr_url, str) or not _allowed_url(qr_url):
        runtime = state.get("signed_runtime")
        if runtime:
            runtime.close()
        raise AuthError(502, "qishui_auth_qr_url", "汽水未返回官方扫码地址，请重新获取二维码")
    from music_app.platform_runtime import is_ios
    return {"qr_url": qr_url, "qr_image": _qr_image(qr_url), "expires_in": expires_in,
            "message": "请打开汽水音乐 App，在搜索框右侧使用扫一扫并确认登录", "state": state,
            **({'interactive_window': True} if is_ios() else {})}


def show_session(state):
    runtime = state.get('signed_runtime')
    if runtime and hasattr(runtime, 'show'):
        runtime.show()
        return {'status': 'waiting', 'message': '请在汽水安全验证窗口完成操作'}
    raise AuthError(503, 'qishui_verification_window', '当前没有可打开的安全验证窗口')


def verify_session(state, raw):
    if not state.get('mfa_pending') or not state.get('remote_verification') or not state.get('signed_runtime'):
        raise AuthError(409,'qishui_verification_inactive','当前没有待完成的汽水验证')
    if not raw:
        return state['signed_runtime'].call('verify_view')
    try:
        value=json.loads(raw)
        if not isinstance(value,dict):raise ValueError()
        action=value.get('action')
        def point(x,y):
            return type(x) in (int,float) and type(y) in (int,float) and 0 <= x < 980 and 0 <= y < 760
        valid=False
        if action=='tap':valid=set(value)=={'action','x','y'} and point(value['x'],value['y'])
        elif action=='drag':
            points=value.get('points')
            valid=set(value)=={'action','points'} and isinstance(points,list) and 2<=len(points)<=48 and all(isinstance(p,list) and len(p)==2 and point(*p) for p in points)
        elif action=='text':
            text=value.get('text')
            valid=set(value)=={'action','text'} and isinstance(text,str) and 0<len(text)<=128 and not any(ord(c)<32 or ord(c)==127 for c in text)
        elif action=='key':valid=set(value)=={'action','key'} and value.get('key') in ('Enter','Backspace','Tab','Escape')
        if not valid:raise ValueError()
    except (ValueError,TypeError,KeyError):
        raise AuthError(400,'qishui_verification_input','验证操作格式无效') from None
    return state['signed_runtime'].call('verify_input',value)


def _cookie_values(state):
    state["jar"].clear_expired_cookies()
    return {c.name: c.value for c in state["jar"]
            if c.domain.lstrip(".") in {"qishui.com", "api.qishui.com"} and c.value}


def _ingest_session_cookie(state, data):
    """Passport 也会把 Cookie header 放在 JSON session_cookie，而非 Set-Cookie。

    只接受当前轮询由 api.qishui.com 返回的字段；从不取文件/其他会话资料。
    这些 Cookie 归属当前官方 Qishui 登录流程，写入本流程的 CookieJar 后
    账号查询、返回 Cookie 和 session_config 使用同一份新凭据。
    """
    raw = data.get("session_cookie")
    if raw in (None, ""):
        return
    if not isinstance(raw, str) or len(raw) > 65536 or any(ord(c) < 32 or ord(c) == 127 for c in raw):
        raise AuthError(502, "qishui_auth_cookie", "汽水返回的登录会话格式异常，请重新扫码")
    attributes = {"domain", "path", "expires", "max-age", "secure", "httponly", "samesite", "priority"}
    for pair in raw.split(";"):
        name, separator, value = pair.strip().partition("=")
        name, value = name.strip(), value.strip()
        if not separator or name.lower() in attributes:
            continue
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}", name) or not value:
            continue
        state["jar"].set_cookie(http.cookiejar.Cookie(
            version=0, name=name, value=value, port=None, port_specified=False,
            domain=".qishui.com", domain_specified=True, domain_initial_dot=True,
            path="/", path_specified=True, secure=True, expires=None, discard=True,
            comment=None, comment_url=None, rest={"HttpOnly": None}, rfc2109=False))
    _diagnostic(state, "session_cookie")


def _account(data):
    for key in ("my_info", "user", "user_info"):
        if isinstance(data.get(key), dict):
            data = data[key]
            break
    result = {}
    for output, candidates in (("id", ("id", "user_id", "uid")),
                               ("name", ("nickname", "name", "screen_name")),
                               ("avatar", ("avatar_url", "avatar"))):
        for key in candidates:
            value = data.get(key)
            if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value):
                result[output] = str(value)
                break
    return result


def _authorized(state, data, *, profile_verified=False):
    q = state["query"]
    query = {"aid": "386088", "app_name": "luna_pc", "region": "cn", "geo_region": "cn",
             "os_region": "cn", "sim_region": "", "device_id": q["device_id"],
             "iid": q["install_id"], "version_name": "3.7.0", "version_code": "30070000",
             "channel": "official", "build_mode": "master", "ac": "wifi",
             "tz_name": "Asia/Shanghai", "device_platform": "windows", "device_type": "Windows",
             "os_version": "Windows 10", "fp": q["device_id"]}
    account = _account(data)
    # 本次新 Cookie 的账号信息；查询失败不丢弃已获得的会话，也不编造头像/昵称。
    if not profile_verified:
        try:
            profile = _request(state, "/passport/account/info/v2/", query=state["query"])
            if profile.get("message") == "success" and isinstance(profile.get("data"), dict):
                account.update(_account(profile["data"]))
        except AuthError:
            pass
    values = _cookie_values(state)
    cookie = "; ".join(f"{k}={v}" for k, v in sorted(values.items()))
    credentials = {"device_id": q["device_id"], "install_id": q["install_id"],
                   **{k: v for k, v in values.items() if k in {
                       "sessionid", "sessionid_ss", "sid_tt", "sid_guard", "uid_tt", "uid_tt_ss",
                       "ttwid", "msToken", "passport_csrf_token", "passport_csrf_token_default"}}}
    result = {"status": "authorized", "message": "汽水音乐扫码登录成功", "cookie": cookie,
            "account": account, "credentials": credentials,
            "session_config": {"query": query, "headers": {"cookie": cookie, "user-agent": USER_AGENT}}}
    if state.get("signed_runtime"):
        state["signed_runtime"].close()
    return result


def _verification_params(data):
    value = data.get("biz_params")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = dict(urllib.parse.parse_qsl(value))
    return {str(k): str(v) for k, v in value.items() if isinstance(v, (str, int))} if isinstance(value, dict) else {}


def close_session(state):
    """供会话管理器主动清理；不等待正在执行的浏览器请求，TTL也会自动回收。"""
    if isinstance(state, dict) and state.get("signed_runtime"):
        state["signed_runtime"].close()


def check_session(state):
    if not isinstance(state, dict) or not state.get("token"):
        raise AuthError(400, "qishui_auth_session", "汽水扫码会话无效，请重新获取二维码")
    from music_app.platform_runtime import is_ios
    if state.get("last_result", {}).get("status") == "authorized":
        return state["last_result"]
    if time.time() >= state.get("expires_at", 0):
        if state.get("signed_runtime"):
            state["signed_runtime"].close()
        return {"status": "expired", "message": "二维码已过期，请重新获取"}
    if time.time() < state.get("next_poll_at", 0):
        return {**state["last_result"], "retry_after": max(1, int(state["next_poll_at"] - time.time()))}
    resend = False
    if state.get("mfa_pending"):
        verified = state["signed_runtime"].call("verify_status")
        if verified is None:
            message = ("请点击“打开验证窗口”完成汽水安全验证" if is_ios()
                       else "请在弹出的汽水安全验证窗口完成验证")
            return {"status": "scanned", "message": message,
                    "verification_required": True, 'remote_verification':bool(state.get('remote_verification'))}
        state["mfa_pending"] = False
        if not isinstance(verified, dict) or verified.get("status") is not True:
            state["signed_runtime"].close()
            return {"status": "cancelled", "message": "汽水身份验证未完成，请重新扫码"}
        resend = True
        _diagnostic(state, "verification_completed")
    state["next_poll_at"] = time.time() + POLL_INTERVAL
    result = _request(state, "/passport/web/check_qrconnect/", query={**state["query"], **({"isResend": "true"} if resend else {})}, form={
        "need_logo": "false", "need_short_url": "false",
        # 官方扫码组件 Te() 始终为 true；get_qrcode 返回值只控制 WebSocket。
        "is_frontier": "true", "token": state["token"],
        "is_new_login": "1", "next": HOST, **(state.get("mfa_business", {}) if resend else {})})
    data = result.get("data")
    if not isinstance(data, dict):
        raise AuthError(502, "qishui_auth_response", "汽水扫码状态响应异常")
    error = data.get("error_code", 0)
    status = str(data.get("status", "")).lower()
    status = {"1": "new", "2": "scanned", "3": "confirmed", "4": "expired", "5": "refused"}.get(status, status)
    _diagnostic(state, "poll_result", result=result)
    if error == 7:
        state["security_rejections"] = state.get("security_rejections", 0) + 1
        state["next_poll_at"] = time.time() + 5
        if state["security_rejections"] >= 3:
            if state.get("signed_runtime"):
                state["signed_runtime"].close()
            raise AuthError(429, "qishui_security_rejected", "汽水安全校验持续未通过，请稍后重新扫码；本次尚未取得登录会话")
        state["last_result"] = {"status": "cooldown", "message": "汽水安全校验暂未通过，5 秒后重试", "upstream_code": 7}
        return {**state["last_result"], "retry_after": 5}
    state["security_rejections"] = 0
    if error == 2046 or data.get("account_flow") == "verify":
        if state.get("signed_runtime"):
            decision = {**result, **data, "verify_portrait_id": state["verify_portrait_id"]}
            decision.pop("data", None)
            state["expires_at"] = time.time() + 600
            state["mfa_business"] = _verification_params(decision)
            state["signed_runtime"].call("verify_start", {"decision": decision, "options": {"generalParams": {
                "device_id": state["query"]["device_id"], "install_id": state["query"]["install_id"],
                "did": state["query"]["device_id"], "iid": state["query"]["install_id"],
                "device_platform": "PC", "version_code": "3.7.0"}}})
            state["mfa_pending"] = True
        message = ("汽水要求额外身份验证，请点击“打开验证窗口”完成验证" if is_ios()
                   else "汽水要求额外身份验证，请在弹出的汽水安全验证窗口完成验证")
        outcome = {"status": "verification_required", "message": message,
                   "verification_required": True, 'remote_verification':bool(state.get('remote_verification'))}
    elif error:
        raise AuthError(502, "qishui_auth_rejected", "汽水暂未接受扫码登录，请重新获取二维码或稍后重试")
    else:
        _ingest_session_cookie(state, data)
        redirect = data.get("redirect_url")
        values = _cookie_values(state)
        if redirect and status == "confirmed" and not any(values.get(k) for k in ("sessionid", "sessionid_ss", "sid_tt", "sid_guard")):
            _request(state, redirect, json_response=False)
        values = _cookie_values(state)
        if any(values.get(k) for k in ("sessionid", "sessionid_ss", "sid_tt", "sid_guard")) and (
                status in {"confirmed", "success"} or bool(data.get("session_cookie")) or data.get("logged_in") is True):
            outcome = _authorized(state, data)
        elif status in {"scanned", "confirmed"}:
            message = ("手机已确认，正在等待汽水签发登录会话" if status == "confirmed"
                       else "已扫码，请在手机上确认")
            outcome = {"status": "scanned", "message": message}
        elif status == "expired":
            outcome = {"status": "expired", "message": "二维码已过期，请重新获取"}
        elif status in {"cancelled", "canceled", "cancel", "refused", "rejected"}:
            outcome = {"status": "cancelled", "message": "已取消汽水音乐登录"}
        elif status in {"new", ""}:
            outcome = state["last_result"]
        else:
            raise AuthError(502, "qishui_auth_state", "汽水返回了未知扫码状态，请重新获取二维码")
    state["last_result"] = outcome
    if outcome["status"] in {"expired", "cancelled"} and state.get("signed_runtime"):
        state["signed_runtime"].close()
    return outcome
