"""QQ Music QR authorization, with an isolated in-memory cookie jar per QR.

Protocol reference (checked 2026-10-23):
https://github.com/l-1124/qqmusicapi/blob/main/qqmusic_api/modules/login.py
https://github.com/l-1124/qqmusicapi/blob/main/qqmusic_api/core/executor.py

Network and authorization use the Python standard library. OpenCV/numpy, when
installed, additionally decode the scan URL; the official QR image is always
returned and remains usable without those optional dependencies. Do not log the
state, QR contents, OAuth redirects, cookies, or successful result.
"""

import base64
import http.cookiejar
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass


TIMEOUT = 15
EXPIRES_IN = 180
REFERER = "https://xui.ptlogin2.qq.com/"
MUSIC_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
_CALLBACK = re.compile(r"^\s*ptuiCB\((.*?)\)\s*;?\s*$", re.S)
_ARGS = re.compile(r"'((?:\\.|[^'\\])*)'")


class AuthError(Exception):
    """An error safe to return to an API client (never contains upstream text)."""

    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class _Response:
    status: int
    headers: object
    body: bytes


def _request(state, url, *, params=None, data=None, payload=None, referer=REFERER):
    """Keep redirects local so OAuth tickets never reach arbitrary URLs."""
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"User-Agent": _UA, "Referer": referer}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json;charset=utf-8"
        headers["Origin"] = "https://y.qq.com"
    elif data is not None:
        data = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = urllib.request.Request(url, data=data, headers=headers)
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(state["jar"]), _NoRedirect()
    )
    try:
        try:
            response = opener.open(request, timeout=TIMEOUT)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                response = exc
            else:
                exc.close()
                raise AuthError(502, "qqmusic_upstream_http", "QQ 音乐登录服务暂时不可用") from None
        with response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                raise AuthError(502, "qqmusic_response_too_large", "QQ 音乐登录服务响应异常")
            return _Response(response.code, response.headers, body)
    except AuthError:
        raise
    except (urllib.error.URLError, OSError, TimeoutError):
        raise AuthError(502, "qqmusic_network_error", "连接 QQ 音乐登录服务失败，请稍后重试") from None


def _cookie(state, name):
    # CookieJar may contain the same name on several domains. Never flatten the
    # jar when sending requests: the standard policy must enforce domain/path.
    values = [item.value for item in state["jar"] if item.name == name and not item.is_expired()]
    return values[-1] if values else ""


def _hash33(value, seed=0):
    for char in value:
        seed = (seed * 33 + ord(char)) & 0x7FFFFFFF
    return seed


def _decode_qr(image):
    try:
        import cv2
        import numpy

        pixels = cv2.imdecode(numpy.frombuffer(image, dtype=numpy.uint8), cv2.IMREAD_COLOR)
        if pixels is None:
            return ""
        # QQ currently encodes an http://txz.qq.com URL. Preserve the exact
        # official scan contents; changing its scheme would change the QR.
        detector = cv2.QRCodeDetector()
        for scale in (1, 3):
            candidate = pixels if scale == 1 else cv2.resize(
                pixels, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST
            )
            candidate = cv2.copyMakeBorder(candidate, 12, 12, 12, 12,
                                          cv2.BORDER_CONSTANT, value=(255, 255, 255))
            url, _, _ = detector.detectAndDecode(candidate)
            parts = urllib.parse.urlsplit(url)
            if parts.scheme in ("http", "https") and parts.hostname and parts.hostname.endswith(".qq.com"):
                return url
    except Exception:
        # A URL decoder failure must not make the official image unusable.
        pass
    return ""


def _image_mime(image):
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    raise AuthError(502, "qqmusic_invalid_qr", "QQ 登录服务未返回有效二维码，请重新创建")


def _extension(name, state=None):
    """Keep each QR session bound to its originally selected backend."""
    if state is not None and state.get("_extension"):
        return state["_extension"]
    import importlib
    names = {"mobile": "music_app.auth.qqmusic.mobile", "extra": "music_app.auth.qqmusic.extra"}
    return importlib.import_module(names[name])


def _mobile_operation(operation, state=None):
    try:
        mobile = _extension("mobile", state)
    except (ImportError, OSError):
        raise AuthError(503, "qqmusic_mobile_unavailable", "QQ 音乐客户端扫码模块未安装") from None
    try:
        if operation == "create":
            result = mobile.create_session(base=sys.modules[__name__])
            result["state"]["method"] = "mobile"
            result["state"]["_extension"] = mobile
            return result
        return mobile.check_session(state)
    except mobile.AuthError as exc:
        error = AuthError(exc.status, exc.code, str(exc))
        error.diagnostics = getattr(exc, "diagnostics", {})
        raise error from None


