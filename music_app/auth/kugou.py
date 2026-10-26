"""酷狗音乐 APP 扫码登录；只保存本次扫码会话，不读取已有 Cookie。

Protocol reference (checked 2026-10-23):
https://github.com/MakcRe/KuGouMusicApi/blob/main/module/login_qr_key.js
https://github.com/MakcRe/KuGouMusicApi/blob/main/module/login_qr_check.js
https://github.com/MakcRe/KuGouMusicApi/blob/main/util/helper.js
Official web QR and cookie-exchange implementation:
https://staticssl.kugou.com/common/js/min/login/kguser.v2.min.js
"""

import hashlib
import http.cookiejar
import http.cookies
import json
import re
import socket
import secrets
import string
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


_HOST = "https://login-user.kugou.com"
_H5_URL = "https://h5.kugou.com/apps/loginQRCode/html/index.html"
_WEB_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt"
_APPID = 1014
_CLIENTVER = 20000
_SRCAPPID = 2919
# A conservative local lifetime; the upstream expired status is authoritative.
_SESSION_SECONDS = 180
_MAX_RESPONSE = 1024 * 1024
_RSA_MODULUS = int(
    "B1B1EC76A1BBDBF0D18E8CD9A87E53FA3881E2F004C67C9DDA2CA677DBEFA3D6"
    "1DF8463FE12D84FF4B4699E02C9D41CAB917F5A8FB9E35580C4BDF97763A0420A"
    "476295D763EE10174E6F9EBF7DF8A77BA5B20CDA4EE705DEF5BBA3C88567B9656E5"
    "2C9CD5CD95CA735FF2D25F762B133273EEEB7B4F3EA8B6DA29040F3B67CD", 16)


class AuthError(Exception):
    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        self.message = message
        self.diagnostics = {}
        super().__init__(message)


def _signature(params):
    body = "".join("%s=%s" % (key, params[key]) for key in sorted(params))
    return hashlib.md5((_WEB_SALT + body + _WEB_SALT).encode("utf-8")).hexdigest()


def _numeric(value):
    """Only carry numeric protocol codes into diagnostics, never raw text."""
    return int(value) if isinstance(value, (int, str)) and re.fullmatch(r"-?\d{1,10}", str(value)) else None


def _field_names(value):
    if not isinstance(value, dict):
        return []
    return sorted(key for key in value if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key))[:40]


def _fail(state, code, message, status=502):
    diagnostics = dict(state.get("diagnostics", {}))
    stage = diagnostics.get("stage", "unknown")
    upstream_code = diagnostics.get("upstream_error_code")
    # Stage names are locally defined, and upstream codes are numeric only.
    suffix = " [阶段:%s%s]" % (stage, ", 上游码:%s" % upstream_code if upstream_code is not None else "")
    error = AuthError(status, code, message + suffix)
    error.diagnostics = diagnostics
    raise error from None


def _capture_response_cookies(state, headers):
    """Retain new first-party cookies even when CookieJar rejects legacy syntax."""
    cookies = state.setdefault("response_cookies", {})
    names = []
    for raw in headers.get_all("Set-Cookie", []) if headers else []:
        match = re.match(r"\s*([A-Za-z_][A-Za-z0-9_-]{0,63})=([^;]*)", raw)
        if not match:
            continue
        name, value = match.groups()
        names.append(name)
        # The endpoint is a fixed first-party Kugou host. Only retain its
        # legacy login cookies; never forward arbitrary response cookies.
        if name not in ("KuGoo", "KugooID", "UserId", "t", "Token"):
            continue
        parsed = http.cookies.SimpleCookie()
        try:
            parsed.load(raw)
        except http.cookies.CookieError:
            parsed = {}
        morsel = parsed.get(name)
        if morsel is not None:
            domain = morsel["domain"].lstrip(".").lower()
            if domain and domain != "kugou.com" and not domain.endswith(".kugou.com"):
                continue
            value = morsel.value
        else:
            value = value.strip('"')
        if value and not any(char in value for char in "\r\n;\x00"):
            cookies[name] = value
    state["diagnostics"]["set_cookie_names"] = sorted(set(names))


