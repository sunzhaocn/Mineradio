"""登录路由与隔离扫码会话生命周期管理。"""

import base64
import importlib
import io
import importlib.util
import secrets
import threading
import time
from music_app.auth.diagnostics import safe_diagnostics


PLATFORMS = ("kugou", "netease", "qqmusic", "qishui")


TERMINAL = {"authorized", "expired", "cancelled"}


PENDING = {"waiting", "scanned", "verification_required", "cooldown"}


POLL_INTERVAL = 3


RESULT_TTL = 600


MAX_SESSIONS = 128


_sessions = {}
_stopping = False


_lock = threading.Lock()


class AuthError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def _adapter(platform):
    if platform not in PLATFORMS:
        raise AuthError(400, "login_platform_invalid", "请选择 kugou/netease/qqmusic/qishui")
    names = {"kugou": "music_app.auth.kugou", "netease": "music_app.auth.netease.adapter",
             "qqmusic": "music_app.auth.qqmusic.adapter", "qishui": "music_app.auth.qishui.adapter"}
    return importlib.import_module(names[platform])


def _invoke(adapter, operation, *args, **kwargs):
    try:
        return getattr(adapter, operation)(*args, **kwargs)
    except Exception as exc:
        if isinstance(exc, getattr(adapter, "AuthError", AuthError)):
            error = AuthError(exc.status, exc.code, str(exc))
            error.diagnostics = safe_diagnostics(getattr(exc, "diagnostics", []))
            raise error from None
        raise AuthError(502, "login_upstream_failed", "登录请求失败，请稍后重试或重新开始") from None


def _image(url):
    if not url:
        return ""
    try:
        import qrcode
        output = io.BytesIO()
        from music_app.platform_runtime import is_ios
        if is_ios():
            from qrcode.image.pure import PyPNGImage
            qrcode.make(url, image_factory=PyPNGImage).save(output)
        else:
            qrcode.make(url).save(output, format="PNG")
        return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
    except ImportError:
        raise AuthError(503, "login_qrcode_dependency_missing", "生成二维码图片需要安装 qrcode[pil]") from None


def _prune(now):
    for key, session in list(_sessions.items()):
        if now >= session["retain_until"]:
            _release_state(session)
            del _sessions[key]


def _release_state(session):
    state = session.get("state")
    close = getattr(session.get("adapter"), "close_session", None)
    if state is not None and callable(close):
        try:
            close(state)
        except Exception:
            pass  # 清理失败不能丢弃已经返回的登录结果。
    session["state"] = None


def shutdown():
    """Stop new sessions and release every owned browser outside the registry lock."""
    global _stopping
    with _lock:
        _stopping = True
        sessions = tuple(_sessions.values())
        _sessions.clear()
    resources = []
    for session in sessions:
        # An active check must finish before its browser state can be closed.
        with session["lock"]:
            state = session.get("state") or {}
            resources.extend(state[name] for name in ("browser_runtime", "signed_runtime") if state.get(name))
            stop = state.get("mobile_stop")
            if isinstance(stop, threading.Event):
                stop.set()
            if state.get("mobile_thread"):
                resources.append(state["mobile_thread"])
            _release_state(session)
    # Browser close commands run on their owning threads. Allow those threads
    # to finish before Python exits, sharing one timeout across all resources.
    deadline = time.monotonic() + 5
    for resource in resources:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        closed = getattr(resource, "closed", None)
        if isinstance(closed, threading.Event):
            closed.wait(remaining)
        remaining = deadline - time.monotonic()
        worker = resource if isinstance(resource, threading.Thread) else getattr(resource, "thread", None)
        if remaining > 0 and isinstance(worker, threading.Thread) and worker is not threading.current_thread():
            worker.join(timeout=remaining)


def create(platform, method=""):
    method = method.strip().lower()
    from music_app.platform_runtime import is_ios
    if is_ios() and platform == 'qishui':
        if method not in ('', 'official', 'phone', 'sms'):
            raise AuthError(400, 'login_method_invalid', '汽水音乐请使用短信验证码登录')
        return create_phone('qishui')
    if is_ios():
        if method not in ('', 'official'):
            raise AuthError(400, 'login_method_invalid', 'iPad 请使用官方账号密码／验证码登录窗口')
        method = 'official'
    adapter = _adapter(platform)
    official = method == 'official' and is_ios() and platform in ('netease','qqmusic','kugou')
    if official and platform != 'netease':
        adapter = importlib.import_module('music_app.auth.ios_official')
    if not official and platform == "qqmusic":
        method = {"wx": "wechat", "client": "mobile", "app": "mobile"}.get(method, method or "qq")
        if method not in ("qq", "wechat", "mobile"):
            raise AuthError(400, "login_method_invalid", "QQ 音乐扫码方式为 qq/wechat/mobile")
    elif not official and method:
        raise AuthError(400, "login_method_invalid", "仅 QQ 音乐需要选择 qq/wechat/mobile 扫码方式")
    with _lock:
        if _stopping:
            raise AuthError(503, "login_service_stopping", "登录服务正在关闭，请重新启动后再试")
        _prune(time.monotonic())
        if len(_sessions) >= MAX_SESSIONS:
            raise AuthError(429, "login_sessions_full", "扫码会话过多，请稍后再试")
    created = (_invoke(adapter, 'create_session', platform=platform) if official and platform != 'netease' else
               _invoke(adapter, "create_session", method=method) if platform == "qqmusic" and method != "qq"
               else _invoke(adapter, "create_session"))
    try:
        return _register_created(platform, method, adapter, created)
    except Exception:
        _release_state({"adapter": adapter, "state": created.get("state")})
        raise