def create_session(method="qq"):
    """Return official QQ QR image and private state; no credentials are loaded."""
    if method == "mobile":
        return _mobile_operation("create")
    if method not in ("", "qq"):
        extra = _extension("extra")
        result = extra.create_session(method, sys.modules[__name__])
        result["state"]["_extension"] = extra
        return result
    state = {"jar": http.cookiejar.CookieJar(), "expires_at": time.time() + EXPIRES_IN}
    response = _request(state, "https://ssl.ptlogin2.qq.com/ptqrshow", params={
        "appid": "716027609", "e": "2", "l": "M", "s": "3", "d": "72", "v": "4",
        "t": str(random.random()), "daid": "383", "pt_3rd_aid": "100497308",
    })
    mime = _image_mime(response.body)
    qrsig = _cookie(state, "qrsig")
    if response.status != 200 or not qrsig:
        raise AuthError(502, "qqmusic_missing_qrsig", "QQ 登录服务未创建有效会话，请重试")
    state["qrsig"] = qrsig
    return {
        "qr_url": _decode_qr(response.body),
        "qr_image": "data:" + mime + ";base64," + base64.b64encode(response.body).decode("ascii"),
        "expires_in": EXPIRES_IN,
        "message": "请使用手机 QQ 扫码，并在手机上确认登录 QQ 音乐",
        "state": state,
    }


def _unescape_js(value):
    def replace(match):
        escaped = match.group(1)
        if escaped.startswith(("x", "u")):
            return chr(int(escaped[1:], 16))
        return {"n": "\n", "r": "\r", "t": "\t"}.get(escaped, escaped)

    return re.sub(r"\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)", replace, value)


def _callback_args(body):
    text = body.decode("utf-8", errors="replace")
    match = _CALLBACK.fullmatch(text)
    args = [_unescape_js(value) for value in _ARGS.findall(match.group(1))] if match else []
    if not args or not args[0].isdigit():
        raise AuthError(502, "qqmusic_invalid_status", "无法识别 QQ 登录状态，请稍后重试")
    return args


def _music_cookie_header(state, musicid, musickey):
    request = urllib.request.Request(MUSIC_URL)
    state["jar"].add_cookie_header(request)
    values = {}
    for part in (request.get_header("Cookie") or "").split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            # qrsig and ptlogin tickets are not needed for QQ Music requests.
            if key not in ("qrsig", "pt_login_sig", "ptcz", "ptdrvs", "pt_local_token"):
                values[key] = value
    values.update({
        "uin": musicid, "qqmusic_uin": musicid,
        "qqmusic_key": musickey, "qm_keyst": musickey, "tmeLoginType": "2",
    })
    return "; ".join(key + "=" + value for key, value in values.items() if value)


