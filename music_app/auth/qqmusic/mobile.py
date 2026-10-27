"""QQ 音乐 App 专用扫码：CreateQRCode + MQTT5/WSS + Login 凭据兑换。

协议主源：https://github.com/l-1124/qqmusicapi/blob/main/qqmusic_api/modules/login.py
MQTT 主源：https://github.com/l-1124/qqmusicapi/blob/main/qqmusic_api/utils/mqtt.py
每次扫码使用新 CookieJar、设备标识和后台监听线程，不读取现有登录资料。
只有收到 CONNACK 和成功 SUBACK 后才展示二维码；HTTP 状态请求不等待扫码。
"""

import base64
import http.cookiejar
import io
import json
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
import uuid

from .credentials import credential_fields, valid_cookie as _valid_cookie, validate_credentials

MUSIC_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
MAX_RESPONSE = 2 * 1024 * 1024
# CreateQRCode.param describes the device receiving the login. The API runs on
# a desktop, while the phone is only the scanner. WEB ct=24 has no authorization
# configuration and GetQRCodeStatus rejects it with 104610 on the official H5.
# These desktop profile values are the upstream VersionPolicy defaults.
TARGET_CT = 19
TARGET_CV = 2201


class AuthError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _error(code, message, stage):
    error = AuthError(502, code, message)
    error.diagnostics = {"stage": stage}
    return error


def _diagnostic(state, stage, **numbers):
    item = {"stage": stage}
    item.update({key: value for key, value in numbers.items() if isinstance(value, int)})
    events = state.setdefault("diagnostics", [])
    events.append(item)
    del events[:-20]


def _cgi(state, method, param, login_type=0, comm=None):
    # Match VersionPolicy.DESKTOP; avoid mixing the WEB platform marker into a
    # desktop QR/login request. CreateQRCode overrides ct/cv to 23/0 below.
    common = {"ct": TARGET_CT, "cv": TARGET_CV, "chid": "0", "g_tk": 5381,
              "guid": state["device_id"].upper()}
    if login_type:
        common["tmeLoginType"] = login_type
    common.update(comm or {})
    payload = {"comm": common, "req": {"module": "music.login.LoginServer", "method": method, "param": param}}
    headers = {"User-Agent": USER_AGENT, "Referer": "https://y.qq.com/", "Origin": "https://y.qq.com",
               "Content-Type": "application/json;charset=utf-8"}
    request = urllib.request.Request(MUSIC_URL,
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), headers=headers)
    try:
        with state["opener"].open(request, timeout=20) as response:
            http_status = getattr(response, "status", 200)
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError()
        envelope = json.loads(raw)
        item = envelope.get("req")
        if not isinstance(item, dict):
            raise ValueError()
        _diagnostic(state, "create" if method == "CreateQRCode" else "exchange",
                    envelope_code=envelope.get("code", 0), module_code=item.get("code", -1),
                    http_status=http_status, upstream_code=item.get("code", -1))
        if envelope.get("code", 0) or item.get("code") != 0 or not isinstance(item.get("data"), dict):
            raise ValueError()
        return item["data"]
    except (OSError, ValueError, TypeError, AttributeError):
        raise _error("qqmusic_mobile_upstream", "QQ 音乐客户端登录服务暂时不可用，请重新扫码", "create" if method == "CreateQRCode" else "exchange") from None


def _authorized(state, data):
    try:
        musicid, musickey = validate_credentials(data.get("musicid") or data.get("str_musicid") or "", data.get("musickey"))
    except (ValueError, TypeError, AttributeError):
        raise _error("qqmusic_mobile_credentials", "已确认扫码，但 QQ 音乐未返回完整登录凭据", "exchange") from None
    values = {cookie.name: cookie.value for cookie in state["jar"]
              if cookie.domain.lstrip(".") in {"qq.com", "y.qq.com", "u.y.qq.com"}
              and not cookie.is_expired() and _valid_cookie(cookie.name, cookie.value)}
    values.update(state.get("mobile_cookies", {}))
    login_type = data.get("loginType") or (1 if str(musickey).startswith("W_X") else 2)
    # MQTT qqmusic_key 是临时票据；必须由 Login 返回的 musickey 覆盖。
    values.update({"qqmusic_key": str(musickey), "qqmusic_uin": musicid, "uin": musicid,
                   "qm_keyst": str(musickey), "tmeLoginType": str(login_type)})
    credentials = credential_fields(data, musicid, musickey, login_type, extra=("bindAccountType",))
    from .profile import identity
    account = {"id": musicid, **identity(data)}
    result = {"status": "authorized", "message": "QQ 音乐客户端扫码登录成功",
              "cookie": "; ".join(name + "=" + str(value) for name, value in sorted(values.items())),
              "account": account, "credentials": credentials}
    state["authorized"] = result
    state.pop("mobile_ticket", None)
    state["mobile_stop"].set()
    _diagnostic(state, "authorized")
    return result