def _request(state, path, extra, host=_HOST, method="GET"):
    stage = {"/v2/qrcode": "create_qr", "/v2/get_userinfo_qrcode": "check_qr", "/v1/login_by_token_get": "exchange_web_cookie"}.get(path, "request")
    state["diagnostics"] = {"stage": stage}
    params = {
        "dfid": state["dfid"],
        "mid": state["mid"],
        "uuid": state["mid"],
        "appid": _APPID,
        # getInterFaceKguser in the official SDK injects this on *every*
        # request, including the final cookie exchange.
        "srcappid": _SRCAPPID,
        "clientver": _CLIENTVER,
        "clienttime": int(time.time() * 1000),
        **extra,
    }
    params["signature"] = _signature(params)
    request = urllib.request.Request(
        host + path + "?" + urllib.parse.urlencode(params),
        data=b"" if method == "POST" else None,
        method=method,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://login-user.kugou.com/login/?appid=%s" % _APPID,
            **({"Origin": "https://login-user.kugou.com"} if method == "POST" else {}),
            "mid": state["mid"],
            "dfid": state["dfid"],
            "clienttime": str(params["clienttime"]),
        },
    )
    try:
        with state["opener"].open(request, timeout=15) as response:
            state["diagnostics"]["http_status"] = _numeric(response.getcode())
            _capture_response_cookies(state, response.headers)
            state["diagnostics"]["verification_required"] = bool(response.headers.get("SSA-CODE"))
            raw = response.read(_MAX_RESPONSE + 1)
        if len(raw) > _MAX_RESPONSE:
            _fail(state, "kugou_bad_response", "酷狗登录响应过大，请稍后重试")
        payload = json.loads(raw.decode("utf-8-sig"))
    except AuthError:
        raise
    except urllib.error.HTTPError as error:
        state["diagnostics"]["http_status"] = _numeric(error.code)
        _fail(state, "kugou_unavailable", "酷狗登录上游 HTTP 请求失败")
    except (urllib.error.URLError, OSError, socket.timeout):
        _fail(state, "kugou_unavailable", "酷狗扫码登录服务暂时无法连接，请稍后重试")
    except (ValueError, UnicodeError):
        _fail(state, "kugou_bad_response", "酷狗登录返回了无法识别的数据")
    if not isinstance(payload, dict):
        _fail(state, "kugou_bad_response", "酷狗登录返回了无法识别的数据")
    state["diagnostics"].update({
        "upstream_status": _numeric(payload.get("status")),
        "upstream_error_code": _numeric(payload.get("error_code")),
        "response_fields": _field_names(payload),
        "data_fields": _field_names(payload.get("data")),
        "jar_cookie_names": sorted({item.name for item in state["jar"]}),
    })
    if payload.get("status") not in (1, "1") or payload.get("error_code", 0) not in (0, "0", None):
        # Upstream error text may contain a login ticket, so never forward it.
        if state["diagnostics"].get("verification_required"):
            _fail(state, "kugou_verification_required", "酷狗网页登录需要额外验证，请在官网完成验证后重试", status=409)
        _fail(state, "kugou_login_rejected", "酷狗暂时拒绝扫码登录请求，请稍后重试")
    data = payload.get("data")
    if not isinstance(data, dict):
        _fail(state, "kugou_bad_response", "酷狗登录响应缺少必要数据")
    return data


