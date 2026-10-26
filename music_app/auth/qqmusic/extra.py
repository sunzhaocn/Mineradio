"""WeChat QQ Music authorization; the already verified QQ flow stays unchanged.

Source: https://github.com/l-1124/qqmusicapi/blob/main/qqmusic_api/modules/login.py
"""
import base64
import http.cookiejar
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request


def _error(backend, code, message, stage):
    error = backend.AuthError(502, code, message)
    error.diagnostics = {"stage": stage}
    return error


def _cgi(state, backend, method, param, login_type=0, module="music.login.LoginServer", comm=None):
    common = {"ct": 24, "cv": 4747474, "platform": "yqq.json", "tmeLoginType": login_type}
    common.update(comm or {})
    response = backend._request(state, backend.MUSIC_URL, payload={
        "comm": common, "req": {"module": module, "method": method, "param": param},
    }, referer="https://y.qq.com/")
    try:
        envelope = json.loads(response.body)
        item = envelope.get("req", {})
        if envelope.get("code", 0) != 0 or item.get("code") != 0 or not isinstance(item.get("data"), dict):
            raise ValueError
        return item["data"]
    except (ValueError, TypeError, AttributeError):
        raise _error(backend, "qqmusic_login_exchange_failed", "QQ 音乐未完成登录凭据兑换，请重新扫码", "exchange") from None


def _authorized(state, backend, data, login_type):
    musicid = str(data.get("musicid") or data.get("str_musicid") or "")
    musickey = data.get("musickey")
    if not musicid.isdigit() or int(musicid) <= 0 or not isinstance(musickey, str) or not musickey or re.search(r"[;\r\n]", musickey):
        raise _error(backend, "qqmusic_music_credentials_missing", "已确认扫码，但 QQ 音乐未返回完整登录凭据", "exchange")
    header = backend._music_cookie_header(state, musicid, musickey)
    cookies = dict(part.strip().split("=", 1) for part in header.split(";") if "=" in part)
    cookies["tmeLoginType"] = str(login_type)
    credentials = {"musicid": musicid, "musickey": musickey, "login_type": login_type}
    for key in ("openid", "refresh_token", "access_token", "expired_at", "unionid", "str_musicid", "refresh_key",
                "musickeyCreateTime", "keyExpiresIn", "needRefreshKeyIn", "encryptUin"):
        value = data.get(key)
        if isinstance(value, (str, int)) and value != "":
            credentials[key] = value
    from .profile import identity
    account = {"id": musicid, **identity(data)}
    result = {"status": "authorized", "message": "QQ 音乐登录成功",
              "cookie": "; ".join(key + "=" + value for key, value in cookies.items()),
              "account": account, "credentials": credentials}
    state["authorized"] = result
    return result


def _scan_url(image):
    try:
        import cv2
        import numpy
        pixels = cv2.imdecode(numpy.frombuffer(image, dtype=numpy.uint8), cv2.IMREAD_COLOR)
        url, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
        parts = urllib.parse.urlsplit(url)
        if parts.scheme in ("http", "https") and parts.hostname and (
                parts.hostname.endswith(".qq.com") or parts.hostname == "y.qq.com"):
            return url
    except Exception:
        pass
    return ""


def create_session(method, backend):
    if method != "wechat":
        raise backend.AuthError(400, "qqmusic_method_invalid", "QQ 音乐扫码方式请选择 qq/wechat/mobile")
    state = {"method": "wechat", "jar": http.cookiejar.CookieJar()}
    response = backend._request(state, "https://open.weixin.qq.com/connect/qrconnect", params={
        "appid": "wx48db31d50e334801",
        "redirect_uri": "https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/",
        "response_type": "code", "scope": "snsapi_login", "state": "STATE",
        "href": "https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect",
    }, referer="https://y.qq.com/")
    match = re.search(r"uuid=([A-Za-z0-9_-]+)", response.body.decode("utf-8", errors="replace"))
    if not match:
        raise _error(backend, "qqmusic_wechat_qr_failed", "微信登录服务未返回二维码，请重试", "create")
    state["uuid"] = match.group(1)
    qr = backend._request(state, "https://open.weixin.qq.com/connect/qrcode/" + state["uuid"],
                          referer="https://open.weixin.qq.com/connect/qrconnect")
    image = qr.body
    mime = backend._image_mime(image)
    state["expires_at"] = time.time() + 180
    return {"qr_url": _scan_url(image), "qr_image": "data:" + mime + ";base64," + base64.b64encode(image).decode("ascii"),
            "expires_in": 180, "state": state, "message": "请使用微信扫一扫"}


def _wechat_status(state, backend):
    url = "https://lp.open.weixin.qq.com/connect/l/qrconnect?" + urllib.parse.urlencode({"uuid": state["uuid"], "_": int(time.time() * 1000)})
    request = urllib.request.Request(url, headers={"User-Agent": backend._UA, "Referer": "https://open.weixin.qq.com/"})
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            body = response.read(65536).decode("utf-8", errors="replace")
    except (TimeoutError, urllib.error.URLError) as exc:
        if isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError):
            return {"status": "waiting", "message": "等待微信扫码"}
        raise _error(backend, "qqmusic_wechat_network_error", "连接微信扫码服务失败，请稍后重试", "check") from None
    match = re.search(r"window\.wx_errcode\s*=\s*(\d+)\s*;\s*window\.wx_code\s*=\s*['\"]([^'\"]*)", body)
    if not match:
        raise _error(backend, "qqmusic_wechat_status_invalid", "微信扫码状态响应异常，请重新生成二维码", "check")
    code, ticket = match.groups()
    states = {"408": ("waiting", "等待微信扫码"), "404": ("scanned", "已扫码，请在微信中确认登录"),
              "402": ("expired", "微信二维码已过期，请重新生成"), "403": ("cancelled", "已取消微信登录")}
    if code in states:
        status, message = states[code]
        return {"status": status, "message": message}
    if code != "405" or not ticket:
        raise _error(backend, "qqmusic_wechat_login_failed", "微信未完成授权，请重新扫码", "check")
    state["wechat_ticket"] = ticket
    return _authorized(state, backend, _cgi(state, backend, "Login", {"code": ticket, "strAppid": "wx48db31d50e334801"}, login_type=1), 1)




def check_session(state, backend):
    if state.get("authorized"):
        return state["authorized"]
    if time.time() >= state["expires_at"]:
        return {"status": "expired", "message": "二维码已过期，请重新生成"}
    if state.get("wechat_ticket"):
        data = _cgi(state, backend, "Login", {"code": state["wechat_ticket"], "strAppid": "wx48db31d50e334801"}, login_type=1)
        return _authorized(state, backend, data, 1)
    return _wechat_status(state, backend)