def _handle_message(state, event, payload):
    """MQTT 回调只更新内存，兑换在下一次 HTTP check 完成。"""
    with state["mobile_lock"]:
        if event == "scanned":
            state["mobile_status"] = "scanned"
            _diagnostic(state, "scanned")
        elif event in {"canceled", "timeout"}:
            state["mobile_status"] = "cancelled" if event == "canceled" else "expired"
            _diagnostic(state, state["mobile_status"])
            state["mobile_stop"].set()
        elif event == "loginFailed":
            state["mobile_error"] = True
            state["mobile_stage"] = "login_failed"
            state["mobile_stop"].set()
        elif event == "cookies":
            try:
                if len(payload) > MAX_RESPONSE:
                    raise ValueError()
                value = json.loads(payload)
                cookies = value.get("cookies")
                if not isinstance(cookies, dict):
                    raise ValueError()
                cleaned = {}
                for name, record in cookies.items():
                    candidate = record.get("value") if isinstance(record, dict) else None
                    if _valid_cookie(name, candidate):
                        cleaned[name] = str(candidate)
                uin, token = cleaned.get("qqmusic_uin", ""), cleaned.get("qqmusic_key", "")
                if not uin.isdigit() or int(uin) <= 0 or not token:
                    raise ValueError()
                state["mobile_ticket"] = {"musicid": int(uin), "token": token}
                state["mobile_cookies"] = cleaned
                state["mobile_status"] = "scanned"
                state["mobile_stage"] = "ticket_received"
                _diagnostic(state, "ticket_received")
            except (ValueError, AttributeError, TypeError, OverflowError):
                state["mobile_error"] = True
                state["mobile_stage"] = "invalid_ticket"
            state["mobile_stop"].set()


def _reason(reason):
    result = getattr(reason, "value", reason)
    return result if isinstance(result, int) else -1


def _mobile_worker(state):
    try:
        import paho.mqtt.client as mqtt
        from paho.mqtt.packettypes import PacketTypes
        from paho.mqtt.properties import Properties
        path = "/ws/handshake"
        for attempt in range(4):
            if state["mobile_stop"].is_set():
                return
            connected, subscribed = threading.Event(), threading.Event()
            outcome = {}
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                 client_id=str(int(time.time() * 1000)) + str(uuid.uuid4().int % 10000).zfill(4),
                                 protocol=mqtt.MQTTv5, transport="websockets", reconnect_on_failure=False)
            client.tls_set_context(ssl.create_default_context())
            client.ws_set_options(path=path, headers={"Origin": "https://y.qq.com", "Referer": "https://y.qq.com/", "User-Agent": USER_AGENT})
            client.connect_timeout = 12

            def on_connect(_client, _userdata, _flags, reason_code, properties):
                outcome["code"] = _reason(reason_code)
                outcome["redirect"] = getattr(properties, "ServerReference", "")
                _diagnostic(state, "connack", reason_code=outcome["code"])
                connected.set()
                if outcome["code"] == 0:
                    props = Properties(PacketTypes.SUBSCRIBE)
                    props.UserProperty = [("authorization", "tmelogin"), ("pubsub", "unicast")]
                    result, _mid = _client.subscribe("management.qrcode_login/" + state["qrcode_id"], qos=0, properties=props)
                    if result != mqtt.MQTT_ERR_SUCCESS:
                        outcome["subscribe_error"] = True
                        subscribed.set()

            def on_subscribe(_client, _userdata, _mid, reasons, _properties):
                codes = [_reason(reason) for reason in reasons]
                outcome["subscribed"] = bool(codes) and all(0 <= code < 128 for code in codes)
                _diagnostic(state, "suback", reason_code=max(codes) if codes else -1)
                subscribed.set()

            def on_disconnect(_client, _userdata, _flags, reason_code, _properties):
                if state.get("mobile_stage") == "subscribed" and not state["mobile_stop"].is_set():
                    state["mobile_error"] = True
                    state["mobile_stage"] = "disconnected"
                    _diagnostic(state, "disconnected", reason_code=_reason(reason_code))
                    state["mobile_stop"].set()

            def on_message(_client, _userdata, message):
                props = dict(getattr(getattr(message, "properties", None), "UserProperty", []) or [])
                _handle_message(state, props.get("type"), message.payload)

            client.on_connect, client.on_subscribe = on_connect, on_subscribe
            client.on_message, client.on_disconnect = on_message, on_disconnect
            connect_props = Properties(PacketTypes.CONNECT)
            connect_props.AuthenticationMethod = "pass"
            connect_props.UserProperty = [("tmeAppID", "qqmusic"), ("business", "management"),
                ("hashTag", state["qrcode_id"]), ("clientTag", "management.user"), ("userID", state["qrcode_id"])]
            try:
                client.connect_async("mu.y.qq.com", 443, keepalive=45, clean_start=True, properties=connect_props)
                client.loop_start()
                if not connected.wait(14):
                    raise TimeoutError()
                if outcome.get("code") in {0x9C, 0x9D}:
                    reference = outcome.get("redirect", "")
                    if attempt >= 3 or not isinstance(reference, str) or not re.fullmatch(r"[A-Za-z0-9.:-]{1,200}", reference):
                        raise ValueError()
                    # 跟随主源协议，仅修改固定 mu.y.qq.com 上的握手path，不连接任意主机。
                    path = "/ws/handshake/" + reference
                    continue
                if outcome.get("code") != 0 or not subscribed.wait(12) or not outcome.get("subscribed"):
                    raise ConnectionError()
                state["mobile_stage"] = "subscribed"
                state["mobile_ready"].set()
                while time.time() < state["expires_at"] and not state["mobile_stop"].wait(0.5):
                    if not client.is_connected():
                        raise ConnectionError()
                if not state["mobile_stop"].is_set():
                    state["mobile_status"] = "expired"
                    state["mobile_stop"].set()
                return
            finally:
                client.disconnect()
                client.loop_stop()
    except Exception:
        state["mobile_error"] = True
        state["mobile_stage"] = "connection_failed"
        _diagnostic(state, "connection_failed")
        state["mobile_stop"].set()
    finally:
        state["mobile_ready"].set()


