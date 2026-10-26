"""统一 API 业务路由。"""

from music_app.api import aggregate as api_aggregate
from music_app.api import albums as api_albums
from music_app.api import artists as api_artists
from music_app.api import charts as api_charts
from music_app.api import radio as api_radio
from music_app.api import params as api_params
from music_app.api import status as api_status
from music_app.auth import router as auth_router
from music_app.core import credentials as core_credentials
from music_app.core import request_credentials
from music_app.providers.kugou import api as kugou_api
from music_app.providers.netease import api as netease_api
from music_app.providers.qishui import api as qishui_api
from music_app.providers.qqmusic import api as qqmusic_api


def dispatch_request(path, params, *, method="GET", payload=None, credentials=None):
    if credentials is None:
        credentials = request_credentials.parse_request({}, params)
    with request_credentials.bind(credentials):
        return _dispatch_request(path, params, method=method, payload=payload)


def _dispatch_request(path, params, *, method="GET", payload=None):
    """独立的业务路由入口，返回 (状态码, 内容)，不直接读写 HTTP 连接。
    先处理 /health、/platforms 和未知路径，再区分聚合与单平台请求。
    单平台校验 platform/type 后调用对应 handle；普通响应补统一元信息。
    302 保留内部 _location，由 Handler 写入 Location；上游异常仍沿用原来的传播规则。"""
    one = params.one
    flag = params.flag
    login_route = auth_router.route(path)
    if login_route:
        operation, route_platform = login_route
        phone_operations = {"phone_session", "sms_send", "phone_login"}
        if (operation in phone_operations) != (method == "POST"):
            return (
                405,
                {
                    "code": "login_method_required",
                    "msg": "手机号登录请使用 POST JSON，扫码与查询请使用 GET",
                },
            )
        if operation == "info":
            return (200, auth_router.info())
        if operation == "diagnostics":
            return (200, auth_router.diagnostics())
        if operation == "invalid":
            return (404, {"code": "login_route_missing", "msg": "未知扫码接口，请查看 /login"})
        raw_platform = one(*api_params.PLATFORM_PARAM_NAMES).strip()
        platform = api_params.platform_of(route_platform or raw_platform)
        if not platform or (
            route_platform and raw_platform and (api_params.platform_of(raw_platform) != platform)
        ):
            return (
                400,
                {
                    "code": "login_platform_invalid",
                    "msg": "扫码登录需要有效且一致的 platform：kugou/netease/qqmusic/qishui",
                },
            )
        try:
            if operation in phone_operations:
                allowed = {
                    "phone_session": set(),
                    "sms_send": {"key", "phone", "countrycode"},
                    "phone_login": {"key", "phone", "countrycode", "password", "captcha"},
                }[operation]
                if (
                    params.values
                    or not isinstance(payload, dict)
                    or set(payload) - allowed
                    or any((not isinstance(value, str) for value in payload.values()))
                ):
                    return (
                        400,
                        {
                            "code": "login_body_invalid",
                            "msg": "请仅在 JSON 请求体中提供有效的登录字段",
                        },
                    )
                if operation == "phone_session":
                    result = auth_router.create_phone()
                else:
                    if not payload.get("phone"):
                        return (400, {"code": "login_phone_required", "msg": "请输入手机号"})
                    fields = {name: value for name, value in payload.items() if name != "key"}
                    result = auth_router.phone_action(
                        "send_sms" if operation == "sms_send" else "login_phone",
                        payload.get("key", ""),
                        **fields
                    )
            elif operation == "qr":
                result = auth_router.create(platform, one("method", "login_method"))
            elif operation == "open":
                result = auth_router.show(platform, one("key", "session_id").strip())
            else:
                result = auth_router.check(platform, one("key", "session_id").strip())
            return (200, result)
        except auth_router.AuthError as exc:
            body = {"platform": platform, "code": exc.code, "msg": str(exc)}
            if getattr(exc, "diagnostics", None):
                body["diagnostics"] = auth_router.safe_diagnostics(exc.diagnostics)
            return (exc.status, body)
    if path == "/health":
        return (200, api_status.health())
    if path == "/platforms":
        return (200, api_status.platforms_info())
    if path in ("/album", "/album/detail", "/api/album"):
        return api_albums.album_response(one)
    if path in ("/artist", "/artist/detail", "/api/artist"):
        return api_artists.artist_response(one)
    if path == "/charts":
        return api_charts.charts_response(one, flag)
    if path == "/chart":
        return api_charts.chart_detail_response(one, flag)
    if path == "/radio/metadata":
        return (200, api_radio.radio_metadata())
    if path not in api_params.PATHS:
        return (
            404,
            {
                "error_code": 404,
                "msg": "未知路径，可用: %s"
                % ", ".join((p for p in api_params.PATHS if p != "/api/music")),
            },
        )
    if path in ("/all", "/aggregate"):
        if one(*api_params.PLATFORM_PARAM_NAMES).strip():
            return (
                400,
                {"error_code": 400, "msg": "聚合接口不接受 platform 参数（/all 自带四平台聚合）"},
            )
        qtype = (one(*api_params.TYPE_PARAM_NAMES) or "").strip().lower()
        if qtype != "all":
            return (400, {"error_code": 400, "msg": "缺少或非法参数 type：聚合接口必须 type=all"})
        code, body = api_aggregate.aggregate_search(one, flag)
        return (code, api_params.with_meta("all", "all", body))
    raw_platform = one(*api_params.PLATFORM_PARAM_NAMES).strip()
    if not raw_platform:
        return (
            400,
            {"error_code": 400, "msg": "缺少参数 platform（kugou/netease/qqmusic/qishui）"},
        )
    pf = api_params.platform_of(raw_platform)
    if not pf:
        return (
            400,
            {
                "error_code": 400,
                "msg": "未知 platform，只支持 %s" % ", ".join(api_params.PLATFORM_IDS),
            },
        )
    mode = api_params.resolve_mode(path, one)
    if not mode:
        raw_type = (one(*api_params.TYPE_PARAM_NAMES) or "").strip().lower()
        if raw_type == "all":
            return (400, {"error_code": 400, "msg": "type=all 请使用 /all 接口"})
        return (400, {"error_code": 400, "msg": "缺少或非法参数 type（search|music）"})
    if pf == "kugou":
        code, body = kugou_api.kugou_handle(one, flag, path)
    elif pf == "netease":
        code, body = netease_api.netease_handle(one, flag, path)
    elif pf == "qishui":
        code, body = qishui_api.handle(one, flag, path, mode)
    else:
        code, body = qqmusic_api.qq_handle(one, flag, path)
    if code == 302:
        return (code, body)
    return (code, api_params.with_meta(pf, mode, body))
