"""汽水扫码公共协议常量、错误与脱敏诊断。"""

import re


HOST = "https://api.qishui.com"


USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) SodaMusic/3.7.0 Chrome/136.0.7103.59 "
              "Electron/36.4.0 Safari/537.36")


MAX_RESPONSE = 2 * 1024 * 1024


POLL_INTERVAL = 3


_ALLOWED_HOSTS = {"api.qishui.com", "bff-pc.qishui.com", "www.qishui.com"}


class AuthError(Exception):
    """只保留可公开展示的信息，不包含上游正文或扫码票据。"""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def _names(values):
    return sorted({str(value) for value in values
                   if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,79}", str(value))})[:80]


def _diagnostic(state, stage, result=None, response=None, **numeric):
    """只保存结构与状态；绝不保存 URL、响应正文、凭据值或用户资料。"""
    event = {"stage": stage, "cookie_names": _names(c.name for c in state.get("jar", []))}
    event.update({k: v for k, v in numeric.items() if isinstance(v, (int, float)) and not isinstance(v, bool)})
    if response is not None:
        status = getattr(response, "status", None)
        if isinstance(status, int):
            event["http_status"] = status
        headers = getattr(response, "headers", None)
        if headers is not None:
            event["set_cookie_names"] = _names(
                row.split("=", 1)[0].strip() for row in headers.get_all("Set-Cookie", []))
    if isinstance(result, dict):
        event["response_fields"] = _names(result)
        data = result.get("data")
        if isinstance(data, dict):
            event["data_fields"] = _names(data)
            code = data.get("error_code")
            if isinstance(code, int):
                event["error_code"] = code
            status = str(data.get("status", "")).lower()
            if status in {"1", "2", "3", "4", "5", "new", "scanned", "confirmed", "expired", "refused",
                          "cancelled", "canceled", "cancel", "rejected", "failed", "error"}:
                event["upstream_status"] = status
    events = state.setdefault("diagnostics", [])
    events.append(event)
    del events[:-16]


def _stage(route):
    if "/get_qrcode/" in route:
        return "qrcode"
    if "/check_qrconnect/" in route:
        return "poll"
    if "/account/info/" in route:
        return "profile"
    return "exchange"