def _new_state():
    jar = http.cookiejar.CookieJar()
    return {"jar": jar, "opener": urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)),
            "device_id": uuid.uuid4().hex, "method": "mobile", "mobile_lock": threading.Lock(),
            "mobile_stop": threading.Event(), "mobile_ready": threading.Event(),
            "mobile_status": "waiting", "mobile_stage": "connecting"}


def _prepare_qr_image(image):
    """Supply a quiet zone without changing the official QR payload."""
    from music_app.platform_runtime import is_ios
    if is_ios():
        try:
            import png
        except ImportError:
            raise AuthError(503, "qqmusic_qr_image_dependency", "QQ 音乐客户端二维码需要安装 pypng") from None
        try:
            reader = png.Reader(bytes=image)
            reader.preamble()
            if not (1 <= reader.width <= 1024 and 1 <= reader.height <= 1024):
                raise ValueError()
            width, height, rows, _ = reader.asRGB8()
            border = bytes([255]) * 75
            white = bytes([255]) * ((width + 50) * 3)
            def padded_rows():
                yield from (white for _ in range(25))
                for row in rows:
                    yield border + bytes(row) + border
                yield from (white for _ in range(25))
            output = io.BytesIO()
            png.Writer(width=width + 50, height=height + 50, greyscale=False).write(output, padded_rows())
            return output.getvalue(), ''
        except (OSError, ValueError, png.Error):
            raise _error('qqmusic_mobile_qr', 'QQ 音乐客户端未返回有效二维码，请重试', 'create') from None
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise AuthError(503, "qqmusic_qr_image_dependency", "QQ 音乐客户端二维码需要安装 Pillow") from None
    try:
        with Image.open(io.BytesIO(image)) as source:
            if source.format != "PNG" or not (1 <= source.width <= 1024 and 1 <= source.height <= 1024):
                raise ValueError()
            # The official 150 px QR lacks a usable quiet zone. A white border
            # also lets scanners avoid the surrounding UI and improves decoding.
            padded = ImageOps.expand(source.convert("RGB"), border=25, fill="white")
            output = io.BytesIO()
            padded.save(output, format="PNG")
            image = output.getvalue()
    except (OSError, ValueError):
        raise _error("qqmusic_mobile_qr", "QQ 音乐客户端未返回有效二维码，请重试", "create") from None
    url = ""
    try:
        import cv2
        import numpy
        pixels = cv2.imdecode(numpy.frombuffer(image, dtype=numpy.uint8), cv2.IMREAD_COLOR)
        decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
        from urllib.parse import urlsplit
        parts = urlsplit(decoded)
        if parts.scheme == "https" and (parts.hostname == "y.qq.com" or (parts.hostname or "").endswith(".y.qq.com")):
            url = decoded
    except Exception:
        # Rendering the official image remains supported without OpenCV/numpy.
        pass
    return image, url