def create_phone(platform='netease'):
    """手机号登录创建空白会话，不发送短信、不访问扫码页面。"""
    if platform not in ('netease', 'qishui'):
        raise AuthError(400, 'login_platform_invalid', '此平台不支持手机号登录')
    adapter = (importlib.import_module('music_app.auth.qishui.phone') if platform == 'qishui'
               else _adapter('netease'))
    with _lock:
        if _stopping:
            raise AuthError(503, "login_service_stopping", "登录服务正在关闭，请重新启动后再试")
        _prune(time.monotonic())
        if len(_sessions) >= MAX_SESSIONS:
            raise AuthError(429, "login_sessions_full", "登录会话过多，请稍后再试")
    created = _invoke(adapter, 'create_session' if platform == 'qishui' else 'create_phone_session')
    try:
        return _register_created(platform, "phone", adapter, created, requires_qr=False)
    except Exception:
        _release_state({"adapter": adapter, "state": created.get("state")})
        raise


def _register_created(platform, method, adapter, created, requires_qr=True):
    now = time.monotonic()
    ttl = max(1, min(600, int(created.get("expires_in", 180))))
    key = secrets.token_urlsafe(32)
    result = {"platform": platform, "key": key, "status": "waiting", "authorized": False,
              "message": created.get("message", "请使用对应平台 App 扫码并确认登录"), "expires_in": ttl,
              "expires_at": int(time.time() + ttl), "poll_interval": POLL_INTERVAL,
              "check_url": f"/login/{platform}/check?key={key}"}
    manual_login = (created.get('manual_login') is True and created.get('interactive_window') is True
                    and callable(getattr(adapter, 'show_session', None)))
    if manual_login:
        result['manual_login'] = True
    if requires_qr and not manual_login:
        result["qr_url"] = created.get("qr_url", "")
        result["qr_image"] = created.get("qr_image") or _image(created.get("qr_url", ""))
    if method:
        result["method"] = method
    if created.get("interactive_window"):
        result["interactive_window"] = True
        result["open_url"] = f"/login/{platform}/open?key={key}"
    if requires_qr and not manual_login and not result["qr_image"] and not result["qr_url"]:
        raise AuthError(502, "login_qrcode_missing", "平台未返回二维码，请重试")
    session = {"platform": platform, "adapter": adapter, "state": created["state"],
               "expires": now + ttl, "retain_until": now + ttl + RESULT_TTL,
               "last_poll": float("-inf"), "lock": threading.Lock(),
               "result": {"status": "waiting", "message": result["message"]}, "key": key,
               "method": method, "debug_id": secrets.token_hex(4), "last_error": None,
               "manual_login": manual_login,
               "interactive_window": bool(created.get("interactive_window")),
               "diagnostics": safe_diagnostics(created["state"].get("diagnostics", []))}
    with _lock:
        if _stopping:
            raise AuthError(503, "login_service_stopping", "登录服务正在关闭，请重新启动后再试")
        _prune(time.monotonic())
        if len(_sessions) >= MAX_SESSIONS:
            raise AuthError(429, "login_sessions_full", "扫码会话过多，请稍后再试")
        _sessions[key] = session
    return result