def _authorize(state, redirect_url, nickname=""):
    parts = urllib.parse.urlsplit(redirect_url)
    # Use parsed values with a fixed endpoint, rather than following callback URL.
    if parts.scheme != "https" or parts.hostname != "ssl.ptlogin2.graph.qq.com" or parts.path != "/check_sig":
        raise AuthError(502, "qqmusic_invalid_callback", "QQ 登录确认响应异常，请重新扫码")
    query = urllib.parse.parse_qs(parts.query)
    uin = query.get("uin", [""])[0]
    ptsigx = query.get("ptsigx", [""])[0]
    if not uin.isdigit() or not ptsigx:
        raise AuthError(502, "qqmusic_missing_ticket", "QQ 登录确认缺少票据，请重新扫码")

    _request(state, "https://ssl.ptlogin2.graph.qq.com/check_sig", params={
        "uin": uin, "pttype": "1", "service": "ptqrlogin", "nodirect": "0",
        "ptsigx": ptsigx, "s_url": "https://graph.qq.com/oauth2.0/login_jump",
        "ptlang": "2052", "ptredirect": "100", "aid": "716027609", "daid": "383",
        "j_later": "0", "low_login_hour": "0", "regmaster": "0", "pt_login_type": "3",
        "pt_aid": "0", "pt_aaid": "16", "pt_light": "0", "pt_3rd_aid": "100497308",
    })
    p_skey = _cookie(state, "p_skey")
    if not p_skey:
        raise AuthError(502, "qqmusic_oauth_session_missing", "QQ 登录成功，但音乐授权会话未建立，请重新扫码")

    gtk = _hash33(p_skey, 5381)
    oauth = _request(state, "https://graph.qq.com/oauth2.0/authorize", data={
        "response_type": "code", "client_id": "100497308",
        "redirect_uri": "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
        "scope": "get_user_info,get_app_friends", "state": "state", "switch": "",
        "from_ptlogin": "1", "src": "1", "update_auth": "1", "openapi": "1010_1030",
        "g_tk": str(gtk), "auth_time": str(int(time.time() * 1000)), "ui": str(uuid.uuid4()),
    }, referer="https://graph.qq.com/")
    location = urllib.parse.urlsplit(oauth.headers.get("Location", ""))
    code = urllib.parse.parse_qs(location.query).get("code", [""])[0]
    if location.scheme != "https" or location.hostname != "y.qq.com" or not code:
        raise AuthError(502, "qqmusic_oauth_code_missing", "QQ 音乐授权失败，请重新扫码并确认授权")

    response = _request(state, MUSIC_URL, payload={
        "comm": {"g_tk": gtk, "platform": "yqq.json", "ct": 24, "cv": 4747474, "tmeLoginType": 2},
        "req": {"module": "QQConnectLogin.LoginServer", "method": "QQLogin", "param": {"code": code}},
    }, referer="https://y.qq.com/")
    try:
        payload = json.loads(response.body)
        req = payload.get("req", {})
        data = req.get("data", {})
        if payload.get("code", 0) != 0 or req.get("code") != 0 or not isinstance(data, dict):
            raise ValueError
        musicid = str(data.get("musicid") or data.get("str_musicid") or _cookie(state, "qqmusic_uin") or "")
        musickey = str(data.get("musickey") or _cookie(state, "qqmusic_key") or _cookie(state, "qm_keyst") or "")
        if not musicid.isdigit() or int(musicid) <= 0 or not musickey or re.search(r"[;\r\n]", musickey):
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise AuthError(502, "qqmusic_exchange_failed", "QQ 已确认，QQ 音乐凭据兑换失败，请重新扫码") from None

    credentials = {"musicid": musicid, "musickey": musickey, "login_type": 2}
    for key in ("openid", "refresh_token", "access_token", "expired_at", "unionid", "str_musicid", "refresh_key",
                "musickeyCreateTime", "keyExpiresIn", "needRefreshKeyIn", "encryptUin"):
        value = data.get(key)
        if isinstance(value, (str, int)) and value != "":
            credentials[key] = value
    from .profile import identity
    account = {"id": musicid, "uin": uin, **identity(data, known_qq_uin=uin, name=nickname)}
    result = {"status": "authorized", "message": "QQ 音乐登录成功",
              "cookie": _music_cookie_header(state, musicid, musickey),
              "account": account, "credentials": credentials}
    state["authorized"] = result
    return result


def check_session(state):
    """Poll one QR. Only fully exchanged QQ Music credentials mean authorized."""
    if isinstance(state, dict) and state.get("method") == "mobile":
        return _mobile_operation("check", state)
    if isinstance(state, dict) and state.get("method") == "wechat":
        return _extension("extra", state).check_session(state, sys.modules[__name__])
    if not isinstance(state, dict) or not isinstance(state.get("jar"), http.cookiejar.CookieJar) or not state.get("qrsig"):
        raise AuthError(400, "qqmusic_invalid_session", "无效的 QQ 音乐扫码会话")
    if state.get("authorized"):
        return state["authorized"]
    if time.time() >= state.get("expires_at", 0):
        return {"status": "expired", "message": "二维码已过期，请重新创建"}
    response = _request(state, "https://ssl.ptlogin2.qq.com/ptqrlogin", params={
        "u1": "https://graph.qq.com/oauth2.0/login_jump", "ptqrtoken": str(_hash33(state["qrsig"])),
        "ptredirect": "0", "h": "1", "t": "1", "g": "1", "from_ui": "1", "ptlang": "2052",
        "action": "0-0-" + str(int(time.time() * 1000)), "js_ver": "20102616", "js_type": "1",
        "pt_uistyle": "40", "aid": "716027609", "daid": "383", "pt_3rd_aid": "100497308", "has_onekey": "1",
    })
    args = _callback_args(response.body)
    states = {"66": ("waiting", "等待手机 QQ 扫码"), "67": ("scanned", "已扫码，请在手机 QQ 确认登录"),
              "65": ("expired", "二维码已过期，请重新创建"), "68": ("cancelled", "已取消 QQ 音乐登录")}
    if args[0] in states:
        status, message = states[args[0]]
        return {"status": status, "message": message}
    if args[0] == "0" and len(args) >= 3:
        return _authorize(state, args[2], args[5] if len(args) > 5 else "")
    raise AuthError(502, "qqmusic_login_rejected", "QQ 登录服务未完成授权，请重新扫码")