def create_session():
    """返回扫码链接、上游生成的二维码图片和仅供服务端保留的 state。"""
    guid = str(uuid.uuid4())
    jar = http.cookiejar.CookieJar()
    state = {
        "mid": hashlib.md5(guid.encode("ascii")).hexdigest(),
        "dfid": "-",  # Official QR protocol accepts an unregistered device.
        "created_at": time.time(),
        "jar": jar,
        "opener": urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)),
    }
    # The browser SDK creates these device cookies before its cross-domain
    # login request. They belong to this new session, never an existing user.
    for name in ("kg_mid", "kg_mid_temp"):
        jar.set_cookie(http.cookiejar.Cookie(
            0, name, state["mid"], None, False, ".kugou.com", True, True,
            "/", True, True, None, True, None, None, {},
        ))
    qr_prefix = _H5_URL + "?appid=%s&" % _APPID
    data = _request(state, "/v2/qrcode", {
        "appid": _APPID,
        "type": 1,
        "plat": 4,
        "qrcode_txt": qr_prefix,
        "srcappid": _SRCAPPID,
    })
    key = data.get("qrcode")
    if not isinstance(key, str) or not key or len(key) > 4096:
        raise AuthError(502, "kugou_bad_response", "酷狗未返回有效的扫码二维码")
    state["qrcode"] = key
    image = data.get("qrcode_img", "")
    result = {
        "qr_url": qr_prefix + urllib.parse.urlencode({"qrcode": key}),
        "expires_in": _SESSION_SECONDS,
        "state": state,
    }
    # Only embed a raster data URL supplied by the first-party QR endpoint.
    if isinstance(image, str) and image.startswith(("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/gif;base64,")):
        result["qr_image"] = image
    return result


def _cookie_value(value):
    value = str(value)
    if not value or any(char in value for char in "\r\n;\x00"):
        raise AuthError(502, "kugou_bad_credentials", "酷狗返回的登录凭据格式无效")
    return value


def _exchange_params(qr_token, userid, state):
    """Official web exchange: AES-CBC token + raw RSA encrypted AES seed."""
    seed = "".join(secrets.choice(string.digits + string.ascii_uppercase) for _ in range(16))
    digest = hashlib.md5(seed.encode("ascii")).hexdigest().encode("ascii")
    plaintext = json.dumps({"token": qr_token}, separators=(",", ":")).encode("utf-8")
    padding = 16 - len(plaintext) % 16
    plaintext += bytes([padding]) * padding
    try:
        from music_app.runtime_crypto import AES
        encrypted = AES.new(digest, AES.MODE_CBC, digest[-16:]).encrypt(plaintext)
    except ImportError:
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            encryptor = Cipher(algorithms.AES(digest), modes.CBC(digest[-16:])).encryptor()
            encrypted = encryptor.update(plaintext) + encryptor.finalize()
        except ImportError:
            raise AuthError(503, "kugou_crypto_dependency", "酷狗网页登录需安装 pycryptodome 或 cryptography 依赖") from None
    now_ms = int(time.time() * 1000)
    rsa_plaintext = json.dumps({"clienttime_ms": now_ms, "key": seed}, separators=(",", ":")).encode("ascii")
    # The SDK's NoPadding implementation right-pads to its 128-byte block.
    pk = format(pow(int.from_bytes(rsa_plaintext.ljust(128, b"\0"), "big"), 65537, _RSA_MODULUS), "0256x")
    return {
        "clientver": 1000,
        "clienttime": now_ms // 1000,
        "clienttime_ms": now_ms,
        "dev": "web",
        "userid": userid,
        "plat": 4,
        "pk": pk,
        "params": encrypted.hex(),
    }