def _public(session, now):
    stored = session["result"]
    result = {"platform": session["platform"], "key": session["key"],
              "status": stored["status"], "authorized": stored["status"] == "authorized",
              "message": stored.get("message", ""),
              "expires_in": max(0, int(session["expires"] - now)), "poll_interval": POLL_INTERVAL}
    if session.get("method"):
        result["method"] = session["method"]
    if session.get('manual_login'):
        result['manual_login'] = True
    if session.get("interactive_window") and stored["status"] in PENDING:
        result["interactive_window"] = True
        result["open_url"] = f"/login/{session['platform']}/open?key={session['key']}"
    if session.get("diagnostics"):
        result["diagnostics"] = session["diagnostics"]
    if session.get("last_error"):
        result["last_error"] = session["last_error"]
    for name in ("upstream_code", "verification_required", "verification_url", "verification_type", "retry_after", "sms_sent", "remote_verification"):
        if name in stored:
            result[name] = stored[name]
    if result["authorized"]:
        for name in ("cookie", "account", "credentials", "session_config"):
            if name in stored:
                result[name] = stored[name]
        result["result_expires_in"] = max(0, int(session["retain_until"] - now))
    return result


def check(platform, key):
    if platform not in PLATFORMS:
        raise AuthError(400, "login_platform_invalid", "请选择 kugou/netease/qqmusic/qishui")
    if not key:
        raise AuthError(400, "login_key_required", "缺少扫码会话 key，请先生成二维码")
    with _lock:
        _prune(time.monotonic())
        session = _sessions.get(key)
    if not session or session["platform"] != platform:
        raise AuthError(404, "login_session_missing", "扫码会话不存在、已清理或不属于该平台，请重新生成二维码")
    with session["lock"]:
        now = time.monotonic()
        if session["result"]["status"] in TERMINAL:
            return _public(session, now)
        if now >= session["expires"]:
            session["result"] = {"status": "expired", "message": "二维码已过期，请重新生成"}
            _release_state(session)
            return _public(session, now)
        if now - session["last_poll"] < POLL_INTERVAL:
            return _public(session, now)
        session["last_poll"] = now
        try:
            result = _invoke(session["adapter"], "check_session", session["state"])
        except AuthError as exc:
            session["diagnostics"] = safe_diagnostics(session["state"].get("diagnostics", [])) or getattr(exc, "diagnostics", [])
            session["last_error"] = {"code": exc.code, "message": str(exc)}
            exc.diagnostics = session["diagnostics"]
            raise
        return _accept_result(session, result)


def _accept_result(session, result):
    session["diagnostics"] = safe_diagnostics(session["state"].get("diagnostics", []))
    session["last_error"] = None
    if not isinstance(result, dict) or result.get("status") not in TERMINAL | PENDING:
        raise AuthError(502, "login_invalid_response", "平台返回了未知登录状态，请重新开始")
    if result["status"] == "authorized" and not result.get("cookie"):
        raise AuthError(502, "login_cookie_missing", "平台未返回完整登录凭据，请重新登录")
    if session.get('method') == 'phone' and session['platform'] == 'qishui':
        session['interactive_window'] = bool(result.get('interactive_window') and result.get('verification_required'))
    session["result"] = result
    if result["status"] in TERMINAL:
        _release_state(session)
        session["retain_until"] = time.monotonic() + RESULT_TTL
    return _public(session, time.monotonic())


def phone_action(operation, key, *, expected_platform='netease', **fields):
    """每次只执行用户明确提交的操作，凭据不进入会话或诊断摘要。"""
    if operation not in ("send_sms", "login_phone"):
        raise AuthError(400, "login_operation_invalid", "不支持的手机号登录操作")
    if not isinstance(key, str) or not key:
        raise AuthError(400, "login_key_required", "缺少登录会话，请重新开始")
    with _lock:
        _prune(time.monotonic())
        session = _sessions.get(key)
    if (not session or session['platform'] != expected_platform or expected_platform not in ('netease', 'qishui')
            or session.get('method') != 'phone'):
        raise AuthError(404, "login_session_missing", "手机号登录会话不存在，请重新开始")
    with session["lock"]:
        now = time.monotonic()
        if session["result"]["status"] in TERMINAL:
            return _public(session, now)
        if now >= session["expires"]:
            session["result"] = {"status": "expired", "message": "登录会话已过期，请重新开始"}
            _release_state(session)
            return _public(session, now)
        try:
            result = _invoke(session["adapter"], operation, session["state"], **fields)
        except AuthError as exc:
            session["diagnostics"] = safe_diagnostics(session["state"].get("diagnostics", [])) or getattr(exc, "diagnostics", [])
            session["last_error"] = {"code": exc.code, "message": str(exc)}
            exc.diagnostics = session["diagnostics"]
            raise
        return _accept_result(session, result)