def _validate_target_configuration(state, data):
    web_conf = data.get("webConf")
    try:
        config = json.loads(web_conf) if isinstance(web_conf, str) and web_conf else None
        if not isinstance(config, dict) or not (config.get("qrcodeTitle") or config.get("qrcodeDesc")):
            raise ValueError()
    except (ValueError, TypeError):
        _diagnostic(state, "target_unsupported")
        raise _error("qqmusic_mobile_target_unsupported", "QQ 音乐未返回此登录设备的授权页面配置，请重新生成二维码", "target_unsupported") from None
    _diagnostic(state, "target_configuration", target_ct=TARGET_CT, target_cv=TARGET_CV,
                web_conf_length=len(web_conf))


def create_session(base=None):
    # base仅为主QQ模块的可选兼容参数；本模块完全独立，避免循环import。
    try:
        import paho.mqtt.client  # noqa: F401 -- fail before starting an unavailable MQTT backend
    except ImportError:
        raise AuthError(503, "qqmusic_mqtt_dependency_missing", "QQ 音乐客户端扫码需要安装 paho-mqtt>=2.1,<3") from None
    state = _new_state()
    data = _cgi(state, "CreateQRCode", {"tmeAppID": "qqmusic", "ct": TARGET_CT, "cv": TARGET_CV}, comm={"ct": 23, "cv": 0})
    _validate_target_configuration(state, data)
    try:
        encoded, identifier = data.get("qrcode"), data.get("qrcodeID")
        if not isinstance(encoded, str) or not isinstance(identifier, str) or not identifier:
            raise ValueError()
        image = base64.b64decode(encoded.split(",")[-1], validate=True)
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError()
        image, scan_url = _prepare_qr_image(image)
        ttl = max(30, min(900, int(data.get("expiresIn", 180))))
    except (ValueError, TypeError):
        raise _error("qqmusic_mobile_qr", "QQ 音乐客户端未返回有效二维码，请重试", "create") from None
    state.update(qrcode_id=identifier, expires_at=time.time() + ttl)
    worker = threading.Thread(target=_mobile_worker, args=(state,), daemon=True, name="qqmusic-app-qr")
    state["mobile_thread"] = worker
    worker.start()
    ready = state["mobile_ready"].wait(28)
    if not ready or state.get("mobile_error") or state.get("mobile_stage") != "subscribed":
        state["mobile_stop"].set()
        error = _error("qqmusic_mobile_mqtt", "连接 QQ 音乐客户端扫码服务失败，请重新生成二维码", state.get("mobile_stage", "connecting"))
        error.diagnostics["events"] = list(state.get("diagnostics", []))
        raise error
    return {"qr_url": scan_url, "qr_image": "data:image/png;base64," + base64.b64encode(image).decode("ascii"),
            "expires_in": max(1, int(state["expires_at"] - time.time())), "state": state,
            "message": "请打开 QQ 音乐 App，使用 App 内的扫一扫并确认登录"}


def check_session(state, base=None):
    if not isinstance(state, dict) or not state.get("qrcode_id"):
        raise AuthError(400, "qqmusic_mobile_session", "QQ 音乐客户端扫码会话无效，请重新创建二维码")
    if state.get("authorized"):
        return state["authorized"]
    if time.time() >= state["expires_at"]:
        state["mobile_stop"].set()
        return {"status": "expired", "message": "QQ 音乐客户端二维码已过期，请重新生成"}
    with state["mobile_lock"]:
        ticket, error, status = state.get("mobile_ticket"), state.get("mobile_error"), state["mobile_status"]
    if error:
        raise _error("qqmusic_mobile_listener", "QQ 音乐客户端扫码连接中断，请重新生成二维码", state["mobile_stage"])
    if ticket:
        data = _cgi(state, "Login", {**ticket, "qrCodeID": state["qrcode_id"]}, login_type=6)
        return _authorized(state, data)
    messages = {"waiting": "等待 QQ 音乐 App 扫码", "scanned": "已扫码，请在 QQ 音乐 App 确认登录",
                "cancelled": "已取消 QQ 音乐客户端登录", "expired": "二维码已过期，请重新生成"}
    return {"status": status, "message": messages.get(status, "等待 QQ 音乐 App 扫码")}