def _authorized(state, data):
    token = data.get("token")
    userid = data.get("userid")
    if not isinstance(token, str) or not token or not str(userid or "").isdigit() or int(userid) <= 0:
        _fail(state, "kugou_missing_credentials", "酷狗已确认扫码，但未返回完整登录凭据")
    userid = str(userid)
    token = _cookie_value(token)
    # Keep the QR-issued client token for cloudlist. The web exchange issues a
    # different t cookie for songinfo; overwriting token with t breaks cloud
    # library reads even though the account/profile still appears logged in.
    cloud_token = token
    profile = _request(
        state, "/v1/login_by_token_get", _exchange_params(token, userid, state),
        host="https://loginservice.kugou.com", method="POST",
    )
    cookies = {}
    for item in state["jar"]:
        if (item.domain == "kugou.com" or item.domain.endswith(".kugou.com")) and item.value:
            cookies[item.name] = _cookie_value(item.value)
    cookies.update(state.get("response_cookies", {}))
    legacy = cookies.get("KuGoo", "").strip('"')
    # Handle the SDK's raw query-string cookie and the URL-encoded form emitted
    # by some login-service nodes; normalize before extracting its aliases.
    if "=" not in legacy and "%3d" in legacy.lower():
        legacy = urllib.parse.unquote(legacy)
    nested = urllib.parse.parse_qs(legacy)
    web_token = cookies.get("t") or cookies.get("Token") or (nested.get("t") or [""])[0]
    web_userid = cookies.get("KugooID") or cookies.get("UserId") or (nested.get("KugooID") or [""])[0]
    if not web_token or str(web_userid) != userid:
        state.setdefault("diagnostics", {}).update({
            "stage": "validate_web_cookie",
            "cookie_names": sorted(cookies),
            "legacy_cookie_fields": _field_names(nested),
            "has_web_token": bool(web_token),
            "has_web_userid": bool(web_userid),
            "userid_matches": bool(web_userid) and str(web_userid) == userid,
        })
        _fail(state, "kugou_missing_web_cookie", "酷狗扫码已确认，但网页登录凭据尚未签发，请重新获取二维码")
    token = _cookie_value(web_token)
    cookies.update({
        "token": cloud_token,
        "userid": userid,
        "t": token,
        "KugooID": userid,
        "kg_mid": state["mid"],
        "kg_dfid": state["dfid"],
    })
    account = {"id": userid}
    if isinstance(profile.get("nickname"), str) and profile["nickname"]:
        account["name"] = profile["nickname"]
    if isinstance(profile.get("pic"), str) and profile["pic"].startswith(("https://", "http://")):
        account["avatar"] = profile["pic"]
    return {
        "status": "authorized",
        "message": "酷狗扫码登录成功",
        "cookie": "; ".join("%s=%s" % item for item in cookies.items()),
        "account": account,
        "credentials": {
            "token": cloud_token,
            "web_token": token,
            "userid": userid,
            "mid": state["mid"],
            "dfid": state["dfid"],
            "appid": _APPID,
            "clientver": _CLIENTVER,
        },
    }


def check_session(state):
    """查询等待扫码、待确认或授权成功状态；凭据只在授权成功时返回。"""
    if not isinstance(state, dict) or not all(key in state for key in ("created_at", "qrcode", "mid", "dfid", "opener", "jar")):
        raise AuthError(400, "kugou_invalid_session", "酷狗扫码会话无效，请重新获取二维码")
    if time.time() - state["created_at"] >= _SESSION_SECONDS:
        return {"status": "expired", "message": "酷狗登录二维码已过期，请重新获取"}
    # QR tickets can be consumed by the exchange. Keep this fresh ticket only in
    # the server session so transient exchange failures can be retried safely.
    pending = state.get("pending_authorization")
    if pending:
        return _authorized(state, pending)
    data = _request(state, "/v2/get_userinfo_qrcode", {
        "plat": 4,
        "srcappid": _SRCAPPID,
        "qrcode": state["qrcode"],
    })
    status = data.get("status")
    if status in (0, "0"):
        return {"status": "expired", "message": "酷狗登录二维码已过期，请重新获取"}
    if status in (1, "1"):
        return {"status": "waiting", "message": "等待使用酷狗音乐 APP 扫码"}
    if status in (2, "2"):
        return {"status": "scanned", "message": "已扫码，请在酷狗音乐 APP 中确认登录"}
    if status in (4, "4"):
        state["pending_authorization"] = {"token": data.get("token"), "userid": data.get("userid")}
        return _authorized(state, data)
    raise AuthError(502, "kugou_unknown_status", "酷狗返回了无法识别的扫码状态，请重新获取二维码")