def show(platform, key):
    """显示这一个二维码对应的官网登录窗口，不能打开另一个无关浏览器会话。"""
    if platform not in PLATFORMS or not key:
        raise AuthError(400, "login_key_required", "请指定有效的平台和扫码会话 key")
    with _lock:
        _prune(time.monotonic())
        session = _sessions.get(key)
    if not session or session["platform"] != platform:
        raise AuthError(404, "login_session_missing", "扫码会话不存在，请重新生成二维码")
    # A private account read can hold session.lock for several seconds. Opening
    # the already-owned official WK view is a UI operation, not another account
    # read. Its native key/closed checks make concurrent completion safe.
    state = session.get('state')
    status = session['result']['status']
    if (session.get('manual_login') and session.get('interactive_window') and state is not None
            and status not in TERMINAL and time.monotonic() < session['expires']
            and callable(getattr(session['adapter'], 'show_session', None))):
        _invoke(session['adapter'], 'show_session', state)
        return {'platform': platform, 'shown': True, 'status': status,
                'message': '已打开本次官网登录窗口，请继续完成登录'}
    with session["lock"]:
        status = session["result"]["status"]
        if status not in TERMINAL and time.monotonic() >= session["expires"]:
            session["result"] = {"status": "expired", "message": "二维码已过期，请重新生成"}
            _release_state(session)
            status = "expired"
        if status in TERMINAL:
            return {"platform": platform, "status": status, "shown": False,
                    "message": "本次登录已完成" if status == "authorized" else "本次扫码已结束，请重新生成二维码"}
        if not session.get("interactive_window") or not callable(getattr(session["adapter"], "show_session", None)):
            raise AuthError(409, "login_window_unavailable", "当前扫码流程没有独立官网登录窗口")
        _invoke(session["adapter"], "show_session", session["state"])
        return {"platform": platform, "shown": True, "status": status,
                "message": "已显示本次官网登录窗口，请在该窗口中完成扫码或验证"}


def verify(platform, key, payload):
    if platform != 'qishui':
        raise AuthError(400,'login_provider_invalid','此验证界面仅用于汽水当前扫码会话')
    with _lock:
        _prune(time.monotonic());session=_sessions.get(key)
    if not session or session['platform'] != platform:
        raise AuthError(404,'login_session_missing','验证会话不存在或已结束')
    with session['lock']:
        if time.monotonic() >= session['expires'] or session['result']['status'] in TERMINAL:
            raise AuthError(409,'login_session_finished','本次验证已结束，请重新登录')
        return _invoke(session['adapter'],'verify_session',session['state'],payload)


def info():
    return {"platforms": [{"id": p, "qr": f"/login/{p}/qr", "check": f"/login/{p}/check",
                           **({"open": f"/login/{p}/open", "default_method": "phone",
                               "phone_session": "/login/netease/phone/session", "sms_send": "/login/netease/sms/send",
                               "phone_login": "/login/netease/phone", "phone_http_method": "POST"} if p == "netease" else {}),
                           **({"methods": ["qq", "wechat", "mobile"]} if p == "qqmusic" else {})}
                          for p in PLATFORMS], "poll_interval": POLL_INTERVAL,
            "result_ttl": RESULT_TTL,
            "statuses": ["waiting", "scanned", "verification_required", "cooldown", "authorized", "expired", "cancelled"]}


def diagnostics():
    """本机诊断摘要不含会话 key、扫码内容、账号值或任何凭据。"""
    with _lock:
        _prune(time.monotonic())
        sessions = list(_sessions.values())
    result = []
    for session in sessions:
        if not session["lock"].acquire(blocking=False):
            result.append({"platform": session["platform"], "debug_id": session["debug_id"], "status": "polling"})
            continue
        try:
            data = session["result"]
            result.append({"platform": session["platform"], "method": session.get("method", ""),
                           "debug_id": session["debug_id"], "status": data["status"],
                           "has_cookie": bool(data.get("cookie")),
                           "account_fields": sorted((data.get("account") or {}).keys()),
                           "credentials_fields": sorted((data.get("credentials") or {}).keys()),
                           "last_error": session.get("last_error"),
                           "events": session.get("diagnostics", [])})
        finally:
            session["lock"].release()
    return {"sessions": result}


def route(path):
    """返回 (操作, 路径内平台)，未知登录子路径返回 invalid。"""
    if path in ("/login", "/api/login"):
        return "info", ""
    if path in ("/login/diagnostics", "/api/login/diagnostics"):
        return "diagnostics", ""
    if path.startswith("/api/login/"):
        path = path[4:]
    phone_routes = {"/login/netease/phone/session": "phone_session", "/login/netease/sms/send": "sms_send",
                    "/login/netease/phone": "phone_login"}
    if path in phone_routes:
        return phone_routes[path], "netease"
    if path in ("/login/qr", "/login/qr/check"):
        return ("check" if path.endswith("/check") else "qr"), ""
    pieces = path.strip("/").split("/")
    if len(pieces) == 3 and pieces[0] == "login" and pieces[2] in ("qr", "check", "open"):
        return pieces[2], pieces[1]
    if path.startswith("/login/"):
        return "invalid", ""
    return None
